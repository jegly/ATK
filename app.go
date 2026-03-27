package main

import (
	"context"
	"sync"
)

// DeviceMode represents whether a device is in ADB or Fastboot mode
type DeviceMode string

const (
	DeviceModeUnknown  DeviceMode = "unknown"
	DeviceModeADB      DeviceMode = "adb"
	DeviceModeFastboot DeviceMode = "fastboot"
)

// Device represents a connected ADB device
type Device struct {
	Serial string `json:"serial"`
	Status string `json:"status"`
}

// DeviceInfo holds detailed information about a connected device
type DeviceInfo struct {
	Model             string `json:"model"`
	AndroidVersion    string `json:"androidVersion"`
	BuildNumber       string `json:"buildNumber"`
	BatteryLevel      string `json:"batteryLevel"`
	Serial            string `json:"serial"`
	IPAddress         string `json:"ipAddress"`
	RootStatus        string `json:"rootStatus"`
	Codename          string `json:"codename"`
	RamTotal          string `json:"ramTotal"`
	StorageInfo       string `json:"storageInfo"`
	Brand             string `json:"brand"`
	DeviceName        string `json:"deviceName"`
	SecurityPatch     string `json:"securityPatch"`
	Uptime            string `json:"uptime"`
	BootloaderStatus  string `json:"bootloaderStatus"`
	ScreenResolution  string `json:"screenResolution"`
	BasebandVersion   string `json:"basebandVersion"`
	KernelVersion     string `json:"kernelVersion"`
	CPUArch           string `json:"cpuArch"`
}

// FileEntry represents a file or directory on the device
type FileEntry struct {
	Name        string `json:"name"`
	Type        string `json:"type"`
	Size        string `json:"size"`
	Permissions string `json:"permissions"`
	Date        string `json:"date"`
	Time        string `json:"time"`
}

// PackageInfo represents an installed app package
type PackageInfo struct {
	PackageName string `json:"packageName"`
	IsEnabled   bool   `json:"isEnabled"`
}

// AdbConfig holds user-configurable ADB settings
type AdbConfig struct {
	AdbPath      string `json:"adbPath"`
	FastbootPath string `json:"fastbootPath"`
}

// App is the main application struct
type App struct {
	ctx    context.Context
	config AdbConfig

	// binary path cache
	binaryCache map[string]string
	cacheMutex  sync.RWMutex

	// cancellation for long-running ops
	currentCancel context.CancelFunc
	opMutex       sync.Mutex
}

// NewApp creates a new App instance
func NewApp() *App {
	return &App{
		binaryCache: make(map[string]string),
		config:      AdbConfig{},
	}
}

// Startup is called when the app starts
func (a *App) Startup(ctx context.Context) {
	a.ctx = ctx
}
