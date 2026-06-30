package main

import (
	_ "embed"
	"fmt"
	"os"
	"path/filepath"
	"strconv"
	"strings"
	"time"
)

// privilegedHelperDex is the on-device uninstall helper, compiled to dex.
// See android-helper/Main.java (rebuild with android-helper/build.sh).
//
//go:embed android-helper/atk-helper.dex
var privilegedHelperDex []byte

const privilegedHelperRemotePath = "/data/local/tmp/atk-helper.dex"

// pushPrivilegedHelper writes the embedded dex to a temp file and pushes it to
// the device. Cheap (~3 KB) so it is safe to call before each privileged op.
func (a *App) pushPrivilegedHelper() error {
	tmp := filepath.Join(os.TempDir(), "atk-helper.dex")
	if err := os.WriteFile(tmp, privilegedHelperDex, 0o644); err != nil {
		return fmt.Errorf("write helper: %w", err)
	}
	defer os.Remove(tmp)

	ctx, cancel := a.beginCancellableOp(30 * time.Second)
	defer cancel()
	if _, err := a.runCommandContext(ctx, "adb", "push", tmp, privilegedHelperRemotePath); err != nil {
		return fmt.Errorf("push helper to device: %w", err)
	}
	return nil
}

// privilegedUninstall removes a package for the given user via the on-device
// app_process helper. It runs as the shell user (uid 2000) and calls
// IPackageInstaller.uninstall() with the DELETE_SYSTEM_APP flag - the same
// capability Canta gets through Shizuku, but driven over adb with no root.
// This removes protected system apps that `pm uninstall --user` refuses.
func (a *App) privilegedUninstall(packageName string, userID int) (string, error) {
	if err := validatePackageName(packageName); err != nil {
		return "", err
	}
	if err := a.pushPrivilegedHelper(); err != nil {
		return "", err
	}

	// CLASSPATH=<dex> app_process /system/bin Main <pkg> <user>
	out, err := a.runAdbShellTimeout(30*time.Second,
		"CLASSPATH="+privilegedHelperRemotePath, "app_process", "/system/bin",
		"Main", packageName, strconv.Itoa(userID))
	if err != nil {
		return "", fmt.Errorf("privileged helper failed: %s", friendlyPmError(err.Error()))
	}
	if idx := strings.Index(out, "ATK_ERR"); idx >= 0 {
		return "", fmt.Errorf("privileged uninstall failed for %s: %s",
			packageName, strings.TrimSpace(out[idx+len("ATK_ERR"):]))
	}

	// The helper's result callback is fire-and-forget, so confirm removal
	// directly rather than trusting ATK_OK alone.
	if a.isInstalledForUser(packageName, userID) {
		return "", fmt.Errorf("privileged uninstall reported success but %s is still present for user %d",
			packageName, userID)
	}
	return fmt.Sprintf("%s removed for user %d (privileged)", packageName, userID), nil
}

// isInstalledForUser reports whether packageName is currently installed for the
// given user (exact match, not substring).
func (a *App) isInstalledForUser(packageName string, userID int) bool {
	out, err := a.runAdbShell("pm", "list", "packages", "--user", strconv.Itoa(userID), packageName)
	if err != nil {
		return false
	}
	for _, line := range strings.Split(out, "\n") {
		if strings.TrimSpace(line) == "package:"+packageName {
			return true
		}
	}
	return false
}

// isProtectedSystemApp reports whether a pm uninstall failure is the protected
// system-app guard - i.e. removable only by passing DELETE_SYSTEM_APP, which
// the pm CLI never does but our privileged helper can.
func isProtectedSystemApp(text string) bool {
	return strings.Contains(text, "only root can delete") ||
		strings.Contains(text, "Only root may") ||
		strings.Contains(text, "DELETE_FAILED_INTERNAL_ERROR")
}
