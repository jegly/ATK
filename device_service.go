package main

import (
	"fmt"
	"regexp"
	"strconv"
	"strings"
	"sync"
)

// GetDevices returns all connected ADB devices.
func (a *App) GetDevices() ([]Device, error) {
	output, err := a.runCommand("adb", "devices")
	if err != nil {
		return nil, err
	}

	var devices []Device
	lines := strings.Split(output, "\n")

	// First line is "List of devices attached" header
	for _, line := range lines[1:] {
		line = strings.TrimSpace(line)
		if line == "" {
			continue
		}
		parts := strings.Fields(line)
		if len(parts) >= 2 {
			devices = append(devices, Device{
				Serial: parts[0],
				Status: parts[1],
			})
		}
	}

	return devices, nil
}

// getProp fetches a single Android system property.
// Uses shell getprop with the property name as a discrete argument - safe.
func (a *App) getProp(prop string) string {
	// prop is passed as a discrete arg - no shell injection possible
	output, err := a.runAdbShell("getprop", prop)
	if err != nil {
		return "N/A"
	}
	v := strings.TrimSpace(output)
	if v == "" {
		return "N/A"
	}
	return v
}

// checkRootStatus checks if the device is rooted by attempting `su -c id`.
func (a *App) checkRootStatus() string {
	// "su", "-c", "id" are all discrete args
	output, err := a.runAdbShell("su", "-c", "id")
	if err == nil && strings.TrimSpace(output) == "0" {
		return "Rooted"
	}

	// Try alternative: check if su binary exists
	suCheck, err := a.runAdbShell("which", "su")
	if err == nil && strings.TrimSpace(suCheck) != "" {
		return "Rooted (su present)"
	}

	return "Not rooted"
}

// getIPAddress retrieves the device WiFi IP address.
func (a *App) getIPAddress() string {
	// Use ip addr show wlan0 - args are discrete
	output, err := a.runAdbShell("ip", "addr", "show", "wlan0")
	if err == nil {
		re := regexp.MustCompile(`inet (\d+\.\d+\.\d+\.\d+)/\d+`)
		if m := re.FindStringSubmatch(output); len(m) > 1 {
			return m[1]
		}
	}

	// Fallback: dhcp property
	ip := a.getProp("dhcp.wlan0.ipaddress")
	if ip != "N/A" && ip != "" {
		return ip
	}

	return "N/A"
}

// getRamInfo returns total RAM as a formatted string.
func (a *App) getRamInfo() string {
	// cat /proc/meminfo - path is a constant, safe discrete arg
	output, err := a.runAdbShell("cat", "/proc/meminfo")
	if err != nil {
		return "N/A"
	}

	re := regexp.MustCompile(`MemTotal:\s*(\d+)\s*kB`)
	m := re.FindStringSubmatch(output)
	if len(m) < 2 {
		return "N/A"
	}

	kb, err := strconv.ParseFloat(m[1], 64)
	if err != nil {
		return "N/A"
	}

	return fmt.Sprintf("%.1f GB", kb/1024/1024)
}

// getStorageInfo returns used/total storage for /data.
func (a *App) getStorageInfo() string {
	// df with /data as discrete arg
	output, err := a.runAdbShell("df", "/data")
	if err != nil {
		return "N/A"
	}

	lines := strings.Split(output, "\n")
	if len(lines) < 2 {
		return "N/A"
	}

	fields := strings.Fields(lines[1])
	if len(fields) < 4 {
		return "N/A"
	}

	totalKB, err1 := strconv.ParseFloat(fields[1], 64)
	usedKB, err2 := strconv.ParseFloat(fields[2], 64)
	if err1 != nil || err2 != nil {
		return "N/A"
	}

	return fmt.Sprintf("%.1f GB / %.1f GB", usedKB/1024/1024, totalKB/1024/1024)
}

// getBatteryLevel returns the current battery percentage.
func (a *App) getBatteryLevel() string {
	// dumpsys battery - tool and subcommand as discrete args
	output, err := a.runAdbShell("dumpsys", "battery")
	if err != nil {
		return "N/A"
	}

	re := regexp.MustCompile(`level:\s*(\d+)`)
	m := re.FindStringSubmatch(output)
	if len(m) > 1 {
		return m[1] + "%"
	}
	return "N/A"
}

// getScreenResolution returns the device screen resolution.
func (a *App) getScreenResolution() string {
	// wm size - tool and subcommand as discrete args
	output, err := a.runAdbShell("wm", "size")
	if err != nil {
		return "N/A"
	}

	re := regexp.MustCompile(`Physical size:\s*(\d+x\d+)`)
	m := re.FindStringSubmatch(output)
	if len(m) > 1 {
		return m[1]
	}
	return "N/A"
}

// getUptime returns the device uptime in human-readable form.
func (a *App) getUptime() string {
	// cat /proc/uptime - constant path, safe
	output, err := a.runAdbShell("cat", "/proc/uptime")
	if err != nil {
		return "N/A"
	}

	parts := strings.Fields(output)
	if len(parts) == 0 {
		return "N/A"
	}

	seconds, err := strconv.ParseFloat(parts[0], 64)
	if err != nil {
		return "N/A"
	}

	days := int(seconds) / 86400
	hours := (int(seconds) % 86400) / 3600
	mins := (int(seconds) % 3600) / 60

	if days > 0 {
		return fmt.Sprintf("%dd %dh %dm", days, hours, mins)
	}
	if hours > 0 {
		return fmt.Sprintf("%dh %dm", hours, mins)
	}
	return fmt.Sprintf("%dm", mins)
}

