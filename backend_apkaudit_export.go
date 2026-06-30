package main

// Explorer entry viewer + findings export (JSON / CSV / SARIF) for the APK auditor.

import (
	"archive/zip"
	"bytes"
	"encoding/base64"
	"encoding/csv"
	"encoding/json"
	"fmt"
	"io"
	"os"
	"path/filepath"
	"strconv"
	"strings"
)

const (
	entryTextCap  = 1 << 20  // 1 MB of text shown
	entryImageCap = 8 << 20  // 8 MB max image
	entryHexCap   = 16 << 10 // 16 KB hex preview
)

type APKEntryContent struct {
	Name      string `json:"name"`
	Size      int64  `json:"size"`
	Kind      string `json:"kind"` // text | image | binary
	Mime      string `json:"mime"`
	Text      string `json:"text"`
	Base64    string `json:"base64"`
	Hex       string `json:"hex"`
	Truncated bool   `json:"truncated"`
}

// ReadAPKEntry opens a single entry inside an APK and returns a viewable form:
// text, base64-encoded image, or a hex preview for binaries.
func (a *App) ReadAPKEntry(apkPath, entry string) (APKEntryContent, error) {
	if apkPath == "" || entry == "" {
		return APKEntryContent{}, fmt.Errorf("missing apk path or entry name")
	}
	if _, err := os.Stat(apkPath); err != nil {
		return APKEntryContent{}, fmt.Errorf("APK no longer available: %s", apkPath)
	}
	zr, err := zip.OpenReader(apkPath)
	if err != nil {
		return APKEntryContent{}, fmt.Errorf("open apk: %w", err)
	}
	defer zr.Close()

	var f *zip.File
	for _, e := range zr.File {
		if e.Name == entry {
			f = e
			break
		}
	}
	if f == nil {
		return APKEntryContent{}, fmt.Errorf("entry not found: %s", entry)
	}

	res := APKEntryContent{Name: entry, Size: int64(f.UncompressedSize64), Mime: mimeForName(entry)}

	if isImageName(entry) {
		data, _ := readEntryBytes(f, entryImageCap)
		res.Kind = "image"
		res.Base64 = base64.StdEncoding.EncodeToString(data)
		res.Truncated = int64(len(data)) < res.Size
		return res, nil
	}

	data, truncated := readEntryBytes(f, entryTextCap)
	if isTextBytes(data) {
		res.Kind = "text"
		res.Text = string(data)
		res.Truncated = truncated
		return res, nil
	}

	// binary: hex preview of the first chunk
	preview := data
	if len(preview) > entryHexCap {
		preview = preview[:entryHexCap]
		truncated = true
	}
	res.Kind = "binary"
	res.Hex = hexDump(preview)
	res.Truncated = truncated || int64(len(data)) < res.Size
	return res, nil
}

// ExportAudit writes the audit to disk in the requested format via a save
// dialog and returns the chosen path ("" if the user cancelled).
func (a *App) ExportAudit(audit APKAudit, format string) (string, error) {
	var content []byte
	var ext string
	switch strings.ToLower(format) {
	case "json":
		ext = "json"
		b, err := json.MarshalIndent(audit, "", "  ")
		if err != nil {
			return "", err
		}
		content = b
	case "csv":
		ext = "csv"
		content = []byte(auditToCSV(audit))
	case "sarif":
		ext = "sarif"
		b, err := json.MarshalIndent(auditToSARIF(audit), "", "  ")
		if err != nil {
			return "", err
		}
		content = b
	default:
		return "", fmt.Errorf("unknown export format: %s", format)
	}

	base := audit.PackageName
	if base == "" {
		base = strings.TrimSuffix(audit.FileName, filepath.Ext(audit.FileName))
	}
	if base == "" {
		base = "apk-audit"
	}
	path, err := a.SelectSaveFile(base + "-audit." + ext)
	if err != nil || path == "" {
		return "", err
	}
	if err := os.WriteFile(path, content, 0o644); err != nil {
		return "", fmt.Errorf("write %s: %w", path, err)
	}
	return path, nil
}

// ---------------------------------------------------------------------------
// Export builders
// ---------------------------------------------------------------------------

func auditToCSV(audit APKAudit) string {
	var buf bytes.Buffer
	w := csv.NewWriter(&buf)
	_ = w.Write([]string{"severity", "category", "title", "cwe", "masvs", "confidence", "file", "match"})
	for _, f := range audit.Findings {
		conf := strconv.Itoa(f.Confidence)
		if len(f.Matches) == 0 {
			_ = w.Write([]string{f.Severity, f.Category, f.Title, f.CWE, f.Masvs, conf, "", ""})
			continue
		}
		for _, m := range f.Matches {
			_ = w.Write([]string{f.Severity, f.Category, f.Title, f.CWE, f.Masvs, conf, m.File, m.Value})
		}
	}
	w.Flush()
	return buf.String()
}

