package main

import (
	"crypto/sha256"
	"encoding/hex"
	"fmt"
	"io"
	"net/http"
	"os"
	"regexp"
	"strings"
	"time"

	"github.com/wailsapp/wails/v2/pkg/runtime"
)

// In-app firmware download: scrape Google's public factory/OTA image listing
// for a device codename, then download the chosen build with a progress bar and
// SHA-256 verification. Emits firmware:progress / firmware:done events.

type Firmware struct {
	Version string `json:"version"`
	URL     string `json:"url"`
	SHA256  string `json:"sha256"`
}

var sha256Re = regexp.MustCompile(`[0-9a-fA-F]{64}`)

// ListFirmware returns available builds for a codename. kind = "factory" | "ota".
func (a *App) ListFirmware(codename, kind string) ([]Firmware, error) {
	codename = strings.ToLower(strings.TrimSpace(codename))
	if codename == "" {
		return nil, fmt.Errorf("enter a device codename (e.g. oriole, raven, panther, husky)")
	}

	var pageURL, cookie string
	var urlRe *regexp.Regexp
	if kind == "ota" {
		pageURL = "https://developers.google.com/android/ota"
		cookie = "devsite_wall_acks=nexus-ota-tos"
		urlRe = regexp.MustCompile(`https://dl\.google\.com/dl/android/aosp/` + regexp.QuoteMeta(codename) + `-ota-[\w.]+-[0-9a-f]+\.zip`)
	} else {
		pageURL = "https://developers.google.com/android/images"
		cookie = "devsite_wall_acks=nexus-image-tos"
		urlRe = regexp.MustCompile(`https://dl\.google\.com/dl/android/aosp/` + regexp.QuoteMeta(codename) + `-[\w.]+-factory-[0-9a-f]+\.zip`)
	}

	req, _ := http.NewRequest("GET", pageURL, nil)
	req.Header.Set("User-Agent", "Mozilla/5.0 ATK")
	req.Header.Set("Cookie", cookie)
	resp, err := (&http.Client{Timeout: 30 * time.Second}).Do(req)
	if err != nil {
		return nil, fmt.Errorf("could not reach Google's image server: %w", err)
	}
	defer resp.Body.Close()
	body, _ := io.ReadAll(resp.Body)
	html := string(body)

	// The row's Version cell precedes the link, e.g. "15.0.0 (BP1A.250505.005, May 2025)".
	verRe := regexp.MustCompile(`\d+\.\d+\.\d+ \([^)]+\)`)

	var out []Firmware
	seen := map[string]bool{}
	for _, loc := range urlRe.FindAllStringIndex(html, -1) {
		url := html[loc[0]:loc[1]]
		if seen[url] {
			continue
		}
		seen[url] = true

		sha := ""
		end := loc[1] + 800
		if end > len(html) {
			end = len(html)
		}
		if m := sha256Re.FindString(html[loc[1]:end]); m != "" {
			sha = strings.ToLower(m)
		}

		// Look back for the human version+date string in the same row.
		version := firmwareVersion(url, codename, kind)
		start := loc[0] - 800
		if start < 0 {
			start = 0
		}
		if vs := verRe.FindAllString(html[start:loc[0]], -1); len(vs) > 0 {
			version = vs[len(vs)-1]
		}

		out = append(out, Firmware{Version: version, URL: url, SHA256: sha})
	}
	if len(out) == 0 {
		return nil, fmt.Errorf("no %s images found for %q — double-check the codename", kind, codename)
	}
	return out, nil
}

func firmwareVersion(url, cn, kind string) string {
	base := url[strings.LastIndex(url, "/")+1:]
	base = strings.TrimSuffix(base, ".zip")
	base = strings.TrimPrefix(base, cn+"-")
	if kind == "ota" {
		base = strings.TrimPrefix(base, "ota-")
	}
	if i := strings.Index(base, "-factory-"); i >= 0 {
		return base[:i]
	}
	if i := strings.LastIndex(base, "-"); i >= 0 {
		return base[:i]
	}
	return base
}

// DownloadFirmware downloads url to a chosen path, streaming progress and
// verifying the SHA-256. Cancellable via CancelOperation().
func (a *App) DownloadFirmware(url, expectedSHA string) (string, error) {
	name := url[strings.LastIndex(url, "/")+1:]
	path, err := a.SelectSaveFile(name)
	if err != nil {
		return "", err
	}
	if path == "" {
		return "Download cancelled.", nil
	}

	ctx, cancel := a.beginCancellableOp(0)
	defer cancel()

	req, _ := http.NewRequestWithContext(ctx, "GET", url, nil)
	req.Header.Set("User-Agent", "Mozilla/5.0 ATK")
	resp, err := http.DefaultClient.Do(req)
	if err != nil {
		return "", fmt.Errorf("download failed: %w", err)
	}
	defer resp.Body.Close()
	if resp.StatusCode != 200 {
		return "", fmt.Errorf("server returned %d", resp.StatusCode)
	}

	f, err := os.Create(path)
	if err != nil {
		return "", err
	}
	defer f.Close()

	h := sha256.New()
	pw := &fwProgressWriter{app: a, total: resp.ContentLength, lastPct: -1}
	_, copyErr := io.Copy(io.MultiWriter(f, h, pw), resp.Body)
	runtime.EventsEmit(a.ctx, "firmware:done", nil)
	if copyErr != nil {
		if ctx.Err() != nil {
			return "", fmt.Errorf("cancelled")
		}
		return "", fmt.Errorf("download error: %w", copyErr)
	}

	if expectedSHA != "" {
		got := hex.EncodeToString(h.Sum(nil))
		if !strings.EqualFold(got, expectedSHA) {
			return "", fmt.Errorf("SHA-256 MISMATCH — file may be corrupt.\nexpected %s\ngot      %s", expectedSHA, got)
		}
		return fmt.Sprintf("Downloaded & verified ✓\n%s", path), nil
	}
	return fmt.Sprintf("Downloaded (no checksum listed to verify)\n%s", path), nil
}

type fwProgressWriter struct {
	app     *App
	total   int64
	written int64
	lastPct int
}

func (p *fwProgressWriter) Write(b []byte) (int, error) {
	n := len(b)
	p.written += int64(n)
	if p.total > 0 {
		pct := int(p.written * 100 / p.total)
		if pct != p.lastPct {
			p.lastPct = pct
			runtime.EventsEmit(p.app.ctx, "firmware:progress", map[string]interface{}{"percent": pct})
		}
	}
	return n, nil
}
