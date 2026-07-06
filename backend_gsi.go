package main

// GSI Loader backend — two ways to run a Generic System Image on the device:
//
//  1. DSU (temporary): install a GSI as a guest OS via Dynamic System Updates.
//     Non-destructive, no unlock, no wipe. Follows the exact adb flow from the
//     Android DSU docs (see dsi_info.txt): gzip the raw image, push it to
//     /storage/emulated/0/Download, then fire the START_INSTALL intent at
//     com.android.dynsystem. Managed afterwards with gsi_tool.
//
//  2. GSI flash (permanent): fastboot-flash a GSI to the system partition.
//     Destructive; DANGER-gated (App Lock). Sequences the documented fastboot
//     steps with a dry-run preview.

import (
	"compress/gzip"
	"fmt"
	"io"
	"os"
	"path/filepath"
	"strconv"
	"strings"
	"time"
)

const dsuDefaultUserdata int64 = 8589934592 // 8 GiB
const dsuRemoteDir = "/storage/emulated/0/Download"

// GsiCompat reports whether the device can run a GSI and which one.
type GsiCompat struct {
	TrebleEnabled  bool   `json:"trebleEnabled"`
	Abi            string `json:"abi"`          // ro.product.cpu.abi, e.g. arm64-v8a
	GsiArch        string `json:"gsiArch"`      // derived: arm64 / x86_64 / arm / x86
	VndkIsolated   bool   `json:"vndkIsolated"` // true => any newer GSI ok; false => same-version only
	AndroidRelease string `json:"androidRelease"`
	Sdk            string `json:"sdk"`
	DsuStatus      string `json:"dsuStatus"`
}

// GsiCompat runs the documented compatibility checks (getprop + ld.config).
func (a *App) GsiCompat() (GsiCompat, error) {
	c := GsiCompat{}
	if v, err := a.runAdbShell("getprop", "ro.treble.enabled"); err == nil {
		c.TrebleEnabled = strings.TrimSpace(v) == "true"
	}
	if v, err := a.runAdbShell("getprop", "ro.product.cpu.abi"); err == nil {
		c.Abi = strings.TrimSpace(v)
		c.GsiArch = gsiArchForAbi(c.Abi)
	}
	if v, err := a.runAdbShell("getprop", "ro.build.version.release"); err == nil {
		c.AndroidRelease = strings.TrimSpace(v)
	}
	if v, err := a.runAdbShell("getprop", "ro.build.version.sdk"); err == nil {
		c.Sdk = strings.TrimSpace(v)
	}
	if v, err := a.runAdbShell("cat", "/system/etc/ld.config.version_identifier.txt"); err == nil {
		c.VndkIsolated = vendorNamespaceIsolated(v)
	}
	if v, err := a.runAdbShell("gsi_tool", "status"); err == nil {
		c.DsuStatus = strings.TrimSpace(v)
	}
	return c, nil
}

func gsiArchForAbi(abi string) string {
	switch {
	case strings.HasPrefix(abi, "arm64"):
		return "arm64"
	case strings.HasPrefix(abi, "x86_64"):
		return "x86_64"
	case strings.HasPrefix(abi, "x86"):
		return "x86"
	case strings.HasPrefix(abi, "arm"):
		return "arm"
	}
	return abi
}

// vendorNamespaceIsolated parses ld.config for the [vendor] section and reports
// whether namespace.default.isolated is true (full VNDK => any newer GSI works).
func vendorNamespaceIsolated(ld string) bool {
	inVendor := false
	for _, line := range strings.Split(ld, "\n") {
		t := strings.TrimSpace(line)
		if strings.HasPrefix(t, "[") && strings.HasSuffix(t, "]") {
			inVendor = t == "[vendor]"
			continue
		}
		if inVendor && strings.Contains(t, "namespace.default.isolated") {
			return strings.Contains(strings.ToLower(t), "true")
		}
	}
	return false
}

// --- gsi_tool management ---------------------------------------------------

