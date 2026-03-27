package main

import (
	"fmt"
	"regexp"
	"strings"
)

// EnableWirelessAdb switches ADB to TCP/IP mode on the given port.
func (a *App) EnableWirelessAdb(port string) (string, error) {
	if port == "" {
		port = "5555"
	}
	if err := validatePort(port); err != nil {
		return "", err
	}
	// adb tcpip <port> - all discrete args
	output, err := a.runCommand("adb", "tcpip", port)
	if err != nil {
		return "", fmt.Errorf("failed to enable wireless ADB (is device connected via USB?): %w", err)
	}
	return output, nil
}

// ConnectWirelessAdb connects to a device over TCP/IP.
func (a *App) ConnectWirelessAdb(ipAddress, port string) (string, error) {
	if port == "" {
		port = "5555"
	}
	if err := validateIP(ipAddress); err != nil {
		return "", err
	}
	if err := validatePort(port); err != nil {
		return "", err
	}

	address := ipAddress + ":" + port
	// adb connect <address> - discrete args
	output, err := a.runCommand("adb", "connect", address)
	if err != nil {
		return "", fmt.Errorf("connect failed: %w", err)
	}

	clean := strings.TrimSpace(output)
	if strings.Contains(clean, "connected to") || strings.Contains(clean, "already connected") {
		return clean, nil
	}
	if clean == "" {
		return "", fmt.Errorf("no response from device — check IP and port")
	}
	return "", fmt.Errorf("%s", clean)
}

// DisconnectWirelessAdb disconnects from a TCP/IP ADB connection.
func (a *App) DisconnectWirelessAdb(ipAddress, port string) (string, error) {
	if port == "" {
		port = "5555"
	}
	if err := validateIP(ipAddress); err != nil {
		return "", err
	}

	address := ipAddress + ":" + port
	// adb disconnect <address> - discrete args
	output, err := a.runCommand("adb", "disconnect", address)
	if err != nil {
		// Try without port
		output, err = a.runCommand("adb", "disconnect", ipAddress)
		if err != nil {
			return "", fmt.Errorf("disconnect failed: %w", err)
		}
	}

	clean := strings.TrimSpace(output)
	if clean == "" {
		return fmt.Sprintf("Disconnected from %s", address), nil
	}
	return clean, nil
}

// GetFastbootDevices lists devices connected in fastboot mode.
func (a *App) GetFastbootDevices() ([]Device, error) {
	output, err := a.runCommand("fastboot", "devices")
	if err != nil {
		return nil, err
	}

	var devices []Device
	for _, line := range strings.Split(output, "\n") {
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

// FlashPartition flashes an image file to a named partition via fastboot.
// partition is validated against known partition names.
// filePath is a discrete arg.
func (a *App) FlashPartition(partition, filePath string) (string, error) {
	if err := validatePartitionName(partition); err != nil {
		return "", err
	}
	// fastboot flash <partition> <file> - all discrete args
	output, err := a.runCommand("fastboot", "flash", partition, filePath)
	if err != nil {
		return "", fmt.Errorf("flash failed: %w", err)
	}
	return output, nil
}

// FastbootOemCommand runs an OEM-specific fastboot command.
// Used for device-specific unlock/lock operations.
func (a *App) FastbootOemCommand(subcommand string) (string, error) {
	validOemCmds := map[string]bool{
		"unlock":         true,
		"lock":           true,
		"device-info":    true,
		"get-identifier": true,
	}
	if !validOemCmds[strings.ToLower(subcommand)] {
		return "", fmt.Errorf("unsupported OEM command: %q", subcommand)
	}
	output, err := a.runCommand("fastboot", "oem", subcommand)
	if err != nil {
		return "", fmt.Errorf("oem %s failed: %w", subcommand, err)
	}
	return output, nil
}

// FastbootGetVar retrieves a fastboot variable.
func (a *App) FastbootGetVar(variable string) (string, error) {
	output, err := a.runCommand("fastboot", "getvar", variable)
	if err != nil {
		return "", fmt.Errorf("getvar %s failed: %w", variable, err)
	}
	return output, nil
}

// validateIP checks that an IP address looks valid.
func validateIP(ip string) error {
	ip = strings.TrimSpace(ip)
	if ip == "" {
		return fmt.Errorf("IP address cannot be empty")
	}
	re := regexp.MustCompile(`^\d{1,3}\.\d{1,3}\.\d{1,3}\.\d{1,3}$`)
	if !re.MatchString(ip) {
		return fmt.Errorf("invalid IP address: %q", ip)
	}
	return nil
}

// validatePort checks that a port string is a valid port number.
func validatePort(port string) error {
	port = strings.TrimSpace(port)
	if port == "" {
		return fmt.Errorf("port cannot be empty")
	}
	re := regexp.MustCompile(`^\d{1,5}$`)
	if !re.MatchString(port) {
		return fmt.Errorf("invalid port: %q", port)
	}
	return nil
}

// validatePartitionName checks that a partition name is in the known safe list.
// This prevents flashing to arbitrary "partition" names that could be shell tricks.
func validatePartitionName(name string) error {
	knownPartitions := map[string]bool{
		"boot":        true,
		"recovery":    true,
		"system":      true,
		"vendor":      true,
		"vendor_boot": true,
		"userdata":    true,
		"cache":       true,
		"dtbo":        true,
		"vbmeta":      true,
		"vbmeta_system": true,
		"super":       true,
		"product":     true,
		"odm":         true,
		"radio":       true,
		"bootloader":  true,
		"modem":       true,
	}
	if !knownPartitions[strings.ToLower(name)] {
		return fmt.Errorf("unknown partition %q — not in safe list", name)
	}
	return nil
}
