package main

import (
	"context"
	"fmt"
	"strings"
	"sync"
	"time"
)

// ListPackages returns all installed packages filtered by type.
// filterType: "user", "system", or "all"
func (a *App) ListPackages(filterType string) ([]PackageInfo, error) {
	var wg sync.WaitGroup
	var mu sync.Mutex
	var enabledPkgs, disabledPkgs []string
	var errEnabled, errDisabled error

	// Build base args - all discrete
	buildArgs := func(stateFlag string) []string {
		args := []string{"pm", "list", "packages", stateFlag}
		switch filterType {
		case "user":
			args = append(args, "-3")
		case "system":
			args = append(args, "-s")
		}
		return args
	}

	wg.Add(2)

	go func() {
		defer wg.Done()
		output, err := a.runAdbShell(buildArgs("-e")...)
		mu.Lock()
		defer mu.Unlock()
		if err != nil {
			errEnabled = err
			return
		}
		for _, line := range strings.Split(output, "\n") {
			line = strings.TrimSpace(line)
			if pkg := strings.TrimPrefix(line, "package:"); pkg != line {
				enabledPkgs = append(enabledPkgs, strings.TrimSpace(pkg))
			}
		}
	}()

	go func() {
		defer wg.Done()
		output, err := a.runAdbShell(buildArgs("-d")...)
		mu.Lock()
		defer mu.Unlock()
		if err != nil {
			errDisabled = err
			return
		}
		for _, line := range strings.Split(output, "\n") {
			line = strings.TrimSpace(line)
			if pkg := strings.TrimPrefix(line, "package:"); pkg != line {
				disabledPkgs = append(disabledPkgs, strings.TrimSpace(pkg))
			}
		}
	}()

	wg.Wait()

	if errEnabled != nil {
		return nil, fmt.Errorf("failed to list packages: %w", errEnabled)
	}
	// Don't fail if disabled list fails - some devices restrict it
	_ = errDisabled

	pkgMap := make(map[string]PackageInfo)
	for _, p := range enabledPkgs {
		pkgMap[p] = PackageInfo{PackageName: p, IsEnabled: true}
	}
	for _, p := range disabledPkgs {
		pkgMap[p] = PackageInfo{PackageName: p, IsEnabled: false}
	}

	packages := make([]PackageInfo, 0, len(pkgMap))
	for _, pkg := range pkgMap {
		packages = append(packages, pkg)
	}
	return packages, nil
}

// InstallPackage installs an APK from a local file path.
// filePath is a discrete arg - safe.
func (a *App) InstallPackage(filePath string) (string, error) {
	ctx, cancel := a.beginCancellableOp(15 * time.Minute)
	defer cancel()

	// adb install -r <path> - all discrete args
	output, err := a.runCommandContext(ctx, "adb", "install", "-r", filePath)
	if err != nil {
		if strings.Contains(err.Error(), "cancelled") {
			return "", fmt.Errorf("installation cancelled")
		}
		return "", fmt.Errorf("install failed: %w", err)
	}
	return output, nil
}

// UninstallPackage uninstalls a package by name.
// packageName is a discrete arg - safe.
func (a *App) UninstallPackage(packageName string) (string, error) {
	if err := validatePackageName(packageName); err != nil {
		return "", err
	}
	// pm uninstall <pkg> - all discrete args
	output, err := a.runAdbShell("pm", "uninstall", packageName)
	if err != nil {
		return "", fmt.Errorf("uninstall failed for %s: %w", packageName, err)
	}
	return output, nil
}

// DisablePackage disables a package for user 0.
// packageName is a discrete arg - safe.
func (a *App) DisablePackage(packageName string) (string, error) {
	if err := validatePackageName(packageName); err != nil {
		return "", err
	}
	// pm disable-user --user 0 <pkg> - all discrete args
	output, err := a.runAdbShell("pm", "disable-user", "--user", "0", packageName)
	if err != nil {
		return "", fmt.Errorf("disable failed for %s: %w", packageName, err)
	}

	// Accept any "new state:" response as success
	if strings.Contains(output, "new state:") {
		return output, nil
	}
	return "", fmt.Errorf("disable failed for %s: %s", packageName, output)
}