func (a *App) GsiDsuStatus() (string, error) { return a.runAdbShell("gsi_tool", "status") }
func (a *App) DsuEnable() (string, error)    { return a.runAdbShell("gsi_tool", "enable") }
func (a *App) DsuDisable() (string, error)   { return a.runAdbShell("gsi_tool", "disable") }
func (a *App) DsuWipe() (string, error)      { return a.runAdbShell("gsi_tool", "wipe") }

// --- DSU install -----------------------------------------------------------

// InstallDsu prepares and installs a temporary DSU from a GSI image, then fires
// the DynamicSystemInstallationService intent. `systemSize` is the UNCOMPRESSED
// raw image size in bytes (auto = file size for a raw .img; REQUIRED for a .gz).
// `userdataSize` defaults to 8 GiB when <= 0.
func (a *App) InstallDsu(imagePath string, systemSize int64, userdataSize int64) (string, error) {
	imagePath = strings.TrimSpace(imagePath)
	if imagePath == "" {
		return "", fmt.Errorf("no GSI image selected")
	}
	info, err := os.Stat(imagePath)
	if err != nil || info.IsDir() {
		return "", fmt.Errorf("image not found: %s", imagePath)
	}
	if isSparseImage(imagePath) {
		return "", fmt.Errorf("this looks like a SPARSE image — DSU needs an unsparsed raw image. Convert first:\n  simg2img system.img system_raw.img\nthen select the raw .img (or a .gz you made from it).")
	}

	if userdataSize <= 0 {
		userdataSize = dsuDefaultUserdata
	}

	var gzPath string
	var sysSize int64
	isGz := strings.HasSuffix(strings.ToLower(imagePath), ".gz")
	if isGz {
		gzPath = imagePath
		if systemSize <= 0 {
			return "", fmt.Errorf("for a .gz image, provide the uncompressed system image size (bytes) — DSU needs KEY_SYSTEM_SIZE")
		}
		sysSize = systemSize
	} else {
		// Raw image: size is exact; gzip it host-side as the docs require.
		sysSize = info.Size()
		if systemSize > 0 {
			sysSize = systemSize
		}
		gzPath = filepath.Join(os.TempDir(), "atk-dsu.gz")
		if err := gzipFile(imagePath, gzPath); err != nil {
			return "", fmt.Errorf("failed to gzip image: %w", err)
		}
		defer os.Remove(gzPath)
	}

	// Push the gzipped image to the device (progress via transfer:* events).
	if _, err := a.PushWithProgress(gzPath, dsuRemoteDir); err != nil {
		return "", err
	}
	remote := dsuRemoteDir + "/" + filepath.Base(gzPath)

	// Fire the DSU install intent — verbatim from the Android docs.
	out, err := a.runAdbShell(
		"am", "start-activity",
		"-n", "com.android.dynsystem/com.android.dynsystem.VerificationActivity",
		"-a", "android.os.image.action.START_INSTALL",
		"-d", "file://"+remote,
		"--el", "KEY_SYSTEM_SIZE", strconv.FormatInt(sysSize, 10),
		"--el", "KEY_USERDATA_SIZE", strconv.FormatInt(userdataSize, 10),
	)
	if err != nil {
		return "", fmt.Errorf("failed to launch DSU install: %w (%s)", err, strings.TrimSpace(out))
	}
	return fmt.Sprintf("DSU install started (system %s, userdata %s). On the device, tap Restart in the notification to boot the GSI, or Discard to cancel. Use 'gsi_tool enable' for sticky mode.",
		humanBytes(sysSize), humanBytes(userdataSize)), nil
}

// isSparseImage checks the Android sparse-image magic (0xed26ff3a, little-endian).
func isSparseImage(path string) bool {
	f, err := os.Open(path)
	if err != nil {
		return false
	}
	defer f.Close()
	var b [4]byte
	if _, err := io.ReadFull(f, b[:]); err != nil {
		return false
	}
	return b[0] == 0x3a && b[1] == 0xff && b[2] == 0x26 && b[3] == 0xed
}

func gzipFile(src, dst string) error {
	in, err := os.Open(src)
	if err != nil {
		return err
	}
	defer in.Close()
	out, err := os.Create(dst)
	if err != nil {
		return err
	}
	defer out.Close()
	zw := gzip.NewWriter(out)
	if _, err := io.Copy(zw, in); err != nil {
		zw.Close()
		return err
	}
	return zw.Close()
}