// getKernelVersion returns the Linux kernel version.
func (a *App) getKernelVersion() string {
	// uname -r - tool and flag as discrete args
	output, err := a.runAdbShell("uname", "-r")
	if err != nil {
		return "N/A"
	}
	return strings.TrimSpace(output)
}

// getCPUArch returns the device CPU architecture.
func (a *App) getCPUArch() string {
	return a.getProp("ro.product.cpu.abi")
}

// GetDeviceInfo fetches all device information concurrently.
func (a *App) GetDeviceInfo() (DeviceInfo, error) {
	var info DeviceInfo
	var wg sync.WaitGroup
	var mu sync.Mutex

	// Simple props fetched concurrently
	propJobs := []struct {
		prop   string
		setter func(string)
	}{
		{"ro.product.model", func(v string) { info.Model = v }},
		{"ro.build.version.release", func(v string) { info.AndroidVersion = v }},
		{"ro.build.id", func(v string) { info.BuildNumber = v }},
		{"ro.product.device", func(v string) { info.Codename = v }},
		{"ro.product.brand", func(v string) { info.Brand = v }},
		{"ro.product.name", func(v string) { info.DeviceName = v }},
		{"ro.build.version.security_patch", func(v string) { info.SecurityPatch = v }},
		{"ro.bootloader", func(v string) { info.BootloaderStatus = v }},
		{"gsm.version.baseband", func(v string) { info.BasebandVersion = v }},
		{"ro.product.cpu.abi", func(v string) { info.CPUArch = v }},
	}

	for _, job := range propJobs {
		wg.Add(1)
		go func(prop string, setter func(string)) {
			defer wg.Done()
			val := a.getProp(prop)
			mu.Lock()
			setter(val)
			mu.Unlock()
		}(job.prop, job.setter)
	}

	// Complex getters
	complexJobs := []struct {
		fn     func() string
		setter func(string)
	}{
		{a.getIPAddress, func(v string) { info.IPAddress = v }},
		{a.checkRootStatus, func(v string) { info.RootStatus = v }},
		{a.getRamInfo, func(v string) { info.RamTotal = v }},
		{a.getStorageInfo, func(v string) { info.StorageInfo = v }},
		{a.getBatteryLevel, func(v string) { info.BatteryLevel = v }},
		{a.getScreenResolution, func(v string) { info.ScreenResolution = v }},
		{a.getUptime, func(v string) { info.Uptime = v }},
		{a.getKernelVersion, func(v string) { info.KernelVersion = v }},
	}

	for _, job := range complexJobs {
		wg.Add(1)
		go func(fn func() string, setter func(string)) {
			defer wg.Done()
			val := fn()
			mu.Lock()
			setter(val)
			mu.Unlock()
		}(job.fn, job.setter)
	}

	// Serial number
	wg.Add(1)
	go func() {
		defer wg.Done()
		serial, err := a.runCommand("adb", "get-serialno")
		mu.Lock()
		if err == nil {
			info.Serial = strings.TrimSpace(serial)
		} else {
			info.Serial = a.getProp("ro.serialno")
		}
		mu.Unlock()
	}()

	wg.Wait()

	return info, nil
}

// detectDeviceMode checks whether the device is in ADB or Fastboot mode.
func (a *App) detectDeviceMode() (DeviceMode, error) {
	adbDevices, adbErr := a.GetDevices()
	if adbErr == nil {
		for _, d := range adbDevices {
			switch strings.ToLower(strings.TrimSpace(d.Status)) {
			case "device", "recovery", "sideload":
				return DeviceModeADB, nil
			}
		}
	}

	fbDevices, fbErr := a.GetFastbootDevices()
	if fbErr == nil && len(fbDevices) > 0 {
		return DeviceModeFastboot, nil
	}

	if adbErr != nil && fbErr != nil {
		return DeviceModeUnknown, fmt.Errorf("no device: adb: %v; fastboot: %v", adbErr, fbErr)
	}

	return DeviceModeUnknown, nil
}

// GetDeviceMode returns the current device connection mode as a string.
func (a *App) GetDeviceMode() (string, error) {
	mode, err := a.detectDeviceMode()
	return string(mode), err
}

// Reboot reboots the device into the specified mode.
// mode can be: "" (normal), "recovery", "bootloader", "fastboot", "sideload"
func (a *App) Reboot(mode string) error {
	mode = strings.TrimSpace(mode)

	// Validate mode against known values - no arbitrary strings
	validModes := map[string]bool{
		"":           true,
		"recovery":   true,
		"bootloader": true,
		"fastboot":   true,
		"sideload":   true,
	}
	if !validModes[mode] {
		return fmt.Errorf("invalid reboot mode: %q", mode)
	}

	connectionMode, err := a.detectDeviceMode()
	if err != nil {
		return err
	}

	switch connectionMode {
	case DeviceModeADB:
		args := []string{"reboot"}
		if mode != "" {
			args = append(args, mode)
		}
		_, err := a.runCommand("adb", args...)
		return err

	case DeviceModeFastboot:
		if mode == "bootloader" {
			_, err := a.runCommand("fastboot", "reboot-bootloader")
			return err
		}
		args := []string{"reboot"}
		if mode != "" {
			args = append(args, mode)
		}
		_, err := a.runCommand("fastboot", args...)
		return err

	default:
		return fmt.Errorf("no device connected in ADB or Fastboot mode")
	}
}
