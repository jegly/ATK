package main

import (
	"bytes"
	"fmt"
	"os"
	"os/exec"
	"strconv"
	"strings"
	"sync"
	"time"

	"github.com/wailsapp/wails/v2/pkg/runtime"
)

// Screen mirroring via scrcpy. We don't embed scrcpy's video (that would mean
// reimplementing its client); instead we launch the system scrcpy, which opens
// its own movable/resizable window with full touch+keyboard control. ATK is the
// control panel: options + start/stop, and a scrcpy:stopped event when its
// window closes so the UI can reset.

type ScrcpyOptions struct {
	MaxSize       int  `json:"maxSize"`     // longest edge in px; 0 = original
	BitRateMbps   int  `json:"bitRateMbps"` // video bitrate in Mbps
	MaxFps        int  `json:"maxFps"`      // 0 = unlimited
	StayAwake     bool `json:"stayAwake"`
	TurnScreenOff bool `json:"turnScreenOff"`
	ShowTouches   bool `json:"showTouches"`
	AlwaysOnTop   bool `json:"alwaysOnTop"`
	Fullscreen    bool `json:"fullscreen"`
	Borderless    bool   `json:"borderless"` // hide the WM title bar / decorations
	Record        bool   `json:"record"`
	Detached      bool   `json:"detached"` // keep the mirror alive after ATK closes
	NoAudio       bool   `json:"noAudio"`
	ViewOnly      bool   `json:"viewOnly"`    // --no-control
	VideoCodec    string `json:"videoCodec"`  // "", h264, h265, av1
	Orientation   string `json:"orientation"` // "", 0, 90, 180, 270
}

var (
	scrcpyMu       sync.Mutex
	scrcpyCmd      *exec.Cmd
	scrcpyDetached bool
)

// ScrcpyAvailable returns the scrcpy version string, or an error if not found.
func (a *App) ScrcpyAvailable() (string, error) {
	p, err := exec.LookPath("scrcpy")
	if err != nil {
		return "", fmt.Errorf("scrcpy not found — install with: sudo apt install scrcpy")
	}
	out, err := exec.Command(p, "--version").Output()
	if err != nil {
		return "scrcpy", nil
	}
	return strings.TrimSpace(strings.SplitN(string(out), "\n", 2)[0]), nil
}

// ScrcpyRunning reports whether ATK is currently managing a mirror it launched.
// We deliberately track only our own process (not a system-wide scrcpy scan):
// scanning produced false "Stop" states from processes caught mid-exit, and the
// view never re-polled. A fresh launch always shows Start.
func (a *App) ScrcpyRunning() bool {
	scrcpyMu.Lock()
	defer scrcpyMu.Unlock()
	return scrcpyCmd != nil
}

