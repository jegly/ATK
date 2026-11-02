package main

// GSI pull / reinstall. The image DSU actually installed lives in /data/gsi,
// which needs root to read — but every image ATK installs is first pushed as a
// .gz to the Download folder (see InstallDsu) and stays there. That copy is
// the source here: list it, pull it back to the computer (optionally unpacked
// to a raw system.img for the permanent flasher), or reinstall it as a DSU
// straight from the device without pushing it again.
//
// DSU needs the UNCOMPRESSED system size. InstallDsu records it in a
// <image>.atk.json sidecar next to the push; images pushed before that existed
// fall back to the gzip trailer, which holds the size mod 4 GiB.

import (
	"compress/gzip"
	"encoding/json"
	"fmt"
	"io"
	"os"
	"path/filepath"
	"sort"
	"strconv"
	"strings"
	"time"

	"github.com/wailsapp/wails/v2/pkg/runtime"
)

const dsuMetaSuffix = ".atk.json"

// dsuMinImageSize skips small .gz files in Download that can't be a GSI.
const dsuMinImageSize int64 = 256 << 20

// dsuMeta is the sidecar InstallDsu writes next to each pushed image.
type dsuMeta struct {
	SystemSize   int64  `json:"systemSize"`
	UserdataSize int64  `json:"userdataSize,omitempty"`
	Label        string `json:"label,omitempty"` // name of the source image, for the pulled filename
	InstalledAt  string `json:"installedAt,omitempty"`
}

// DeviceGsiImage is a DSU-installable image found in the device's Download folder.
type DeviceGsiImage struct {
	Path       string `json:"path"`
	Name       string `json:"name"`
	Label      string `json:"label"`
	Size       int64  `json:"size"`       // bytes on the device (compressed)
	SystemSize int64  `json:"systemSize"` // uncompressed system image size; 0 = unknown
	SizeExact  bool   `json:"sizeExact"`  // false = estimated from the gzip trailer
	Modified   int64  `json:"modified"`   // unix seconds
}

// dsuLabelFor names an image for the sidecar. GSI builds ship as a folder
// holding a generic system.img, so the folder name is the useful part.
func dsuLabelFor(imagePath string) string {
	stem := filepath.Base(imagePath)
	for _, ext := range []string{".gz", ".img"} {
		if strings.HasSuffix(strings.ToLower(stem), ext) {
			stem = stem[:len(stem)-len(ext)]
		}
	}
	if strings.HasPrefix(strings.ToLower(stem), "system") {
		if dir := filepath.Base(filepath.Dir(imagePath)); dir != "." && dir != string(filepath.Separator) {
			return dir
		}
	}
	return stem
}

func (a *App) writeDsuMeta(remote string, m dsuMeta) error {
	b, err := json.Marshal(m)
	if err != nil {
		return err
	}
	tmp, err := os.CreateTemp("", "atk-dsu-*.json")
	if err != nil {
		return err
	}
	defer os.Remove(tmp.Name())
	if _, err := tmp.Write(b); err != nil {
		tmp.Close()
		return err
	}
	if err := tmp.Close(); err != nil {
		return err
	}
	_, err = a.runCommandTimeout(30*time.Second, "adb", "push", tmp.Name(), remote+dsuMetaSuffix)
	return err
}

func (a *App) readDsuMeta(remote string) (dsuMeta, bool) {
	out, err := a.runAdbShell("cat", shellQuote(remote+dsuMetaSuffix))
	if err != nil {
		return dsuMeta{}, false
	}
	var m dsuMeta
	if json.Unmarshal([]byte(out), &m) != nil || m.SystemSize <= 0 {
		return dsuMeta{}, false
	}
	return m, true
}

// remoteGzipSize reads the gzip trailer (ISIZE, uncompressed size mod 4 GiB)
// of a file on the device. A raw image never compresses to more than its own
// size, so the wrap is settled by taking the first value >= the .gz size.
func (a *App) remoteGzipSize(remote string, compressed int64) int64 {
	out, err := a.runAdbShell("tail", "-c", "4", shellQuote(remote), "|", "od", "-An", "-tu4")
	if err != nil {
		return 0
	}
	v, err := strconv.ParseInt(strings.TrimSpace(out), 10, 64)
	if err != nil || v <= 0 {
		return 0
	}
	for v < compressed {
		v += 1 << 32
	}
	return v
}

// dsuRemoteSystemSize works out KEY_SYSTEM_SIZE for an image on the device.
func (a *App) dsuRemoteSystemSize(remote string, compressed int64) (size int64, exact bool) {
	if m, ok := a.readDsuMeta(remote); ok {
		return m.SystemSize, true
	}
	return a.remoteGzipSize(remote, compressed), false
}

// validDsuRemote keeps pull/reinstall to .gz files directly in Download.
func validDsuRemote(remote string) error {
	if !strings.HasPrefix(remote, dsuRemoteDir+"/") || strings.Contains(remote[len(dsuRemoteDir)+1:], "/") {
		return fmt.Errorf("image must be in %s", dsuRemoteDir)
	}
	if !strings.HasSuffix(strings.ToLower(remote), ".gz") {
		return fmt.Errorf("DSU installs .gz images only: %s", baseName(remote))
	}
	return nil
}