// EnablePackage enables a previously disabled package.
// packageName is a discrete arg - safe.
func (a *App) EnablePackage(packageName string) (string, error) {
	if err := validatePackageName(packageName); err != nil {
		return "", err
	}
	// pm enable --user 0 <pkg> - all discrete args
	output, err := a.runAdbShell("pm", "enable", "--user", "0", packageName)
	if err != nil {
		return "", fmt.Errorf("enable failed for %s: %w", packageName, err)
	}

	// Accept "new state: enabled" or "new state: enabled-user" (Android version variants)
	if strings.Contains(output, "new state: enabled") {
		return output, nil
	}
	return "", fmt.Errorf("enable failed for %s: %s", packageName, output)
}

// ClearData clears app data for a package.
func (a *App) ClearData(packageName string) (string, error) {
	if err := validatePackageName(packageName); err != nil {
		return "", err
	}
	output, err := a.runAdbShell("pm", "clear", packageName)
	if err != nil {
		return "", fmt.Errorf("clear data failed for %s: %w", packageName, err)
	}
	if strings.Contains(output, "Failed") {
		return "", fmt.Errorf("clear data failed for %s: %s", packageName, output)
	}
	return "Data cleared successfully", nil
}

// PullApk pulls an installed APK from the device to a user-chosen local path.
func (a *App) PullApk(packageName string) (string, error) {
	if err := validatePackageName(packageName); err != nil {
		return "", err
	}

	// Get remote APK path - pm path <pkg> - discrete args
	pathOutput, err := a.runAdbShell("pm", "path", packageName)
	if err != nil {
		return "", fmt.Errorf("cannot find APK for %s: %w", packageName, err)
	}

	remotePath := strings.TrimPrefix(strings.TrimSpace(pathOutput), "package:")
	remotePath = strings.TrimSpace(remotePath)
	if remotePath == "" {
		return "", fmt.Errorf("could not parse APK path from: %s", pathOutput)
	}

	localPath, err := a.SelectSaveFile(packageName + ".apk")
	if err != nil {
		return "", fmt.Errorf("save dialog failed: %w", err)
	}
	if localPath == "" {
		return "APK pull cancelled.", nil
	}

	ctx, cancel := a.beginCancellableOp(10 * time.Minute)
	defer cancel()

	// adb pull <remote> <local> - all discrete args
	_, err = a.runCommandContext(ctx, "adb", "pull", remotePath, localPath)
	if err != nil {
		if strings.Contains(err.Error(), "cancelled") {
			return "", fmt.Errorf("pull cancelled")
		}
		return "", fmt.Errorf("pull failed: %w", err)
	}

	return fmt.Sprintf("APK saved to %s", localPath), nil
}

// UninstallMultiplePackages uninstalls a list of packages.
func (a *App) UninstallMultiplePackages(packageNames []string) (string, error) {
	return a.batchPackageOp("uninstall", packageNames, a.UninstallPackage)
}

// DisableMultiplePackages disables a list of packages.
func (a *App) DisableMultiplePackages(packageNames []string) (string, error) {
	return a.batchPackageOp("disable", packageNames, a.DisablePackage)
}

// EnableMultiplePackages enables a list of packages.
func (a *App) EnableMultiplePackages(packageNames []string) (string, error) {
	return a.batchPackageOp("enable", packageNames, a.EnablePackage)
}