// StartScrcpy launches scrcpy in its own window with the given options.
func (a *App) StartScrcpy(opts ScrcpyOptions) error {
	scrcpyMu.Lock()
	tracked := scrcpyCmd != nil
	scrcpyMu.Unlock()
	if tracked {
		return fmt.Errorf("a mirror is already running")
	}

	p, err := exec.LookPath("scrcpy")
	if err != nil {
		return fmt.Errorf("scrcpy not found — install with: sudo apt install scrcpy")
	}

	// Empty title so the WM title bar shows no text. (Omitting --window-title
	// would make scrcpy fall back to the device model name, which is still text.)
	args := []string{"--window-title", ""}
	if opts.Borderless {
		args = append(args, "--window-borderless")
	}
	if opts.MaxSize > 0 {
		args = append(args, "--max-size", strconv.Itoa(opts.MaxSize))
	}
	if opts.BitRateMbps > 0 {
		args = append(args, "--video-bit-rate", strconv.Itoa(opts.BitRateMbps)+"M")
	}
	if opts.MaxFps > 0 {
		args = append(args, "--max-fps", strconv.Itoa(opts.MaxFps))
	}
	if opts.StayAwake {
		args = append(args, "--stay-awake")
	}
	if opts.TurnScreenOff {
		args = append(args, "--turn-screen-off")
	}
	if opts.ShowTouches {
		args = append(args, "--show-touches")
	}
	if opts.AlwaysOnTop {
		args = append(args, "--always-on-top")
	}
	if opts.Fullscreen {
		args = append(args, "--fullscreen")
	}
	if opts.NoAudio {
		args = append(args, "--no-audio")
	}
	if opts.ViewOnly {
		args = append(args, "--no-control")
	}
	if opts.VideoCodec != "" {
		args = append(args, "--video-codec="+opts.VideoCodec)
	}
	if opts.Orientation != "" {
		args = append(args, "--capture-orientation="+opts.Orientation)
	}
	if opts.Record {
		path, derr := a.SelectSaveFile("scrcpy-recording.mp4")
		if derr != nil {
			return fmt.Errorf("save dialog failed: %w", derr)
		}
		if path == "" {
			return fmt.Errorf("recording cancelled")
		}
		args = append(args, "--record", path)
	}

	// Clean up any orphan mirror (e.g. left over from a crash/hard-kill of a
	// previous ATK) so Start always yields exactly one window, never a stack.
	if pk, perr := exec.LookPath("pkill"); perr == nil {
		exec.Command(pk, "-x", "scrcpy").Run()
	}

	cmd := exec.Command(p, args...)
	setCommandSysProcAttr(cmd)
	// Inherit the desktop session (DISPLAY/WAYLAND_DISPLAY) and point scrcpy at
	// the same adb ATK resolved, so it doesn't depend on adb being on PATH.
	env := os.Environ()
	if adbPath, aerr := a.getBinaryPath("adb"); aerr == nil {
		env = append(env, "ADB="+adbPath)
	}
	cmd.Env = env

	if err := cmd.Start(); err != nil {
		return fmt.Errorf("failed to start scrcpy: %w", err)
	}

	scrcpyMu.Lock()
	scrcpyCmd = cmd
	scrcpyDetached = opts.Detached
	scrcpyMu.Unlock()

	// Reap the process and tell the UI when the window is closed.
	go func() {
		cmd.Wait()
		scrcpyMu.Lock()
		scrcpyCmd = nil
		scrcpyDetached = false
		scrcpyMu.Unlock()
		runtime.EventsEmit(a.ctx, "scrcpy:stopped", nil)
	}()

	return nil
}

// CaptureScreenshot grabs the device's current screen as a PNG and saves it to
// a user-chosen path. Independent of scrcpy — works whenever a device is
// connected. Uses `adb exec-out screencap -p` (raw bytes, no CRLF mangling).
// Returns the saved path, or "" if the user cancelled the save dialog.
func (a *App) CaptureScreenshot() (string, error) {
	adbPath, err := a.getBinaryPath("adb")
	if err != nil {
		return "", err
	}

	cmd := exec.Command(adbPath, "exec-out", "screencap", "-p")
	setCommandSysProcAttr(cmd)
	var out, errb bytes.Buffer
	cmd.Stdout = &out
	cmd.Stderr = &errb
	if err := cmd.Run(); err != nil {
		msg := strings.TrimSpace(errb.String())
		if msg == "" {
			msg = err.Error()
		}
		return "", fmt.Errorf("%s", msg)
	}
	if out.Len() == 0 {
		return "", fmt.Errorf("no screen data — is a device connected and unlocked?")
	}

	path, err := a.SelectSaveFile("screenshot-" + time.Now().Format("20060102-150405") + ".png")
	if err != nil {
		return "", err
	}
	if path == "" {
		return "", nil
	}
	if err := os.WriteFile(path, out.Bytes(), 0o644); err != nil {
		return "", fmt.Errorf("failed to save: %w", err)
	}
	return path, nil
}

// StopScrcpy terminates the running mirror session (closes the scrcpy window).
func (a *App) StopScrcpy() error {
	scrcpyMu.Lock()
	cmd := scrcpyCmd
	scrcpyMu.Unlock()
	if cmd != nil && cmd.Process != nil {
		return cmd.Process.Kill()
	}
	// No tracked handle — kill a leftover/orphan scrcpy by name.
	if p, err := exec.LookPath("pkill"); err == nil {
		exec.Command(p, "-x", "scrcpy").Run()
	}
	return nil
}
