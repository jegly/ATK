package main

import (
	"bytes"
	"context"
	"crypto/sha256"
	"encoding/hex"
	"fmt"
	"io"
	"os"
	"os/exec"
	"path/filepath"
	"strings"
	"time"
)

const DefaultCommandTimeout = 60 * time.Second

// getBinaryPath resolves the path to a named binary (adb or fastboot).
// Priority order:
//  1. User-configured path in AdbConfig
//  2. System PATH (when user has adb installed via apt/sdk)
//  3. Local ./bin/linux/ directory (fallback)
//
// NEVER builds shell strings - always returns an absolute path
// suitable for use as the first argument to exec.Command.
func (a *App) getBinaryPath(name string) (string, error) {
	// Check user config first
	a.cacheMutex.RLock()
	if cached, ok := a.binaryCache[name]; ok {
		a.cacheMutex.RUnlock()
		return cached, nil
	}
	a.cacheMutex.RUnlock()

	var candidates []string

	// 1. User-configured explicit path
	switch name {
	case "adb":
		if a.config.AdbPath != "" {
			candidates = append(candidates, a.config.AdbPath)
		}
	case "fastboot":
		if a.config.FastbootPath != "" {
			candidates = append(candidates, a.config.FastbootPath)
		}
	}

	// 2. System PATH - preferred because user installed it from a trusted source
	if p, err := exec.LookPath(name); err == nil {
		candidates = append(candidates, p)
	}

	// 3. Local bin directory relative to executable
	exePath, err := os.Executable()
	if err == nil {
		installDir := filepath.Dir(exePath)
		candidates = append(candidates,
			filepath.Join(installDir, "bin", name),
			filepath.Join(installDir, "bin", "linux", name),
		)
	}

	// 4. Local bin relative to working directory
	candidates = append(candidates,
		filepath.Join(".", "bin", name),
		filepath.Join(".", "bin", "linux", name),
	)

	for _, candidate := range candidates {
		if candidate == "" {
			continue
		}
		info, err := os.Stat(candidate)
		if err != nil || info.IsDir() {
			continue
		}

		abs, err := filepath.Abs(candidate)
		if err != nil {
			continue
		}

		a.cacheMutex.Lock()
		a.binaryCache[name] = abs
		a.cacheMutex.Unlock()

		return abs, nil
	}

	return "", fmt.Errorf(
		"'%s' not found. Install with: sudo apt install adb fastboot\n"+
			"Or set a custom path in Settings.",
		name,
	)
}

// invalidateBinaryCache clears the cache so next call re-resolves paths.
// Called when user changes config paths.
func (a *App) invalidateBinaryCache() {
	a.cacheMutex.Lock()
	defer a.cacheMutex.Unlock()
	a.binaryCache = make(map[string]string)
}

// VerifyBinary returns the SHA-256 hash of the resolved binary so the user
// can verify it themselves against Google's published hashes.
// We deliberately do NOT hardcode expected hashes - versions change and
// we don't want to block legitimate upgrades.
func (a *App) VerifyBinary(name string) (string, error) {
	path, err := a.getBinaryPath(name)
	if err != nil {
		return "", err
	}

	f, err := os.Open(path)
	if err != nil {
		return "", fmt.Errorf("cannot open binary: %w", err)
	}
	defer f.Close()

	h := sha256.New()
	if _, err := io.Copy(h, f); err != nil {
		return "", fmt.Errorf("cannot hash binary: %w", err)
	}

	hash := hex.EncodeToString(h.Sum(nil))
	return fmt.Sprintf("path: %s\nsha256: %s", path, hash), nil
}

// runCommandContext executes a binary with the given arguments.
// SECURITY: args are NEVER joined into a shell string. Each arg is a discrete
// element passed directly to execve - no shell expansion, no injection possible.
func (a *App) runCommandContext(ctx context.Context, binary string, args ...string) (string, error) {
	binaryPath, err := a.getBinaryPath(binary)
	if err != nil {
		return "", err
	}

	cmd := exec.CommandContext(ctx, binaryPath, args...)
	setCommandSysProcAttr(cmd)

	var stdout, stderr bytes.Buffer
	cmd.Stdout = &stdout
	cmd.Stderr = &stderr

	if err := cmd.Run(); err != nil {
		if ctx.Err() == context.DeadlineExceeded {
			return "", fmt.Errorf("command timed out after %s", DefaultCommandTimeout)
		}
		if ctx.Err() == context.Canceled {
			return "", fmt.Errorf("cancelled")
		}

		errOut := strings.TrimSpace(stderr.String())
		if errOut == "" {
			errOut = err.Error()
		}

		// Translate common ADB error messages to human-readable form
		switch {
		case strings.Contains(errOut, "device offline"):
			return "", fmt.Errorf("device is offline — try reconnecting USB")
		case strings.Contains(errOut, "unauthorized"):
			return "", fmt.Errorf("unauthorized — accept the USB debugging prompt on your phone")
		case strings.Contains(errOut, "no devices/emulators found"):
			return "", fmt.Errorf("no device found — check USB connection and USB debugging is enabled")
		}

		return "", fmt.Errorf("%s", errOut)
	}

	return strings.TrimSpace(stdout.String()), nil
}

