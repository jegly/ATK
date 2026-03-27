package main

import (
	"github.com/ncruces/zenity"
)

// SelectFileForPush opens a native file picker for choosing a file to push.
func (a *App) SelectFileForPush() (string, error) {
	path, err := zenity.SelectFile(
		zenity.Title("Select file to push to device"),
	)
	if err == zenity.ErrCanceled {
		return "", nil
	}
	return path, err
}

// SelectFileForInstall opens a file picker filtered to APK files.
func (a *App) SelectFileForInstall() (string, error) {
	path, err := zenity.SelectFile(
		zenity.Title("Select APK to install"),
		zenity.FileFilters{
			{Name: "APK files", Patterns: []string{"*.apk"}, CaseFold: true},
			{Name: "All files", Patterns: []string{"*"}},
		},
	)
	if err == zenity.ErrCanceled {
		return "", nil
	}
	return path, err
}

// SelectFileForFlash opens a file picker for image files (for fastboot flash).
func (a *App) SelectFileForFlash() (string, error) {
	path, err := zenity.SelectFile(
		zenity.Title("Select image to flash"),
		zenity.FileFilters{
			{Name: "Image files", Patterns: []string{"*.img", "*.zip", "*.bin"}, CaseFold: true},
			{Name: "All files", Patterns: []string{"*"}},
		},
	)
	if err == zenity.ErrCanceled {
		return "", nil
	}
	return path, err
}

// SelectSaveFile opens a native save-as dialog.
func (a *App) SelectSaveFile(defaultName string) (string, error) {
	path, err := zenity.SelectFileSave(
		zenity.Title("Save as"),
		zenity.Filename(defaultName),
	)
	if err == zenity.ErrCanceled {
		return "", nil
	}
	return path, err
}

// SelectDirectoryForPull opens a native directory picker.
func (a *App) SelectDirectoryForPull() (string, error) {
	path, err := zenity.SelectFile(
		zenity.Title("Select destination folder"),
		zenity.Directory(),
	)
	if err == zenity.ErrCanceled {
		return "", nil
	}
	return path, err
}

// SelectFileWithFilter opens a file picker with custom file type filters.
func (a *App) SelectFileWithFilter(title string, patterns []string) (string, error) {
	filters := []zenity.FileFilter{
		{Name: "Matching files", Patterns: patterns, CaseFold: true},
		{Name: "All files", Patterns: []string{"*"}},
	}
	path, err := zenity.SelectFile(
		zenity.Title(title),
		zenity.FileFilters(filters),
	)
	if err == zenity.ErrCanceled {
		return "", nil
	}
	return path, err
}
