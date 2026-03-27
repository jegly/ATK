package main

import (
	"fmt"
	"regexp"
	"strings"
	"time"
)

// ListFiles lists files in the given remote path on the device.
// path is passed as a discrete argument - no shell injection.
func (a *App) ListFiles(path string) ([]FileEntry, error) {
	if path == "" {
		path = "/"
	}

	// ls, -lA, and path are all discrete args - safe
	output, err := a.runAdbShell("ls", "-lA", path)
	if err != nil {
		return nil, fmt.Errorf("failed to list %s: %w", path, err)
	}

	return parseFileList(output), nil
}

// parseFileList parses the output of `ls -lA` into FileEntry structs.
func parseFileList(output string) []FileEntry {
	var files []FileEntry
	spaceRe := regexp.MustCompile(`\s+`)

	for _, rawLine := range strings.Split(output, "\n") {
		line := strings.TrimSpace(rawLine)
		if line == "" || strings.HasPrefix(line, "total") {
			continue
		}

		parts := spaceRe.Split(line, 9)
		if len(parts) < 6 {
			continue
		}

		permissions := parts[0]
		fileType := "File"
		size := ""
		if len(parts) > 4 {
			size = parts[4]
		}

		if len(permissions) > 0 {
			switch permissions[0] {
			case 'd':
				fileType = "Directory"
			case 'l':
				fileType = "Symlink"
				size = "" // symlinks don't have meaningful sizes
			}
		}

		var name, date, modTime string
		switch {
		case len(parts) >= 8:
			date = parts[5]
			modTime = parts[6]
			name = strings.Join(parts[7:], " ")
		case len(parts) == 7:
			date = parts[5]
			name = parts[6]
		default:
			name = parts[len(parts)-1]
		}

		// Strip symlink target from name
		if fileType == "Symlink" {
			if idx := strings.Index(name, " -> "); idx >= 0 {
				name = name[:idx]
			}
		}

		files = append(files, FileEntry{
			Name:        strings.TrimSpace(name),
			Type:        fileType,
			Size:        size,
			Permissions: permissions,
			Date:        strings.TrimSpace(date),
			Time:        strings.TrimSpace(modTime),
		})
	}

	return files
}

// PushFile pushes a local file to the device.
// Both paths are passed as discrete arguments - no shell injection.
func (a *App) PushFile(localPath, remotePath string) (string, error) {
	ctx, cancel := a.beginCancellableOp(30 * time.Minute)
	defer cancel()

	output, err := a.runCommandContext(ctx, "adb", "push", localPath, remotePath)
	if err != nil {
		if strings.Contains(err.Error(), "cancelled") {
			return "", fmt.Errorf("push cancelled")
		}
		return "", fmt.Errorf("push failed: %w", err)
	}
	return output, nil
}

// PullFile pulls a file from the device to a local path.
// Both paths are passed as discrete arguments - no shell injection.
func (a *App) PullFile(remotePath, localPath string) (string, error) {
	// No timeout for pulls - only user cancellation
	ctx, cancel := a.beginCancellableOp(0)
	defer cancel()

	// -a preserves timestamps
	output, err := a.runCommandContext(ctx, "adb", "pull", "-a", remotePath, localPath)
	if err != nil {
		if strings.Contains(err.Error(), "cancelled") {
			return "", fmt.Errorf("pull cancelled")
		}
		return "", fmt.Errorf("pull failed: %w", err)
	}
	return output, nil
}

// CreateFolder creates a directory on the device.
// fullPath is passed as a discrete argument - safe.
func (a *App) CreateFolder(fullPath string) (string, error) {
	if err := validateRemotePath(fullPath); err != nil {
		return "", err
	}
	// mkdir, -p, and path are discrete args
	_, err := a.runAdbShell("mkdir", "-p", fullPath)
	if err != nil {
		return "", fmt.Errorf("failed to create folder: %w", err)
	}
	return fmt.Sprintf("Created: %s", fullPath), nil
}

