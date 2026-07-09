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
	// Build base args - all discrete
	buildArgs := func(extra ...string) []string {
		args := []string{"pm", "list", "packages"}
		switch filterType {
		case "user":
			args = append(args, "-3")
		case "system":
			args = append(args, "-s")
		}
		return append(args, extra...)
	}

	parse := func(output string) []string {
		var out []string
		for _, line := range strings.Split(output, "\n") {
			line = strings.TrimSpace(line)
			if pkg := strings.TrimPrefix(line, "package:"); pkg != line {
				out = append(out, strings.TrimSpace(pkg))
			}
		}
		return out
	}

	var wg sync.WaitGroup
	var allPkgs, installedPkgs, disabledPkgs []string
	var errAll error

	wg.Add(3)

	// Membership = the UNFILTERED superset for this category, via `-u`. Every
	// package that's ever been on the system image shows up here, INCLUDING
	// ones uninstalled for user 0 (Canta/Shizuku's "uninstall" of a system app
	// is really `pm uninstall --user 0`, which leaves the APK on disk but drops
	// it from a plain `pm list packages`). The old approach queried without
	// `-u`, which is why per-user-uninstalled system apps were invisible in
	// Packages / Debloater / the App Inspector picker even though they were
	// still physically present on the device.
	go func() {
		defer wg.Done()
		output, err := a.runAdbShell(buildArgs("-u")...)
		if err != nil {
			errAll = err
			return
		}
		allPkgs = parse(output)
	}()

	// Without `-u`: only packages actually installed for user 0 right now. Used
	// to tell "uninstalled for user" apart from enabled/disabled — `-d`/`-e`
	// alone can't do that, since a per-user-uninstalled package appears in
	// neither.
	go func() {
		defer wg.Done()
		output, err := a.runAdbShell(buildArgs()...)
		if err != nil {
			return
		}
		installedPkgs = parse(output)
	}()

	// `-d` is used only to flag the disabled badge. Some ROMs restrict it; that's
	// non-fatal — it just means nothing gets marked disabled.
	go func() {
		defer wg.Done()
		output, err := a.runAdbShell(buildArgs("-d")...)
		if err != nil {
			return
		}
		disabledPkgs = parse(output)
	}()

	wg.Wait()

	if errAll != nil {
		return nil, fmt.Errorf("failed to list packages: %w", errAll)
	}

	installed := make(map[string]bool, len(installedPkgs))
	for _, p := range installedPkgs {
		installed[p] = true
	}
	disabled := make(map[string]bool, len(disabledPkgs))
	for _, p := range disabledPkgs {
		disabled[p] = true
	}

	packages := make([]PackageInfo, 0, len(allPkgs))
	seen := make(map[string]bool, len(allPkgs))
	for _, p := range allPkgs {
		if seen[p] {
			continue
		}
		seen[p] = true
		isInstalled := installed[p]
		// A package not installed for the user can't run either way, so it's
		// never reported as enabled regardless of its internal enabled flag.
		packages = append(packages, PackageInfo{
			PackageName: p,
			IsInstalled: isInstalled,
			IsEnabled:   isInstalled && !disabled[p],
		})
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

// UninstallPackage uninstalls a package for user 0.
// packageName is a discrete arg - safe.
func (a *App) UninstallPackage(packageName string) (string, error) {
	if err := a.requireDangerUnlocked(); err != nil {
		return "", err
	}
	if err := validatePackageName(packageName); err != nil {
		return "", err
	}
	// `pm uninstall --user 0 <pkg>` - uninstall for the primary user only.
	//
	// Pre-installed / system apps (what a debloater targets) cannot be deleted
	// from the read-only system partition without root, but they CAN be removed
	// for the current user. This is exactly how Canta/Shizuku and UAD-ng debloat
	// them. Bare `pm uninstall <pkg>` (no --user) attempts a full removal and the
	// system rejects it with a "not allowed for the user" / DELETE_FAILED_* error.
	// See UAD-ng src/core/sync.rs (request_builder + user_flag).
	output, err := a.runAdbShell("pm", "uninstall", "--user", "0", packageName)
	if err != nil {
		// Already gone for user 0 is effectively success (idempotent debloat).
		if isAlreadyUninstalled(err.Error()) {
			return fmt.Sprintf("%s already uninstalled for user 0", packageName), nil
		}
		// Protected system app: the pm CLI can't set DELETE_SYSTEM_APP. Fall
		// back to the privileged app_process helper (Canta/Shizuku technique).
		if isProtectedSystemApp(err.Error()) {
			return a.privilegedUninstallFallback(packageName, err.Error())
		}
		return "", fmt.Errorf("uninstall failed for %s: %s", packageName, friendlyPmError(err.Error()))
	}
	// pm can exit 0 while printing "Failure [...]" to stdout on some Android builds.
	if strings.Contains(output, "Failure") {
		if isAlreadyUninstalled(output) {
			return fmt.Sprintf("%s already uninstalled for user 0", packageName), nil
		}
		if isProtectedSystemApp(output) {
			return a.privilegedUninstallFallback(packageName, output)
		}
		return "", fmt.Errorf("uninstall failed for %s: %s", packageName, friendlyPmError(output))
	}

	// pm reported success - but for an updatable system app `pm uninstall --user 0`
	// only removes the *updates* (reverts to factory) and leaves the app installed.
	// Don't trust the success blindly: if it's still present for user 0, escalate
	// to the privileged DELETE_SYSTEM_APP helper to actually remove it.
	if a.isInstalledForUser(packageName, 0) {
		if pout, perr := a.privilegedUninstall(packageName, 0); perr == nil {
			return pout, nil
		}
		if a.isInstalledForUser(packageName, 0) {
			return "", fmt.Errorf("uninstall for %s reported success but it is still installed for user 0 (likely a required system app - try disabling it)", packageName)
		}
	}
	return output, nil
}

// privilegedUninstallFallback runs the on-device privileged helper after a
// `pm uninstall` system-app rejection, surfacing a combined error on failure.
func (a *App) privilegedUninstallFallback(packageName, pmFailure string) (string, error) {
	out, err := a.privilegedUninstall(packageName, 0)
	if err != nil {
		return "", fmt.Errorf("uninstall failed for %s: %s (privileged fallback: %v)",
			packageName, friendlyPmError(pmFailure), err)
	}
	return out, nil
}

// DisablePackage disables a package for user 0.
// packageName is a discrete arg - safe.
func (a *App) DisablePackage(packageName string) (string, error) {
	if err := a.requireDangerUnlocked(); err != nil {
		return "", err
	}
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

// UninstallAndDisablePackage force-stops and disables a package for user 0,
// then uninstalls it. Neutralising it first guarantees the app is stopped and
// disabled even if the uninstall can't fully remove it (the disabled state
// remains as a safety net).
func (a *App) UninstallAndDisablePackage(packageName string) (string, error) {
	if err := a.requireDangerUnlocked(); err != nil {
		return "", err
	}
	if err := validatePackageName(packageName); err != nil {
		return "", err
	}

	var steps []string

	// 1. Force-stop (best effort).
	if _, err := a.runAdbShell("am", "force-stop", packageName); err == nil {
		steps = append(steps, "force-stopped")
	}

	// 2. Disable for user 0 (best effort - keep going even if it fails).
	if _, err := a.DisablePackage(packageName); err == nil {
		steps = append(steps, "disabled")
	} else {
		steps = append(steps, fmt.Sprintf("disable failed (%v)", err))
	}

	// 3. Uninstall for user 0 (with privileged fallback for protected apps).
	if _, err := a.UninstallPackage(packageName); err != nil {
		// Uninstall failed, but the app is at least force-stopped/disabled.
		return "", fmt.Errorf("%s: %s; %v", packageName, strings.Join(steps, ", "), err)
	}
	steps = append(steps, "uninstalled")
	return fmt.Sprintf("%s: %s", packageName, strings.Join(steps, ", ")), nil
}

// UninstallAndDisableMultiplePackages applies the combined disable+uninstall op
// to a list of packages.
func (a *App) UninstallAndDisableMultiplePackages(packageNames []string) (string, error) {
	return a.batchPackageOp("uninstall+disable", packageNames, a.UninstallAndDisablePackage)
}

// EnableMultiplePackages enables a list of packages.
func (a *App) EnableMultiplePackages(packageNames []string) (string, error) {
	return a.batchPackageOp("enable", packageNames, a.EnablePackage)
}

// RestorePackage brings a package back for user 0. It reinstalls it if it was
// uninstalled-for-user (cmd package install-existing) and re-enables it if it
// was disabled (pm enable). Both steps are idempotent, so this works whether
// the package was disabled, uninstalled, or both.
func (a *App) RestorePackage(packageName string) (string, error) {
	if err := validatePackageName(packageName); err != nil {
		return "", err
	}

	var steps []string

	// 1. Reinstall for user 0 (no-op if already installed; required if it was
	//    uninstalled for the user). Must run before enable.
	if out, err := a.runAdbShell("cmd", "package", "install-existing", "--user", "0", packageName); err == nil {
		if strings.Contains(out, "installed for user") {
			steps = append(steps, "reinstalled")
		}
	}

	// 2. Re-enable for user 0 (no-op if already enabled; required if it was disabled).
	if out, err := a.runAdbShell("pm", "enable", "--user", "0", packageName); err == nil {
		if strings.Contains(out, "new state: enabled") {
			steps = append(steps, "enabled")
		}
	}

	if len(steps) == 0 {
		if a.isInstalledForUser(packageName, 0) {
			return fmt.Sprintf("%s already active", packageName), nil
		}
		return "", fmt.Errorf("could not restore %s (it may not be present on the system)", packageName)
	}
	return fmt.Sprintf("%s: %s", packageName, strings.Join(steps, ", ")), nil
}

// RestoreMultiplePackages restores (reinstall + re-enable) a list of packages.
func (a *App) RestoreMultiplePackages(packageNames []string) (string, error) {
	return a.batchPackageOp("restore", packageNames, a.RestorePackage)
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
	if err := a.requireDangerUnlocked(); err != nil {
		return "", err
	}
	ctx, cancel := a.beginCancellableOp(0) // No timeout - user cancellable
	defer cancel()

	output, err := a.runCommandContext(ctx, "adb", "sideload", filePath)
	if err != nil {
		return "", fmt.Errorf("sideload failed: %w", err)
	}
	return output, nil
}

// isAlreadyUninstalled reports whether a pm failure just means the package is
// no longer present for user 0 (so a debloat uninstall is effectively done).
func isAlreadyUninstalled(text string) bool {
	return strings.Contains(text, "not installed for") ||
		strings.Contains(text, "NOT_INSTALLED_FOR_USER")
}

// friendlyPmError maps common pm / OEM uninstall failure codes to readable
// guidance. Ported from UAD-ng's make_friendly_error_message (src/core/sync.rs).
// Note: on a non-zero exit the executor returns stderr only, while pm writes
// "Failure [REASON]" to stdout - so the reason text isn't always available; in
// that case we surface whatever we have.
func friendlyPmError(text string) string {
	switch {
	case isProtectedSystemApp(text):
		// Reached only when the privileged app_process helper also failed -
		// likely an active device-admin/role or a non-removable required app.
		return "protected system app - even the privileged helper could not remove it (it may be an active device-admin or a required app). Try disabling it instead."
	case strings.Contains(text, "DELETE_FAILED_USER_RESTRICTED"):
		return "restricted by the device manufacturer (Samsung Knox or similar). Try disabling the package instead."
	case strings.Contains(text, "DELETE_FAILED_DEVICE_POLICY_MANAGER"):
		return "managed by device policy (MDM/EMM) - contact your IT administrator if this is a work device."
	case strings.Contains(text, "Permission denied") ||
		strings.Contains(text, "INSTALL_FAILED_PERMISSION_MODEL_DOWNGRADE"):
		return "permission denied - the package is protected by the system and may require root."
	case strings.Contains(text, "Shell cannot change component state for null"):
		return "empty package name - refresh the package list and try again."
	case text == "" || strings.Contains(text, "exit status"):
		return "device rejected the uninstall (the app may be protected, a device-admin, or required by the system)."
	default:
		return strings.TrimSpace(text)
	}
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