// runCommand runs a command with the default 60s timeout.
func (a *App) runCommand(binary string, args ...string) (string, error) {
	ctx, cancel := context.WithTimeout(context.Background(), DefaultCommandTimeout)
	defer cancel()
	return a.runCommandContext(ctx, binary, args...)
}

// runCommandTimeout runs a command with a custom timeout.
func (a *App) runCommandTimeout(timeout time.Duration, binary string, args ...string) (string, error) {
	ctx, cancel := context.WithTimeout(context.Background(), timeout)
	defer cancel()
	return a.runCommandContext(ctx, binary, args...)
}

// runAdbShell runs `adb shell <args...>` where each arg is a discrete argument.
// SECURITY: Never use this with a pre-built shell string. Always pass individual args.
// Example: runAdbShell("ls", "-la", "/sdcard") NOT runAdbShell("ls -la /sdcard")
func (a *App) runAdbShell(args ...string) (string, error) {
	shellArgs := append([]string{"shell"}, args...)
	return a.runCommand("adb", shellArgs...)
}

// runAdbShellTimeout is runAdbShell with a custom timeout.
func (a *App) runAdbShellTimeout(timeout time.Duration, args ...string) (string, error) {
	shellArgs := append([]string{"shell"}, args...)
	return a.runCommandTimeout(timeout, "adb", shellArgs...)
}

// CheckSystemRequirements verifies adb and fastboot are accessible and working.
func (a *App) CheckSystemRequirements() (map[string]string, error) {
	result := map[string]string{}

	adbPath, err := a.getBinaryPath("adb")
	if err != nil {
		return nil, fmt.Errorf("adb not found: %w", err)
	}

	fbPath, err := a.getBinaryPath("fastboot")
	if err != nil {
		return nil, fmt.Errorf("fastboot not found: %w", err)
	}

	// Run adb --version to confirm it works
	adbVer, err := a.runCommand("adb", "version")
	if err != nil {
		return nil, fmt.Errorf("adb found at %s but failed to run: %w", adbPath, err)
	}

	// Extract just the version line
	for _, line := range strings.Split(adbVer, "\n") {
		if strings.HasPrefix(line, "Android Debug Bridge") {
			result["adb"] = strings.TrimSpace(line)
			break
		}
	}
	if result["adb"] == "" {
		result["adb"] = adbPath
	}

	result["adbPath"] = adbPath
	result["fastbootPath"] = fbPath

	return result, nil
}

// GetBinaryInfo returns path and SHA-256 for both binaries.
// Exposes this to the frontend so users can verify their own tooling.
func (a *App) GetBinaryInfo() (map[string]string, error) {
	result := map[string]string{}

	for _, name := range []string{"adb", "fastboot"} {
		info, err := a.VerifyBinary(name)
		if err != nil {
			result[name] = fmt.Sprintf("error: %s", err.Error())
		} else {
			result[name] = info
		}
	}

	return result, nil
}

// SetAdbPath allows the user to override the adb binary path.
func (a *App) SetAdbPath(path string) error {
	info, err := os.Stat(path)
	if err != nil {
		return fmt.Errorf("path does not exist: %w", err)
	}
	if info.IsDir() {
		return fmt.Errorf("path is a directory, expected a binary file")
	}
	a.config.AdbPath = path
	a.invalidateBinaryCache()
	return nil
}

// SetFastbootPath allows the user to override the fastboot binary path.
func (a *App) SetFastbootPath(path string) error {
	info, err := os.Stat(path)
	if err != nil {
		return fmt.Errorf("path does not exist: %w", err)
	}
	if info.IsDir() {
		return fmt.Errorf("path is a directory, expected a binary file")
	}
	a.config.FastbootPath = path
	a.invalidateBinaryCache()
	return nil
}

// CancelOperation cancels any currently running long operation.
func (a *App) CancelOperation() string {
	a.opMutex.Lock()
	defer a.opMutex.Unlock()

	if a.currentCancel != nil {
		a.currentCancel()
		a.currentCancel = nil
		return "Operation cancelled."
	}
	return "No active operation to cancel."
}

// beginCancellableOp sets up a cancellable context for a long operation.
// Caller must call the returned cancel func (defer it).
func (a *App) beginCancellableOp(timeout time.Duration) (context.Context, context.CancelFunc) {
	a.opMutex.Lock()
	defer a.opMutex.Unlock()

	// Cancel any previously running op
	if a.currentCancel != nil {
		a.currentCancel()
	}

	var ctx context.Context
	var cancel context.CancelFunc
	if timeout > 0 {
		ctx, cancel = context.WithTimeout(context.Background(), timeout)
	} else {
		ctx, cancel = context.WithCancel(context.Background())
	}

	a.currentCancel = cancel
	return ctx, func() {
		cancel()
		a.opMutex.Lock()
		if a.currentCancel != nil {
			a.currentCancel = nil
		}
		a.opMutex.Unlock()
	}
}