// DeleteFile deletes a file or directory on the device.
// fullPath is passed as a discrete argument - safe.
func (a *App) DeleteFile(fullPath string) (string, error) {
	if err := validateRemotePath(fullPath); err != nil {
		return "", err
	}
	// rm, -rf, and path are discrete args
	_, err := a.runAdbShell("rm", "-rf", fullPath)
	if err != nil {
		return "", fmt.Errorf("failed to delete: %w", err)
	}
	return fmt.Sprintf("Deleted: %s", fullPath), nil
}

// RenameFile renames/moves a file on the device.
// Both paths are discrete arguments - safe.
func (a *App) RenameFile(oldPath, newPath string) (string, error) {
	if err := validateRemotePath(oldPath); err != nil {
		return "", fmt.Errorf("invalid source path: %w", err)
	}
	if err := validateRemotePath(newPath); err != nil {
		return "", fmt.Errorf("invalid destination path: %w", err)
	}
	// mv, oldPath, newPath are discrete args
	_, err := a.runAdbShell("mv", oldPath, newPath)
	if err != nil {
		return "", fmt.Errorf("failed to rename: %w", err)
	}
	return fmt.Sprintf("Renamed to: %s", newPath), nil
}

// CopyFile copies a file on the device.
// Both paths are discrete arguments - safe.
func (a *App) CopyFile(srcPath, dstPath string) (string, error) {
	if err := validateRemotePath(srcPath); err != nil {
		return "", fmt.Errorf("invalid source path: %w", err)
	}
	if err := validateRemotePath(dstPath); err != nil {
		return "", fmt.Errorf("invalid destination path: %w", err)
	}
	// cp, -r, srcPath, dstPath are all discrete args
	_, err := a.runAdbShell("cp", "-r", srcPath, dstPath)
	if err != nil {
		return "", fmt.Errorf("failed to copy: %w", err)
	}
	return fmt.Sprintf("Copied to: %s", dstPath), nil
}

// DeleteMultipleFiles deletes multiple files/directories.
func (a *App) DeleteMultipleFiles(fullPaths []string) (string, error) {
	if len(fullPaths) == 0 {
		return "", fmt.Errorf("no files selected")
	}

	var successCount, failCount int
	var errDetails strings.Builder

	for _, path := range fullPaths {
		if _, err := a.DeleteFile(path); err != nil {
			failCount++
			errDetails.WriteString(fmt.Sprintf("• %s: %v\n", path, err))
		} else {
			successCount++
		}
	}

	summary := fmt.Sprintf("Deleted %d item(s).", successCount)
	if failCount > 0 {
		summary += fmt.Sprintf(" Failed: %d\n%s", failCount, errDetails.String())
	}
	return summary, nil
}

// PullMultipleFiles pulls multiple files from the device to a user-chosen directory.
func (a *App) PullMultipleFiles(remotePaths []string) (string, error) {
	if len(remotePaths) == 0 {
		return "", fmt.Errorf("no files selected")
	}

	localDir, err := a.SelectDirectoryForPull()
	if err != nil {
		return "", fmt.Errorf("folder dialog failed: %w", err)
	}
	if localDir == "" {
		return "Export cancelled.", nil
	}

	var successCount, failCount int
	var errDetails strings.Builder

	for _, remotePath := range remotePaths {
		_, err := a.PullFile(remotePath, localDir)
		if err != nil {
			if strings.Contains(err.Error(), "cancelled") {
				errDetails.WriteString(fmt.Sprintf("• %s: cancelled\n", remotePath))
				failCount++
				break // user cancelled - stop the batch
			}
			failCount++
			errDetails.WriteString(fmt.Sprintf("• %s: %v\n", remotePath, err))
		} else {
			successCount++
		}
	}

	summary := fmt.Sprintf("Exported %d item(s) to %s.", successCount, localDir)
	if failCount > 0 {
		summary += fmt.Sprintf(" Failed: %d\n%s", failCount, errDetails.String())
	}
	return summary, nil
}

// validateRemotePath checks that a remote path is safe to use as an ADB argument.
// Rejects empty paths and the bare root "/" to prevent accidental rm -rf /.
func validateRemotePath(path string) error {
	path = strings.TrimSpace(path)
	if path == "" {
		return fmt.Errorf("path cannot be empty")
	}
	if path == "/" {
		return fmt.Errorf("refusing to operate on root filesystem path /")
	}
	return nil
}
