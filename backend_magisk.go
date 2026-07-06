package main

import (
	"archive/zip"
	"bytes"
	"encoding/json"
	"fmt"
	"io"
	"net/http"
	"os"
	"regexp"
	"strings"
	"time"
)

// Magisk-assisted boot patching (gated behind a Settings toggle in the UI).
// We use the robust, version-agnostic flow: extract boot/init_boot from the
// factory image, push it to the phone, let the installed Magisk app patch it
// (one tap), then pull the patched image back to live-boot or flash. This works
// without pre-existing root and survives Magisk version changes.

var magiskPackages = []string{
	"com.topjohnwu.magisk",     // official
	"io.github.huskydg.magisk", // delta
	"io.github.vvb2060.magisk", // alpha
}

// BootImages holds local temp paths of the boot images pulled out of a factory
// zip ("" when absent — modern Pixels patch init_boot, older ones boot).
type BootImages struct {
	Boot     string `json:"boot"`
	InitBoot string `json:"initBoot"`
	Source   string `json:"source"`
}

// MagiskInstalled returns the Magisk package name on the device, or an error.
func (a *App) MagiskInstalled() (string, error) {
	for _, pkg := range magiskPackages {
		out, err := a.runAdbShell("pm", "path", pkg)
		if err == nil && strings.Contains(out, "package:") {
			return pkg, nil
		}
	}
	return "", fmt.Errorf("Magisk app not found on device — install Magisk first")
}

// InstallMagisk downloads the latest official Magisk APK from GitHub and
// installs it on the device — so the root flow is self-contained (ATK does not
// bundle Magisk; it fetches it on demand).
func (a *App) InstallMagisk() (string, error) {
	if err := a.requireDangerUnlocked(); err != nil {
		return "", err
	}
	client := &http.Client{Timeout: 5 * time.Minute}

	req, _ := http.NewRequest("GET", "https://api.github.com/repos/topjohnwu/Magisk/releases/latest", nil)
	req.Header.Set("User-Agent", "ATK")
	req.Header.Set("Accept", "application/vnd.github+json")
	resp, err := client.Do(req)
	if err != nil {
		return "", fmt.Errorf("could not reach GitHub: %w", err)
	}
	defer resp.Body.Close()
	if resp.StatusCode != 200 {
		return "", fmt.Errorf("GitHub API returned %d (rate limited? try again later)", resp.StatusCode)
	}

	var rel struct {
		TagName string `json:"tag_name"`
		Assets  []struct {
			Name string `json:"name"`
			URL  string `json:"browser_download_url"`
		} `json:"assets"`
	}
	if err := json.NewDecoder(resp.Body).Decode(&rel); err != nil {
		return "", fmt.Errorf("could not parse release info: %w", err)
	}

	var apkURL string
	for _, as := range rel.Assets {
		if strings.HasSuffix(strings.ToLower(as.Name), ".apk") {
			apkURL = as.URL
			break
		}
	}
	if apkURL == "" {
		return "", fmt.Errorf("no APK in latest Magisk release")
	}

	dreq, _ := http.NewRequest("GET", apkURL, nil)
	dreq.Header.Set("User-Agent", "ATK")
	dresp, err := client.Do(dreq)
	if err != nil {
		return "", fmt.Errorf("download failed: %w", err)
	}
	defer dresp.Body.Close()

	tmp, err := os.CreateTemp("", "magisk-*.apk")
	if err != nil {
		return "", err
	}
	defer os.Remove(tmp.Name())
	if _, err := io.Copy(tmp, dresp.Body); err != nil {
		tmp.Close()
		return "", fmt.Errorf("download write failed: %w", err)
	}
	tmp.Close()

	if _, err := a.runCommandTimeout(3*time.Minute, "adb", "install", "-r", tmp.Name()); err != nil {
		return "", fmt.Errorf("adb install failed: %w", err)
	}
	return fmt.Sprintf("Installed Magisk %s — open it once on the phone to finish setup.", rel.TagName), nil
}

