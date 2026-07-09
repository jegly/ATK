package main

import (
	"context"
	"sync"
	"time"

	"github.com/wailsapp/wails/v2/pkg/runtime"
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
	// IsInstalled is false when the package is present on the system image but
	// uninstalled for user 0 (e.g. via `pm uninstall --user 0`, which is what
	// Canta/Shizuku do to "remove" a system app). Such packages are still on
	// disk and show up in `pm list packages -u`, but not in the plain listing.
	IsInstalled bool `json:"isInstalled"`
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

	// app-lock "require password for destructive actions" session window
	dangerMu    sync.Mutex
	dangerUntil time.Time

	// window visibility, tracked for the tray's show/hide toggle
	windowMu    sync.Mutex
	windowShown bool
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
	a.windowShown = true
	// Frameless windows can open off-centre on some WMs; centre on launch.
	runtime.WindowCenter(ctx)
	initTray(a)
}

// Shutdown is called when the app is closing — tidy up spawned child processes
// (e.g. a scrcpy mirror) so they don't outlive the app as orphan windows.
// Exception: a mirror started in "detached" mode is left running on purpose.
func (a *App) Shutdown(ctx context.Context) {
	scrcpyMu.Lock()
	detached := scrcpyDetached
	scrcpyMu.Unlock()
	if !detached {
		a.StopScrcpy()
	}
	closeTray()
}

// ShowWindow restores the main window - used by the tray's "Show ATK" /
// left-click action and by the frontend's "Minimize to tray" quit dialog.
func (a *App) ShowWindow() {
	a.windowMu.Lock()
	a.windowShown = true
	a.windowMu.Unlock()
	runtime.WindowShow(a.ctx)
	runtime.WindowUnminimise(a.ctx)
}

// HideWindow parks the window (app keeps running, reachable from the tray).
func (a *App) HideWindow() {
	a.windowMu.Lock()
	a.windowShown = false
	a.windowMu.Unlock()
	runtime.WindowHide(a.ctx)
}

// ToggleWindow shows the window if hidden, hides it if shown - the tray's
// left-click / "Show ATK" menu action.
func (a *App) ToggleWindow() {
	a.windowMu.Lock()
	shown := a.windowShown
	a.windowMu.Unlock()
	if shown {
		a.HideWindow()
	} else {
		a.ShowWindow()
	}
}

// TrayAvailable reports whether a real system tray icon was registered (e.g.
// false on Linux if no StatusNotifierWatcher/AppIndicator host is running).
// The frontend uses this to decide whether "Minimize to tray" is even a
// sensible option to offer in the close-confirmation dialog.
func (a *App) TrayAvailable() bool {
	return trayAvailable()
}

// QuitApp fully quits ATK (not just the window) - used by both the tray's
// "Quit ATK" menu item and the frontend's close-confirmation dialog.
func (a *App) QuitApp() {
	runtime.Quit(a.ctx)
}

// OpenURL opens a link in the user's default system browser. A bare <a
// target="_blank"> isn't reliable inside the embedded webview - this is
// Wails' supported way to hand off to the OS.
func (a *App) OpenURL(url string) {
	runtime.BrowserOpenURL(a.ctx, url)
}
