package main

import (
	"archive/zip"
	"bufio"
	"bytes"
	"context"
	"fmt"
	"io"
	"os"
	"os/exec"
	"path/filepath"
	"strings"
	"time"
)

// Pixel factory image flashing (the flash-all.sh steps).
//
// `fastboot update image-*.zip` unpacks the images into $TMPDIR before sending
// them, and on a device with a super partition it unpacks every dynamic
// partition image at once to build one combined super image. For the Pixel 11
// series that is ~8 GB at the same time (product.img alone is ~4.75 GB). Since
// Ubuntu 25.10 /tmp is a tmpfs capped at 50% of RAM, so on smaller machines
// fastboot dies with "failed to extract 'product.img': I/O error". We therefore
// point fastboot at a temp dir in the user cache dir (on disk) and check the
// free space before starting.

// superUnpackMargin is extra room on top of the image sizes for fastboot's own
// temp files (sparse chunks, small images).
const superUnpackMargin = 512 << 20

// FactoryPreflight is what the Pixel Flasher shows before `fastboot update`.
type FactoryPreflight struct {
	ImageZip    string   `json:"imageZip"`
	TmpDir      string   `json:"tmpDir"`
	NeedBytes   int64    `json:"needBytes"`
	FreeBytes   int64    `json:"freeBytes"` // -1 = unknown on this OS
	Fastboot    string   `json:"fastboot"`
	FastbootVer string   `json:"fastbootVer"`
	Warnings    []string `json:"warnings"`
	OK          bool     `json:"ok"`
}

// fastbootTmpDir returns (and creates) the on-disk temp dir fastboot unpacks into.
func fastbootTmpDir() (string, error) {
	base, err := os.UserCacheDir()
	if err != nil {
		return "", fmt.Errorf("no user cache dir: %w", err)
	}
	dir := filepath.Join(base, "atk", "fastboot-tmp")
	if err := os.MkdirAll(dir, 0o700); err != nil {
		return "", fmt.Errorf("cannot create %s: %w", dir, err)
	}
	return dir, nil
}

// ResolveFactoryFile finds a file named in flash-all.sh (bootloader-*.img,
// radio-*.img, image-*.zip) on disk. factoryPath is the factory .zip the user
// picked; fastboot cannot read a zip inside a zip, so the factory zip must have
// been extracted next to itself (flat, into its own folder, or a folder named
// after the zip).
func (a *App) ResolveFactoryFile(factoryPath, name string) (string, error) {
	if name == "" || strings.ContainsAny(name, "/\\") {
		return "", fmt.Errorf("invalid file name %q", name)
	}
	dir := filepath.Dir(factoryPath)
	zipBase := strings.TrimSuffix(filepath.Base(factoryPath), filepath.Ext(factoryPath))
	candidates := []string{filepath.Join(dir, name), filepath.Join(dir, zipBase, name)}
	if r, err := zip.OpenReader(factoryPath); err == nil {
		for _, f := range r.File {
			if filepath.Base(f.Name) == name {
				candidates = append(candidates,
					filepath.Join(dir, filepath.FromSlash(f.Name)),
					filepath.Join(dir, zipBase, filepath.FromSlash(f.Name)))
			}
		}
		r.Close()
	}
	for _, c := range candidates {
		if info, err := os.Stat(c); err == nil && !info.IsDir() {
			return c, nil
		}
	}
	return "", fmt.Errorf("%s not found next to %s. Extract the factory zip first "+
		"(fastboot cannot read the image zip while it is still inside the factory zip)", name, filepath.Base(factoryPath))
}

// factoryUnpackBytes estimates how much $TMPDIR space `fastboot update` needs:
// the uncompressed size of every image fastboot-info.txt flashes (fastboot may
// hold all super images open at once). Without fastboot-info.txt, every .img
// except userdata images counts.
func factoryUnpackBytes(imageZip string) (int64, error) {
	r, err := zip.OpenReader(imageZip)
	if err != nil {
		return 0, fmt.Errorf("cannot open %s: %w", filepath.Base(imageZip), err)
	}
	defer r.Close()

	sizes := map[string]int64{}
	var info *zip.File
	for _, f := range r.File {
		sizes[f.Name] = int64(f.UncompressedSize64)
		if f.Name == "fastboot-info.txt" {
			info = f
		}
	}

	var total int64
	if info == nil {
		for name, sz := range sizes {
			if strings.HasSuffix(name, ".img") && !strings.HasPrefix(name, "userdata") {
				total += sz
			}
		}
		return total + superUnpackMargin, nil
	}

	rc, err := info.Open()
	if err != nil {
		return 0, err
	}
	defer rc.Close()
	data, err := io.ReadAll(rc)
	if err != nil {
		return 0, err
	}
	seen := map[string]bool{}
	sc := bufio.NewScanner(bytes.NewReader(data))
	for sc.Scan() {
		f := strings.Fields(sc.Text())
		if len(f) < 2 || f[0] != "flash" {
			continue
		}
		// flash [--flags...] <partition> [image.img]
		args := []string{}
		for _, x := range f[1:] {
			if !strings.HasPrefix(x, "--") {
				args = append(args, x)
			}
		}
		if len(args) == 0 {
			continue
		}
		img := args[0] + ".img"
		if len(args) > 1 {
			img = args[len(args)-1]
		}
		if !seen[img] {
			seen[img] = true
			total += sizes[img]
		}
	}
	return total + superUnpackMargin, nil
}