// ExtractBootImages pulls boot.img / init_boot.img out of a Pixel factory zip
// (the nested image-*.zip) into local temp files.
func (a *App) ExtractBootImages(zipPath string) (BootImages, error) {
	var res BootImages
	r, err := zip.OpenReader(zipPath)
	if err != nil {
		return res, fmt.Errorf("cannot open zip: %w", err)
	}
	defer r.Close()

	var imgZip *zip.File
	for _, f := range r.File {
		base := f.Name
		if i := strings.LastIndex(base, "/"); i >= 0 {
			base = base[i+1:]
		}
		if strings.HasPrefix(base, "image-") && strings.HasSuffix(base, ".zip") {
			imgZip = f
			res.Source = base
			break
		}
	}
	if imgZip == nil {
		return res, fmt.Errorf("no image-*.zip inside — is this a Pixel factory image?")
	}

	rc, err := imgZip.Open()
	if err != nil {
		return res, err
	}
	data, err := io.ReadAll(rc)
	rc.Close()
	if err != nil {
		return res, err
	}

	zr, err := zip.NewReader(bytes.NewReader(data), int64(len(data)))
	if err != nil {
		return res, fmt.Errorf("cannot read inner image zip: %w", err)
	}
	for _, f := range zr.File {
		switch f.Name {
		case "boot.img":
			if p, e := extractZipEntryToTemp(f, "atk-boot-*.img"); e == nil {
				res.Boot = p
			}
		case "init_boot.img":
			if p, e := extractZipEntryToTemp(f, "atk-initboot-*.img"); e == nil {
				res.InitBoot = p
			}
		}
	}
	if res.Boot == "" && res.InitBoot == "" {
		return res, fmt.Errorf("no boot/init_boot image found in factory image")
	}
	return res, nil
}

func extractZipEntryToTemp(f *zip.File, pattern string) (string, error) {
	rc, err := f.Open()
	if err != nil {
		return "", err
	}
	defer rc.Close()
	tmp, err := os.CreateTemp("", pattern)
	if err != nil {
		return "", err
	}
	defer tmp.Close()
	if _, err := io.Copy(tmp, rc); err != nil {
		return "", err
	}
	return tmp.Name(), nil
}

// PushImageToDevice copies a local image into /sdcard/Download for Magisk to
// patch, returning the remote path.
func (a *App) PushImageToDevice(localPath string) (string, error) {
	if strings.TrimSpace(localPath) == "" {
		return "", fmt.Errorf("no image to push")
	}
	remote := "/sdcard/Download/" + baseName(localPath)
	if _, err := a.runCommandTimeout(5*time.Minute, "adb", "push", localPath, remote); err != nil {
		return "", fmt.Errorf("push failed: %w", err)
	}
	return remote, nil
}

// OpenMagisk launches the Magisk app on the device.
func (a *App) OpenMagisk() error {
	pkg, err := a.MagiskInstalled()
	if err != nil {
		return err
	}
	if _, err := a.runAdbShell("monkey", "-p", pkg, "-c", "android.intent.category.LAUNCHER", "1"); err != nil {
		return fmt.Errorf("could not open Magisk: %w", err)
	}
	return nil
}

// ── Magisk module management (requires root / su) ──────────────────────────

type MagiskModule struct {
	Id          string `json:"id"`
	Name        string `json:"name"`
	Version     string `json:"version"`
	Author      string `json:"author"`
	Description string `json:"description"`
	Enabled     bool   `json:"enabled"`
}

var moduleIdRe = regexp.MustCompile(`^[A-Za-z0-9._-]+$`)

func validModuleId(id string) error {
	if !moduleIdRe.MatchString(id) {
		return fmt.Errorf("invalid module id")
	}
	return nil
}

