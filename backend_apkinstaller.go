package main

import (
	"fmt"
	"os"
	"path/filepath"
	"sort"
	"strings"

	"github.com/wailsapp/wails/v2/pkg/runtime"
)

// ApkFileInfo describes one APK found in a chosen folder, for the batch
// installer's checklist.
type ApkFileInfo struct {
	Path string `json:"path"`
	Name string `json:"name"`
	Size int64  `json:"size"`
}

// ListApksInFolder scans a folder (non-recursive) for .apk files.
func (a *App) ListApksInFolder(folderPath string) ([]ApkFileInfo, error) {
	entries, err := os.ReadDir(folderPath)
	if err != nil {
		return nil, fmt.Errorf("could not read folder: %w", err)
	}

	var apks []ApkFileInfo
	for _, e := range entries {
		if e.IsDir() || !strings.EqualFold(filepath.Ext(e.Name()), ".apk") {
			continue
		}
		info, err := e.Info()
		if err != nil {
			continue
		}
		apks = append(apks, ApkFileInfo{
			Path: filepath.Join(folderPath, e.Name()),
			Name: e.Name(),
			Size: info.Size(),
		})
	}
	sort.Slice(apks, func(i, j int) bool { return apks[i].Name < apks[j].Name })
	return apks, nil
}

// StatApkFiles builds ApkFileInfo entries for explicitly chosen APK paths
// (from the multi-file picker), so manual selection and folder scans feed the
// same checklist shape. Unreadable paths are silently skipped.
func (a *App) StatApkFiles(paths []string) ([]ApkFileInfo, error) {
	out := make([]ApkFileInfo, 0, len(paths))
	for _, p := range paths {
		info, err := os.Stat(p)
		if err != nil || info.IsDir() {
			continue
		}
		out = append(out, ApkFileInfo{Path: p, Name: info.Name(), Size: info.Size()})
	}
	return out, nil
}

// InstallApksWithProgress installs each APK in order (adb install -r),
// emitting apkinstall:progress events so the UI can show a live per-file
// checklist rather than one opaque spinner. Cancellable via CancelOperation.
func (a *App) InstallApksWithProgress(paths []string) (string, error) {
	if len(paths) == 0 {
		return "", fmt.Errorf("no APKs selected")
	}

	ctx, cancel := a.beginCancellableOp(0)
	defer cancel()

	total := len(paths)
	var ok, fail int
	var details strings.Builder

	for i, p := range paths {
		name := baseName(p)
		// Keyed by full path (not just fileName) - two selected APKs from
		// different folders can share a filename, and the path is what's
		// actually unique in the frontend's checklist.
		runtime.EventsEmit(a.ctx, "apkinstall:progress", map[string]interface{}{
			"current": i + 1, "total": total, "path": p, "fileName": name, "status": "installing",
		})

		output, err := a.runCommandContext(ctx, "adb", "install", "-r", p)
		status, msg := "success", ""
		switch {
		case err != nil:
			status = "failed"
			msg = err.Error()
		case strings.Contains(output, "Failure"):
			status = "failed"
			msg = strings.TrimSpace(output)
		}

		if status == "success" {
			ok++
		} else {
			fail++
			details.WriteString(fmt.Sprintf("• %s: %s\n", name, msg))
		}
		runtime.EventsEmit(a.ctx, "apkinstall:progress", map[string]interface{}{
			"current": i + 1, "total": total, "path": p, "fileName": name, "status": status, "message": msg,
		})

		if strings.Contains(msg, "cancelled") {
			break
		}
	}
	runtime.EventsEmit(a.ctx, "apkinstall:done", nil)

	summary := fmt.Sprintf("Installed %d of %d APK(s).", ok, total)
	if fail > 0 {
		summary += fmt.Sprintf(" Failed: %d\n%s", fail, details.String())
	}
	return summary, nil
}