// FactoryImagePreflight checks an image-*.zip before `fastboot update`.
func (a *App) FactoryImagePreflight(imageZip string) (FactoryPreflight, error) {
	p := FactoryPreflight{ImageZip: imageZip, FreeBytes: -1, Warnings: []string{}}
	tmp, err := fastbootTmpDir()
	if err != nil {
		return p, err
	}
	p.TmpDir = tmp
	if p.NeedBytes, err = factoryUnpackBytes(imageZip); err != nil {
		return p, err
	}
	p.FreeBytes = diskFreeBytes(tmp)

	if fb, err := a.getBinaryPath("fastboot"); err == nil {
		p.Fastboot = fb
		out, _ := exec.Command(fb, "--version").CombinedOutput()
		p.FastbootVer = strings.TrimSpace(strings.SplitN(string(out), "\n", 2)[0])
		if strings.Contains(p.FastbootVer, "-debian") {
			p.Warnings = append(p.Warnings, "This fastboot is the Ubuntu/Debian package build ("+p.FastbootVer+
				"). Google's platform-tools are recommended; set the path in Settings.")
		}
	}

	p.OK = p.FreeBytes < 0 || p.FreeBytes >= p.NeedBytes
	if p.FreeBytes < 0 {
		p.Warnings = append(p.Warnings, "Could not read free space on "+tmp+"; make sure it has "+humanBytes(p.NeedBytes)+" free.")
	}
	return p, nil
}

// factoryFlags validates the extra fastboot flags the Pixel Flasher may pass.
func factoryFlags(flags []string) ([]string, error) {
	allowed := map[string]bool{
		"--disable-verity": true, "--disable-verification": true, "--force": true,
		"--disable-super-optimization": true,
	}
	out := []string{}
	for i := 0; i < len(flags); i++ {
		f := flags[i]
		if f == "--slot" && i+1 < len(flags) && validSlots[flags[i+1]] && flags[i+1] != "" {
			out = append(out, f, flags[i+1])
			i++
			continue
		}
		if !allowed[f] {
			return nil, fmt.Errorf("unsupported fastboot flag %q", f)
		}
		out = append(out, f)
	}
	return out, nil
}

// runFastbootFactory runs fastboot with TMPDIR (and TMP/TEMP for Windows)
// pointed at the on-disk temp dir. fastboot reports progress on stderr, so the
// combined output is returned.
func (a *App) runFastbootFactory(ctx context.Context, args ...string) (string, error) {
	fb, err := a.getBinaryPath("fastboot")
	if err != nil {
		return "", err
	}
	tmp, err := fastbootTmpDir()
	if err != nil {
		return "", err
	}
	cmd := exec.CommandContext(ctx, fb, args...)
	setCommandSysProcAttr(cmd)
	cmd.Env = append(os.Environ(), "TMPDIR="+tmp, "TMP="+tmp, "TEMP="+tmp)
	var buf bytes.Buffer
	cmd.Stdout = &buf
	cmd.Stderr = &buf
	err = cmd.Run()
	out := strings.TrimSpace(buf.String())
	if err != nil {
		if ctx.Err() == context.DeadlineExceeded {
			return out, fmt.Errorf("fastboot timed out")
		}
		if ctx.Err() == context.Canceled {
			return out, fmt.Errorf("cancelled")
		}
		if out == "" {
			out = err.Error()
		}
		return out, fmt.Errorf("%s", out)
	}
	return out, nil
}

// FactoryFlash flashes one file from the factory image (bootloader, radio).
func (a *App) FactoryFlash(partition, filePath string, flags []string) (string, error) {
	if err := a.requireDangerUnlocked(); err != nil {
		return "", err
	}
	if err := validatePartitionName(partition); err != nil {
		return "", err
	}
	if strings.TrimSpace(filePath) == "" {
		return "", fmt.Errorf("no image selected")
	}
	extra, err := factoryFlags(flags)
	if err != nil {
		return "", err
	}
	ctx, cancel := a.beginCancellableOp(10 * time.Minute)
	defer cancel()
	args := append(extra, "flash", partition, filePath)
	return a.runFastbootFactory(ctx, args...)
}

// FactoryUpdate runs `fastboot [flags] [-w] --skip-reboot update <image-*.zip>`
// after checking the temp dir has room. --skip-reboot leaves the device in
// fastboot so the Pixel Flasher's own final reboot step still finds it.
func (a *App) FactoryUpdate(imageZip string, wipe bool, flags []string) (string, error) {
	if err := a.requireDangerUnlocked(); err != nil {
		return "", err
	}
	extra, err := factoryFlags(flags)
	if err != nil {
		return "", err
	}
	p, err := a.FactoryImagePreflight(imageZip)
	if err != nil {
		return "", err
	}
	if !p.OK {
		return "", fmt.Errorf("not enough space to unpack the images: need %s in %s, only %s free",
			humanBytes(p.NeedBytes), p.TmpDir, humanBytes(p.FreeBytes))
	}
	args := append(extra, "--skip-reboot")
	if wipe {
		args = append(args, "-w")
	}
	args = append(args, "update", imageZip)
	ctx, cancel := a.beginCancellableOp(60 * time.Minute)
	defer cancel()
	return a.runFastbootFactory(ctx, args...)
}
