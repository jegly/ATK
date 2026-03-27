package main

import (
	"fmt"
	"sort"
	"strings"
)

type PropEntry struct {
	Key      string `json:"key"`
	Value    string `json:"value"`
	Category string `json:"category"`
}

// GetAllProps returns all system properties as structured entries.
func (a *App) GetAllProps() ([]PropEntry, error) {
	out, err := a.runAdbShell("getprop")
	if err != nil {
		return nil, fmt.Errorf("failed to get props: %w", err)
	}

	var props []PropEntry
	for _, line := range strings.Split(out, "\n") {
		line = strings.TrimSpace(line)
		if !strings.HasPrefix(line, "[") {
			continue
		}

		// Format: [key]: [value]
		line = strings.TrimPrefix(line, "[")
		parts := strings.SplitN(line, "]: [", 2)
		if len(parts) != 2 {
			continue
		}

		key := parts[0]
		value := strings.TrimSuffix(parts[1], "]")

		props = append(props, PropEntry{
			Key:      key,
			Value:    value,
			Category: categorizeProp(key),
		})
	}

	sort.Slice(props, func(i, j int) bool {
		return props[i].Key < props[j].Key
	})

	return props, nil
}

// SetProp sets a system property value.
// Note: many system props are read-only and require root to change.
func (a *App) SetProp(key, value string) (string, error) {
	if key == "" {
		return "", fmt.Errorf("key cannot be empty")
	}
	// Validate key characters
	for _, ch := range key {
		if ch == ';' || ch == '&' || ch == '|' || ch == '`' || ch == '$' || ch == '\n' {
			return "", fmt.Errorf("invalid character in property key")
		}
	}

	// Try setprop first (works for some props without root)
	_, err := a.runAdbShell("setprop", key, value)
	if err != nil {
		// Try with root
		_, err2 := a.runAdbShell("su", "-c", fmt.Sprintf("setprop %s %s", key, value))
		if err2 != nil {
			return "", fmt.Errorf("failed to set prop (may be read-only or need root): %w", err)
		}
	}

	// Verify
	newVal, _ := a.runAdbShell("getprop", key)
	return fmt.Sprintf("Set %s = %s", key, strings.TrimSpace(newVal)), nil
}

// GetProp gets a single property value.
func (a *App) GetProp(key string) (string, error) {
	if key == "" {
		return "", fmt.Errorf("key cannot be empty")
	}
	out, err := a.runAdbShell("getprop", key)
	if err != nil {
		return "", err
	}
	return strings.TrimSpace(out), nil
}

// categorizeProp assigns a category to a property based on its key prefix.
func categorizeProp(key string) string {
	switch {
	case strings.HasPrefix(key, "ro.build"):
		return "Build"
	case strings.HasPrefix(key, "ro.product"):
		return "Product"
	case strings.HasPrefix(key, "ro.boot"):
		return "Boot"
	case strings.HasPrefix(key, "ro.hardware"):
		return "Hardware"
	case strings.HasPrefix(key, "ro.crypto"):
		return "Security"
	case strings.HasPrefix(key, "ro.debuggable") ||
		strings.HasPrefix(key, "service.adb"):
		return "Debug"
	case strings.HasPrefix(key, "persist."):
		return "Persist"
	case strings.HasPrefix(key, "sys."):
		return "System"
	case strings.HasPrefix(key, "net.") ||
		strings.HasPrefix(key, "dhcp.") ||
		strings.HasPrefix(key, "wifi."):
		return "Network"
	case strings.HasPrefix(key, "gsm.") ||
		strings.HasPrefix(key, "ril.") ||
		strings.HasPrefix(key, "telephony."):
		return "Telephony"
	case strings.HasPrefix(key, "dalvik."):
		return "Dalvik/ART"
	case strings.HasPrefix(key, "init."):
		return "Init"
	case strings.HasPrefix(key, "dev."):
		return "Device"
	case strings.HasPrefix(key, "audio.") ||
		strings.HasPrefix(key, "media."):
		return "Media"
	case strings.HasPrefix(key, "camera."):
		return "Camera"
	case strings.HasPrefix(key, "bluetooth."):
		return "Bluetooth"
	default:
		return "Other"
	}
}
