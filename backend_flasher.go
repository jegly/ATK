package main

import (
	"bytes"
	"fmt"
	"os/exec"
	"strings"
	"time"
)

// Phase 1 flasher capabilities (PixelFlasher-inspired): live-boot, slot-aware
// boot flashing, bootloader lock controls, fastboot reboot, and a unified
// device-info panel that works in both adb and fastboot modes.

var validSlots = map[string]bool{"": true, "a": true, "b": true, "all": true}

// FlasherInfo is the device summary shown at the top of the Flasher view.
type FlasherInfo struct {
	Connection   string `json:"connection"` // adb | fastboot | none
	Serial       string `json:"serial"`
	Slot         string `json:"slot"`
	Bootloader   string `json:"bootloader"`
	Fingerprint  string `json:"fingerprint"`
	AndroidVer   string `json:"androidVer"`
	Codename     string `json:"codename"`
	LockState    string `json:"lockState"`    // locked | unlocked | unknown
	VerifiedBoot string `json:"verifiedBoot"`
	Root         string `json:"root"`
}

// FastbootBoot live-boots an image without flashing (great for testing a
// patched/custom boot or recovery): fastboot boot <img>.
func (a *App) FastbootBoot(filePath string) (string, error) {
	if strings.TrimSpace(filePath) == "" {
		return "", fmt.Errorf("no image selected")
	}
	out, err := a.runCommandTimeout(5*time.Minute, "fastboot", "boot", filePath)
	if err != nil {
		return "", fmt.Errorf("live boot failed: %w", err)
	}
	return out, nil
}

// FlashBootImage flashes an image to a (safe-listed) partition, optionally to a
// specific slot, optionally with --force. slot ∈ {"", "a", "b", "all"}.
func (a *App) FlashBootImage(partition, filePath, slot string, force bool) (string, error) {
	if err := a.requireDangerUnlocked(); err != nil {
		return "", err
	}
	if err := validatePartitionName(partition); err != nil {
		return "", err
	}
	if !validSlots[slot] {
		return "", fmt.Errorf("invalid slot %q", slot)
	}
	if strings.TrimSpace(filePath) == "" {
		return "", fmt.Errorf("no image selected")
	}
	args := []string{}
	if force {
		args = append(args, "--force")
	}
	if slot != "" {
		args = append(args, "--slot", slot)
	}
	args = append(args, "flash", partition, filePath)
	out, err := a.runCommandTimeout(10*time.Minute, "fastboot", args...)
	if err != nil {
		return "", fmt.Errorf("flash failed: %w", err)
	}
	return out, nil
}

// FastbootFlashing runs `fastboot flashing <action>` to change bootloader lock
// state. Unlocking/locking wipes the device and requires on-screen confirmation.
func (a *App) FastbootFlashing(action string) (string, error) {
	if err := a.requireDangerUnlocked(); err != nil {
		return "", err
	}
	valid := map[string]bool{
		"unlock": true, "lock": true,
		"unlock_critical": true, "lock_critical": true,
		"get_unlock_ability": true,
	}
	if !valid[action] {
		return "", fmt.Errorf("unsupported flashing action %q", action)
	}
	out, err := a.runCommandTimeout(2*time.Minute, "fastboot", "flashing", action)
	if err != nil {
		return "", fmt.Errorf("flashing %s failed: %w", action, err)
	}
	if strings.TrimSpace(out) == "" {
		out = "Sent. Confirm on the device screen if prompted (use volume keys + power)."
	}
	return out, nil
}

// FastbootReboot reboots a device that's in fastboot/bootloader mode.
// target ∈ {"", "bootloader", "fastboot" (fastbootd), "recovery"}.
func (a *App) FastbootReboot(target string) (string, error) {
	valid := map[string]bool{"": true, "bootloader": true, "fastboot": true, "recovery": true}
	if !valid[target] {
		return "", fmt.Errorf("invalid reboot target %q", target)
	}
	args := []string{"reboot"}
	if target != "" {
		args = append(args, target)
	}
	out, err := a.runCommand("fastboot", args...)
	if err != nil {
		return "", fmt.Errorf("reboot failed: %w", err)
	}
	return out, nil
}

// FlasherDeviceInfo returns a unified device summary for whichever mode the
// device is currently in (adb or fastboot).
func (a *App) FlasherDeviceInfo() (FlasherInfo, error) {
	info := FlasherInfo{Connection: "none", LockState: "unknown"}
	mode, _ := a.detectDeviceMode()

	switch mode {
	case DeviceModeFastboot:
		info.Connection = "fastboot"
		vars := a.fastbootVars("current-slot", "version-bootloader", "product", "unlocked")
		info.Slot = vars["current-slot"]
		info.Bootloader = vars["version-bootloader"]
		info.Codename = vars["product"]
		switch vars["unlocked"] {
		case "yes":
			info.LockState = "unlocked"
		case "no":
			info.LockState = "locked"
		}
		if devs, _ := a.GetFastbootDevices(); len(devs) > 0 {
			info.Serial = devs[0].Serial
		}

	case DeviceModeADB:
		info.Connection = "adb"
		info.Slot = strings.TrimPrefix(a.getProp("ro.boot.slot_suffix"), "_")
		info.Bootloader = a.getProp("ro.bootloader")
		info.Fingerprint = a.getProp("ro.build.fingerprint")
		info.AndroidVer = a.getProp("ro.build.version.release")
		info.Codename = a.getProp("ro.product.device")
		info.VerifiedBoot = a.getProp("ro.boot.verifiedbootstate")
		switch a.getProp("ro.boot.flash.locked") {
		case "1":
			info.LockState = "locked"
		case "0":
			info.LockState = "unlocked"
		}
		if devs, _ := a.GetDevices(); len(devs) > 0 {
			info.Serial = devs[0].Serial
		}
		if su, _ := a.runAdbShell("which", "su"); strings.TrimSpace(su) != "" {
			info.Root = "su present"
		} else {
			info.Root = "none"
		}
	}
	return info, nil
}

// fastbootVars queries one or more fastboot variables. fastboot prints getvar
// results to stderr ("var: value"), so we capture combined output and parse it.
func (a *App) fastbootVars(keys ...string) map[string]string {
	res := map[string]string{}
	fb, err := a.getBinaryPath("fastboot")
	if err != nil {
		return res
	}
	for _, k := range keys {
		cmd := exec.Command(fb, "getvar", k)
		setCommandSysProcAttr(cmd)
		var buf bytes.Buffer
		cmd.Stdout = &buf
		cmd.Stderr = &buf
		cmd.Run()
		for _, line := range strings.Split(buf.String(), "\n") {
			if strings.HasPrefix(line, k+":") {
				res[k] = strings.TrimSpace(strings.TrimPrefix(line, k+":"))
				break
			}
		}
	}
	return res
}
