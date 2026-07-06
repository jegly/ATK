package main

import (
	"net/http"
	"os"
	"os/exec"
	"path/filepath"
)

// fileHandler serves device/local files to the webview (used by the Files image
// viewer) over the Wails asset server. Streaming raw bytes avoids the size
// limits WebKitGTK imposes on large base64 data: URLs.
//
// Route: /__file?src=device|local&p=<path>
func (a *App) fileHandler() http.Handler {
	return http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		q := r.URL.Query()
		p := q.Get("p")
		if p == "" {
			http.Error(w, "missing path", http.StatusBadRequest)
			return
		}
		w.Header().Set("Cache-Control", "no-store")

		if q.Get("src") == "local" {
			// ServeFile's built-in ".." rejection only applies to r.URL.Path, not to
			// a path we hand it explicitly — so confirm p resolves to a real,
			// regular file before serving it (blocks traversal to devices/pipes/dirs
			// and nonexistent paths, satisfies CodeQL go/path-injection).
			clean := filepath.Clean(p)
			info, err := os.Stat(clean)
			if err != nil || !info.Mode().IsRegular() {
				http.Error(w, "invalid path", http.StatusBadRequest)
				return
			}
			// ServeFile picks the Content-Type and supports range requests.
			http.ServeFile(w, r, clean)
			return
		}

		// Device: pull to a temp file via the file-sync protocol, then serve it.
		// `adb pull` takes the remote path as a literal argument (no device-shell
		// re-parsing), so it handles spaces/parens/etc. — unlike `adb exec-out`,
		// which mangles quoted paths. This mirrors the working Pull button.
		adbPath, err := a.getBinaryPath("adb")
		if err != nil {
			http.Error(w, err.Error(), http.StatusInternalServerError)
			return
		}
		tmp, err := os.CreateTemp("", "atk-view-*")
		if err != nil {
			http.Error(w, err.Error(), http.StatusInternalServerError)
			return
		}
		tmpPath := tmp.Name()
		tmp.Close()
		defer os.Remove(tmpPath)

		cmd := exec.Command(adbPath, "pull", p, tmpPath)
		setCommandSysProcAttr(cmd)
		if out, err := cmd.CombinedOutput(); err != nil {
			http.Error(w, "failed to read device file: "+string(out), http.StatusInternalServerError)
			return
		}
		w.Header().Set("Content-Type", mimeForName(p))
		http.ServeFile(w, r, tmpPath)
	})
}