// ListMagiskModules reads /data/adb/modules via su. Returns an error if the
// device isn't rooted (su unavailable or not granted to shell).
func (a *App) ListMagiskModules() ([]MagiskModule, error) {
	script := `for d in /data/adb/modules/*/; do [ -d "$d" ] || continue; echo "===MODULE==="; echo "dir=$(basename "$d")"; if [ -f "$d/disable" ]; then echo "disabled=1"; else echo "disabled=0"; fi; cat "$d/module.prop" 2>/dev/null; done`
	out, err := a.runAdbShell("su", "-c", shellQuote(script))
	if err != nil {
		return nil, fmt.Errorf("could not read modules — device must be rooted, and shell granted root in Magisk")
	}

	var mods []MagiskModule
	for _, b := range strings.Split(out, "===MODULE===") {
		b = strings.TrimSpace(b)
		if b == "" {
			continue
		}
		m := MagiskModule{Enabled: true}
		for _, line := range strings.Split(b, "\n") {
			k, v, ok := strings.Cut(strings.TrimSpace(line), "=")
			if !ok {
				continue
			}
			switch k {
			case "dir":
				m.Id = v
			case "disabled":
				if v == "1" {
					m.Enabled = false
				}
			case "id":
				if v != "" {
					m.Id = v
				}
			case "name":
				m.Name = v
			case "version":
				m.Version = v
			case "author":
				m.Author = v
			case "description":
				m.Description = v
			}
		}
		if m.Id != "" {
			if m.Name == "" {
				m.Name = m.Id
			}
			mods = append(mods, m)
		}
	}
	return mods, nil
}

// ToggleMagiskModule enables/disables a module (Magisk applies on next reboot).
func (a *App) ToggleMagiskModule(id string, enable bool) (string, error) {
	if err := validModuleId(id); err != nil {
		return "", err
	}
	cmd := "touch /data/adb/modules/" + id + "/disable"
	if enable {
		cmd = "rm -f /data/adb/modules/" + id + "/disable"
	}
	if _, err := a.runAdbShell("su", "-c", shellQuote(cmd)); err != nil {
		return "", fmt.Errorf("failed: %w", err)
	}
	state := "disabled"
	if enable {
		state = "enabled"
	}
	return fmt.Sprintf("%s %s — reboot to apply", id, state), nil
}

// RemoveMagiskModule flags a module for removal on next reboot.
func (a *App) RemoveMagiskModule(id string) (string, error) {
	if err := validModuleId(id); err != nil {
		return "", err
	}
	if _, err := a.runAdbShell("su", "-c", shellQuote("touch /data/adb/modules/"+id+"/remove")); err != nil {
		return "", fmt.Errorf("failed: %w", err)
	}
	return fmt.Sprintf("%s flagged for removal — reboot to apply", id), nil
}

// PullPatchedBoot finds the newest magisk_patched-*.img in /sdcard/Download and
// pulls it to a local temp file (ready to live-boot or flash).
func (a *App) PullPatchedBoot() (string, error) {
	out, err := a.runAdbShell("ls", "-t", "/sdcard/Download/")
	if err != nil {
		return "", fmt.Errorf("cannot list Download: %w", err)
	}
	var name string
	for _, line := range strings.Split(out, "\n") {
		line = strings.TrimSpace(line)
		if strings.HasPrefix(line, "magisk_patched") && strings.HasSuffix(line, ".img") {
			name = line
			break
		}
	}
	if name == "" {
		return "", fmt.Errorf("no magisk_patched-*.img in Download — patch the image in Magisk first")
	}

	tmp, err := os.CreateTemp("", "atk-patched-*.img")
	if err != nil {
		return "", err
	}
	tmp.Close()
	if _, err := a.runCommandTimeout(5*time.Minute, "adb", "pull", "/sdcard/Download/"+name, tmp.Name()); err != nil {
		return "", fmt.Errorf("pull failed: %w", err)
	}
	return tmp.Name(), nil
}