// ListDeviceGsiImages lists the .gz images in the device's Download folder
// that DSU can install, newest first.
func (a *App) ListDeviceGsiImages() ([]DeviceGsiImage, error) {
	// The glob expands on the device; `; true` keeps an empty match from
	// turning into an error.
	out, err := a.runAdbShell("stat", "-c", shellQuote("%s|%Y|%n"), dsuRemoteDir+"/*.gz", "2>/dev/null", ";", "true")
	if err != nil {
		return nil, err
	}
	images := []DeviceGsiImage{}
	for _, line := range strings.Split(out, "\n") {
		parts := strings.SplitN(strings.TrimSpace(line), "|", 3)
		if len(parts) != 3 {
			continue
		}
		size, err1 := strconv.ParseInt(parts[0], 10, 64)
		mod, err2 := strconv.ParseInt(parts[1], 10, 64)
		if err1 != nil || err2 != nil || size < dsuMinImageSize {
			continue
		}
		img := DeviceGsiImage{Path: parts[2], Name: baseName(parts[2]), Size: size, Modified: mod}
		if m, ok := a.readDsuMeta(img.Path); ok {
			img.SystemSize, img.SizeExact, img.Label = m.SystemSize, true, m.Label
		} else {
			img.SystemSize = a.remoteGzipSize(img.Path, size)
		}
		images = append(images, img)
	}
	sort.Slice(images, func(i, j int) bool { return images[i].Modified > images[j].Modified })
	return images, nil
}

// PullDeviceGsi pulls a GSI .gz from the device's Download folder to a file the
// user picks. With extractRaw it is also unpacked next to it as a raw .img —
// what the permanent GSI flasher takes. The .gz itself installs as a DSU
// as-is (InstallDsu sizes it automatically).
func (a *App) PullDeviceGsi(remote string, extractRaw bool) (string, error) {
	remote = strings.TrimSpace(remote)
	if err := validDsuRemote(remote); err != nil {
		return "", err
	}
	name := baseName(remote)
	meta, hasMeta := a.readDsuMeta(remote)
	def := name
	if hasMeta && meta.Label != "" {
		def = meta.Label + ".img.gz"
	}

	local, err := a.SelectSaveFile(def)
	if err != nil {
		return "", fmt.Errorf("save dialog failed: %w", err)
	}
	if local == "" {
		return "Pull cancelled.", nil
	}

	ctx, cancel := a.beginCancellableOp(0)
	defer cancel()
	err = a.runTransfer(ctx, "pull", name, "pull", remote, local)
	runtime.EventsEmit(a.ctx, "transfer:done", nil)
	if err != nil {
		if strings.Contains(err.Error(), "cancelled") {
			return "", fmt.Errorf("pull cancelled")
		}
		return "", fmt.Errorf("pull failed: %w", err)
	}
	msg := fmt.Sprintf("Pulled %s to %s", name, local)

	if extractRaw {
		raw := local
		if strings.HasSuffix(strings.ToLower(raw), ".gz") {
			raw = raw[:len(raw)-3]
		}
		if !strings.HasSuffix(strings.ToLower(raw), ".img") {
			raw += ".img"
		}
		n, err := gunzipTo(local, raw)
		if err != nil {
			return msg, fmt.Errorf("pulled, but unpacking failed: %w", err)
		}
		msg += fmt.Sprintf("\nUnpacked raw image: %s (%s)", raw, humanBytes(n))
		if hasMeta && n != meta.SystemSize {
			msg += fmt.Sprintf("\nWarning: size differs from the one recorded at install (%d bytes) — the image may have been replaced.", meta.SystemSize)
		}
	}
	return msg, nil
}

// InstallDsuFromDevice installs a .gz that is already in the device's Download
// folder, skipping the gzip + push. systemSize <= 0 = work it out.
func (a *App) InstallDsuFromDevice(remote string, systemSize int64, userdataSize int64, opts DsuInstallOpts) (string, error) {
	remote = strings.TrimSpace(remote)
	if err := validDsuRemote(remote); err != nil {
		return "", err
	}
	out, err := a.runAdbShell("stat", "-c", "%s", shellQuote(remote))
	if err != nil {
		return "", fmt.Errorf("image not found on device: %s", remote)
	}
	compressed, _ := strconv.ParseInt(strings.TrimSpace(out), 10, 64)

	sysSize := systemSize
	if sysSize <= 0 {
		sysSize, _ = a.dsuRemoteSystemSize(remote, compressed)
		if sysSize <= 0 {
			return "", fmt.Errorf("could not work out the system size of %s — pull it and install from the computer, or enter the size in bytes", baseName(remote))
		}
	}
	if userdataSize <= 0 {
		userdataSize = dsuDefaultUserdata
	}
	return a.startDsu(remote, sysSize, userdataSize, opts)
}

// gzipRawSize returns the exact uncompressed size of a .gz.
func gzipRawSize(path string) (int64, error) {
	return gunzipTo(path, "")
}

// gunzipTo decompresses src into dst (or just counts the bytes when dst is
// empty) and returns the uncompressed size.
func gunzipTo(src, dst string) (int64, error) {
	in, err := os.Open(src)
	if err != nil {
		return 0, err
	}
	defer in.Close()
	zr, err := gzip.NewReader(in)
	if err != nil {
		return 0, err
	}
	defer zr.Close()

	if dst == "" {
		return io.Copy(io.Discard, zr)
	}
	out, err := os.Create(dst)
	if err != nil {
		return 0, err
	}
	n, err := io.Copy(out, zr)
	if cerr := out.Close(); err == nil {
		err = cerr
	}
	if err != nil {
		os.Remove(dst)
		return 0, err
	}
	return n, nil
}