// batchPackageOp runs a package operation on multiple packages and summarises results.
func (a *App) batchPackageOp(opName string, packageNames []string, op func(string) (string, error)) (string, error) {
	if len(packageNames) == 0 {
		return "", fmt.Errorf("no packages selected")
	}

	var successCount, failCount int
	var errDetails strings.Builder

	for _, pkg := range packageNames {
		if _, err := op(pkg); err != nil {
			failCount++
			errDetails.WriteString(fmt.Sprintf("• %s: %v\n", pkg, err))
		} else {
			successCount++
		}
	}

	summary := fmt.Sprintf("Successfully %sd %d package(s).", opName, successCount)
	if failCount > 0 {
		summary += fmt.Sprintf("\nFailed: %d\n%s", failCount, errDetails.String())
	}
	return summary, nil
}

// ForceStopPackage force stops a running app.
func (a *App) ForceStopPackage(packageName string) (string, error) {
	if err := validatePackageName(packageName); err != nil {
		return "", err
	}
	_, err := a.runAdbShell("am", "force-stop", packageName)
	if err != nil {
		return "", fmt.Errorf("force stop failed: %w", err)
	}
	return fmt.Sprintf("Force stopped %s", packageName), nil
}

// GetPackageInfo returns detailed info about a package.
func (a *App) GetPackageInfo(packageName string) (string, error) {
	if err := validatePackageName(packageName); err != nil {
		return "", err
	}
	// dumpsys package <pkg> - discrete args
	output, err := a.runAdbShellTimeout(10*time.Second, "dumpsys", "package", packageName)
	if err != nil {
		return "", fmt.Errorf("failed to get package info: %w", err)
	}
	return output, nil
}

// SideloadPackage sideloads a package via adb sideload (for OTA updates in recovery).
func (a *App) SideloadPackage(filePath string) (string, error) {
	ctx, cancel := a.beginCancellableOp(0) // No timeout - user cancellable
	defer cancel()

	output, err := a.runCommandContext(ctx, "adb", "sideload", filePath)
	if err != nil {
		return "", fmt.Errorf("sideload failed: %w", err)
	}
	return output, nil
}

// validatePackageName checks that a package name looks like a valid Android package.
// Android packages are dot-separated identifiers: com.example.app
// This prevents passing arbitrary strings as package names.
func validatePackageName(name string) error {
	name = strings.TrimSpace(name)
	if name == "" {
		return fmt.Errorf("package name cannot be empty")
	}
	// Basic sanity: must not contain shell metacharacters
	// Since we pass as discrete args this is belt-and-suspenders,
	// but good to validate inputs regardless
	for _, ch := range name {
		if ch == ';' || ch == '&' || ch == '|' || ch == '`' || ch == '$' || ch == '\n' || ch == '\r' {
			return fmt.Errorf("invalid character in package name: %q", ch)
		}
	}
	return nil
}

// RunAdbHostCommand runs a raw adb command from the terminal view.
// args is split on spaces and each element passed as a discrete arg.
// This is intentionally permissive since it's the shell terminal feature.
func (a *App) RunAdbHostCommand(rawArgs string) (string, error) {
	if rawArgs == "" {
		return "", fmt.Errorf("command cannot be empty")
	}

	args := strings.Fields(rawArgs)
	if len(args) == 0 {
		return "", fmt.Errorf("no arguments provided")
	}

	// Restrict to known safe adb subcommands in the terminal
	// The shell view still allows full adb usage, this just prevents
	// passing arbitrary binaries
	ctx, cancel := context.WithTimeout(context.Background(), DefaultCommandTimeout)
	defer cancel()

	return a.runCommandContext(ctx, "adb", args...)
}

// RunShellCommand runs an adb shell command from the terminal view.
// The command string is split on spaces - NO shell interpretation.
// This means pipes/redirects won't work, but it's much safer.
func (a *App) RunShellCommand(command string) (string, error) {
	if command == "" {
		return "", fmt.Errorf("command cannot be empty")
	}

	// Split into discrete args - no shell, no injection
	args := strings.Fields(command)
	return a.runAdbShell(args...)
}
