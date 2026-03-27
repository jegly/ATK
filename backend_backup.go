package main

import (
	"context"
	"fmt"
	"strings"
	"time"
)

type BackupOptions struct {
	IncludeAPKs    bool     `json:"includeApks"`
	IncludeShared  bool     `json:"includeShared"`
	IncludeSystem  bool     `json:"includeSystem"`
	Packages       []string `json:"packages"`
	AllApps        bool     `json:"allApps"`
}

// StartBackup runs adb backup with the given options.
// The user will need to confirm on the device screen.
func (a *App) StartBackup(opts BackupOptions, localPath string) (string, error) {
	if localPath == "" {
		var err error
		localPath, err = a.SelectSaveFile("backup.adb")
		if err != nil || localPath == "" {
			return "Backup cancelled", nil
		}
	}

	args := []string{"backup", "-f", localPath}

	if opts.IncludeAPKs {
		args = append(args, "-apk")
	} else {
		args = append(args, "-noapk")
	}

	if opts.IncludeShared {
		args = append(args, "-shared")
	} else {
		args = append(args, "-noshared")
	}

	if opts.IncludeSystem {
		args = append(args, "-system")
	} else {
		args = append(args, "-nosystem")
	}

	if opts.AllApps {
		args = append(args, "-all")
	} else if len(opts.Packages) > 0 {
		args = append(args, opts.Packages...)
	}

	ctx, cancel := a.beginCancellableOp(0) // no timeout — user cancellable
	defer cancel()

	out, err := a.runCommandContext(ctx, "adb", args...)
	if err != nil {
		if strings.Contains(err.Error(), "cancelled") {
			return "Backup cancelled", nil
		}
		return "", fmt.Errorf("backup failed: %w", err)
	}

	return fmt.Sprintf("Backup saved to %s\n%s", localPath, out), nil
}

// RestoreBackup restores from an .adb backup file.
func (a *App) RestoreBackup(localPath string) (string, error) {
	if localPath == "" {
		return "", fmt.Errorf("no backup file specified")
	}

	ctx, cancel := a.beginCancellableOp(0)
	defer cancel()

	out, err := a.runCommandContext(ctx, "adb", "restore", localPath)
	if err != nil {
		return "", fmt.Errorf("restore failed: %w", err)
	}

	return "Restore initiated. Confirm on device.\n" + out, nil
}

// SelectBackupFile opens a file picker for .adb backup files.
func (a *App) SelectBackupFile() (string, error) {
	return a.SelectFileWithFilter("Select backup file", []string{"*.adb", "*.ab"})
}

// GetInstalledUserApps returns list of user-installed packages for backup selection.
func (a *App) GetInstalledUserApps() ([]PackageInfo, error) {
	return a.ListPackages("user")
}

// BackupSingleApp backs up a single app by package name.
func (a *App) BackupSingleApp(packageName string, includeAPK bool) (string, error) {
	if err := validatePackageName(packageName); err != nil {
		return "", err
	}

	localPath, err := a.SelectSaveFile(packageName + ".adb")
	if err != nil || localPath == "" {
		return "Backup cancelled", nil
	}

	apkFlag := "-noapk"
	if includeAPK {
		apkFlag = "-apk"
	}

	ctx, cancel := context.WithTimeout(context.Background(), 10*time.Minute)
	defer cancel()

	out, err := a.runCommandContext(ctx, "adb", "backup", "-f", localPath, apkFlag, "-noshared", packageName)
	if err != nil {
		return "", fmt.Errorf("backup failed: %w", err)
	}

	return fmt.Sprintf("App backup saved to %s\n%s", localPath, out), nil
}