func humanBytes(n int64) string {
	const u = 1024
	if n < u {
		return fmt.Sprintf("%d B", n)
	}
	div, exp := int64(u), 0
	for x := n / u; x >= u; x /= u {
		div *= u
		exp++
	}
	return fmt.Sprintf("%.1f %ciB", float64(n)/float64(div), "KMGTPE"[exp])
}

// --- GSI permanent flash (fastboot) ----------------------------------------

type GsiFlashOpts struct {
	Fastbootd     bool   `json:"fastbootd"`     // reboot fastboot (fastbootd) first
	WipeData      bool   `json:"wipeData"`      // fastboot -w
	DisableVerity bool   `json:"disableVerity"` // flash vbmeta --disable-verification
	DeleteProduct bool   `json:"deleteProduct"` // free space: delete product_<slot>
	Slot          string `json:"slot"`          // "a" / "b" / "" (for delete-logical-partition)
	VbmetaPath    string `json:"vbmetaPath"`    // required if DisableVerity
	DryRun        bool   `json:"dryRun"`
}

type gsiStep struct {
	desc string
	args []string
}

func (a *App) gsiFlashSteps(imagePath string, opts GsiFlashOpts) []gsiStep {
	var steps []gsiStep
	if opts.Fastbootd {
		steps = append(steps, gsiStep{"Reboot to fastbootd", []string{"reboot", "fastboot"}})
	}
	if opts.DeleteProduct {
		part := "product"
		if opts.Slot != "" {
			part += "_" + opts.Slot
		}
		steps = append(steps, gsiStep{"Free space: delete " + part, []string{"delete-logical-partition", part}})
	}
	steps = append(steps,
		gsiStep{"Erase system", []string{"erase", "system"}},
		gsiStep{"Flash system", []string{"flash", "system", imagePath}},
	)
	if opts.WipeData {
		steps = append(steps, gsiStep{"Wipe userdata", []string{"-w"}})
	}
	if opts.DisableVerity && strings.TrimSpace(opts.VbmetaPath) != "" {
		steps = append(steps, gsiStep{"Flash vbmeta (disable verification)", []string{"--disable-verification", "flash", "vbmeta", opts.VbmetaPath}})
	}
	steps = append(steps, gsiStep{"Reboot", []string{"reboot"}})
	return steps
}

// FlashGsiSystem flashes a GSI to the system partition via fastboot. With
// DryRun, it returns the command list without executing. Otherwise it runs each
// step, gated behind the App Lock danger check.
func (a *App) FlashGsiSystem(imagePath string, opts GsiFlashOpts) (string, error) {
	imagePath = strings.TrimSpace(imagePath)
	if imagePath == "" {
		return "", fmt.Errorf("no GSI system image selected")
	}
	if !opts.DryRun {
		if info, err := os.Stat(imagePath); err != nil || info.IsDir() {
			return "", fmt.Errorf("image not found: %s", imagePath)
		}
	}
	steps := a.gsiFlashSteps(imagePath, opts)

	if opts.DryRun {
		var b strings.Builder
		for _, s := range steps {
			b.WriteString("fastboot " + strings.Join(s.args, " ") + "\n")
		}
		return b.String(), nil
	}

	if err := a.requireDangerUnlocked(); err != nil {
		return "", err
	}

	var out strings.Builder
	for _, s := range steps {
		out.WriteString("$ fastboot " + strings.Join(s.args, " ") + "\n")
		res, err := a.runCommandTimeout(10*time.Minute, "fastboot", s.args...)
		if strings.TrimSpace(res) != "" {
			out.WriteString(res + "\n")
		}
		if err != nil {
			return out.String(), fmt.Errorf("%s failed: %w", s.desc, err)
		}
		// fastbootd takes a few seconds to come up before it accepts commands.
		if len(s.args) == 2 && s.args[0] == "reboot" && s.args[1] == "fastboot" {
			time.Sleep(8 * time.Second)
		}
	}
	return out.String(), nil
}
