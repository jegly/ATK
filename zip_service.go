package main

import (
	"archive/zip"
	"fmt"
	"io"
	"strings"
)

// ReadFileFromZip reads a named file from inside a zip archive.
// Used to read flash-all.sh from a Pixel factory image zip.
func (a *App) ReadFileFromZip(zipPath string, fileName string) (string, error) {
	r, err := zip.OpenReader(zipPath)
	if err != nil {
		return "", fmt.Errorf("cannot open zip: %w", err)
	}
	defer r.Close()

	for _, f := range r.File {
		// Match by filename only (ignore directory prefix)
		name := f.Name
		if idx := strings.LastIndex(name, "/"); idx >= 0 {
			name = name[idx+1:]
		}
		if name != fileName {
			continue
		}

		rc, err := f.Open()
		if err != nil {
			return "", fmt.Errorf("cannot open %s in zip: %w", fileName, err)
		}
		defer rc.Close()

		data, err := io.ReadAll(rc)
		if err != nil {
			return "", fmt.Errorf("cannot read %s: %w", fileName, err)
		}
		return string(data), nil
	}

	return "", fmt.Errorf("%s not found in zip", fileName)
}