// auditToSARIF emits a minimal SARIF 2.1.0 log suitable for GitHub code scanning.
func auditToSARIF(audit APKAudit) map[string]any {
	levelFor := func(sev string) string {
		switch sev {
		case "critical", "high":
			return "error"
		case "medium":
			return "warning"
		default:
			return "note"
		}
	}

	seenRule := map[string]bool{}
	var rules []map[string]any
	var results []map[string]any

	for _, f := range audit.Findings {
		if !seenRule[f.ID] {
			seenRule[f.ID] = true
			rule := map[string]any{
				"id":               f.ID,
				"name":             f.Title,
				"shortDescription": map[string]any{"text": f.Title},
				"fullDescription":  map[string]any{"text": f.Description},
				"defaultConfiguration": map[string]any{"level": levelFor(f.Severity)},
				"properties": map[string]any{
					"cwe":      f.CWE,
					"masvs":    f.Masvs,
					"severity": f.Severity,
				},
			}
			rules = append(rules, rule)
		}

		locations := []map[string]any{}
		for _, m := range f.Matches {
			uri := m.File
			if uri == "" {
				uri = audit.FileName
			}
			locations = append(locations, map[string]any{
				"physicalLocation": map[string]any{
					"artifactLocation": map[string]any{"uri": uri},
				},
				"message": map[string]any{"text": m.Value},
			})
		}
		if len(locations) == 0 {
			locations = append(locations, map[string]any{
				"physicalLocation": map[string]any{
					"artifactLocation": map[string]any{"uri": audit.FileName},
				},
			})
		}

		results = append(results, map[string]any{
			"ruleId":    f.ID,
			"level":     levelFor(f.Severity),
			"message":   map[string]any{"text": f.Title + " — " + f.Description},
			"locations": locations,
		})
	}

	return map[string]any{
		"$schema": "https://json.schemastore.org/sarif-2.1.0.json",
		"version": "2.1.0",
		"runs": []map[string]any{{
			"tool": map[string]any{
				"driver": map[string]any{
					"name":           "ATK APK Auditor",
					"informationUri": "https://github.com/jegly/ATK",
					"rules":          rules,
				},
			},
			"properties": map[string]any{
				"package": audit.PackageName,
				"version": audit.VersionName,
				"score":   audit.Score,
				"grade":   audit.Grade,
			},
			"results": results,
		}},
	}
}

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

func cleanStaleAuditTemps() {
	matches, _ := filepath.Glob(filepath.Join(os.TempDir(), "atk-audit-*.apk"))
	for _, m := range matches {
		os.Remove(m)
	}
}

func readEntryBytes(f *zip.File, limit int) ([]byte, bool) {
	rc, err := f.Open()
	if err != nil {
		return nil, false
	}
	defer rc.Close()
	data, err := io.ReadAll(io.LimitReader(rc, int64(limit)+1))
	if err != nil {
		return data, false
	}
	if len(data) > limit {
		return data[:limit], true
	}
	return data, false
}

func isTextBytes(data []byte) bool {
	if len(data) == 0 {
		return true
	}
	nonprint := 0
	for _, b := range data {
		if b == 0 {
			return false
		}
		if b < 0x09 || (b > 0x0d && b < 0x20) {
			nonprint++
		}
	}
	return float64(nonprint)/float64(len(data)) < 0.05
}

func hexDump(data []byte) string {
	var b strings.Builder
	for i := 0; i < len(data); i += 16 {
		end := i + 16
		if end > len(data) {
			end = len(data)
		}
		row := data[i:end]
		b.WriteString(fmt.Sprintf("%08x  ", i))
		for j := 0; j < 16; j++ {
			if j < len(row) {
				b.WriteString(fmt.Sprintf("%02x ", row[j]))
			} else {
				b.WriteString("   ")
			}
			if j == 7 {
				b.WriteByte(' ')
			}
		}
		b.WriteString(" |")
		for _, c := range row {
			if c >= 0x20 && c < 0x7f {
				b.WriteByte(c)
			} else {
				b.WriteByte('.')
			}
		}
		b.WriteString("|\n")
	}
	return b.String()
}

func isImageName(name string) bool {
	switch strings.ToLower(filepath.Ext(name)) {
	case ".png", ".jpg", ".jpeg", ".gif", ".webp", ".bmp", ".ico":
		return true
	}
	return false
}

func mimeForName(name string) string {
	switch strings.ToLower(filepath.Ext(name)) {
	case ".png":
		return "image/png"
	case ".jpg", ".jpeg":
		return "image/jpeg"
	case ".gif":
		return "image/gif"
	case ".webp":
		return "image/webp"
	case ".bmp":
		return "image/bmp"
	case ".ico":
		return "image/x-icon"
	case ".svg":
		return "image/svg+xml"
	case ".json":
		return "application/json"
	case ".xml":
		return "text/xml"
	default:
		return "application/octet-stream"
	}
}
