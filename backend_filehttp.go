package main

import (
	"net/http"
	"os"
	"os/exec"
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
			// ServeFile picks the Content-Type and supports range requests.
			http.ServeFile(w, r, p)
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
