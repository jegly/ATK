package main

import (
	"encoding/json"
	"fmt"
	"os"
	"strings"
	"testing"
)

// TestAuditMiniAPK is a manual smoke test against a real APK on disk.
// Run: go test -run TestAuditMiniAPK -v
func TestAuditMiniAPK(t *testing.T) {
	apk := os.Getenv("AUDIT_APK")
	if apk == "" {
		apk = "/home/xyz/.local/share/apktool/framework/1.apk"
	}
	if _, err := os.Stat(apk); err != nil {
		t.Skipf("test apk not present: %v", err)
	}

	app := NewApp()
	res, err := app.AuditAPK(apk)
	if err != nil {
		t.Fatalf("AuditAPK error: %v", err)
	}
	dumpAudit(t, res)

	// Explorer: read the (binary) manifest and a resource entry.
	ent, err := app.ReadAPKEntry(res.LocalPath, "AndroidManifest.xml")
	if err != nil {
		t.Errorf("ReadAPKEntry manifest: %v", err)
	} else {
		fmt.Printf("\nentry AndroidManifest.xml: kind=%s size=%d truncated=%v hexlines=%d\n",
			ent.Kind, ent.Size, ent.Truncated, len(splitLines(ent.Hex)))
	}

	// Export builders (skip the GUI save dialog; just validate serialization).
	csv := auditToCSV(res)
	fmt.Printf("CSV rows=%d firstline=%q\n", len(splitLines(csv)), firstLine(csv))
	if b, err := json.Marshal(auditToSARIF(res)); err != nil {
		t.Errorf("SARIF marshal: %v", err)
	} else {
		fmt.Printf("SARIF bytes=%d\n", len(b))
	}
}

// TestParity compares the reference (aapt2/apksigner) parse against the pure-Go
// fallback on the same APK, so we can confirm the hybrid behaves the same.
// Run: go test -run TestParity -v   (uses AUDIT_APK or the framework apk)
func TestParity(t *testing.T) {
	apk := os.Getenv("AUDIT_APK")
	if apk == "" {
		apk = "/home/xyz/.local/share/apktool/framework/1.apk"
	}
	if _, err := os.Stat(apk); err != nil {
		t.Skipf("test apk not present: %v", err)
	}
	app := NewApp()

	ref, err := app.AuditAPK(apk) // reference path (tools present on this box)
	if err != nil {
		t.Fatalf("reference audit: %v", err)
	}

	var go_ APKAudit
	go_.Counts = map[string]int{}
	parseManifestGo(apk, &go_)
	parseCertGo(apk, &go_)
	finalizeCert(&go_)

	expCount := func(a APKAudit) (n int) {
		for _, c := range a.Components {
			if c.Exported || c.ExportedImplicit {
				n++
			}
		}
		return
	}

	fmt.Printf("\n%-16s | %-28s | %-28s\n", "field", "aapt2/apksigner (ref)", "pure-Go (fallback)")
	row := func(label, a, b string) {
		flag := ""
		if a != b {
			flag = "  <-- DIFF"
		}
		fmt.Printf("%-16s | %-28s | %-28s%s\n", label, a, b, flag)
	}
	row("package", ref.PackageName, go_.PackageName)
	row("versionName", ref.VersionName, go_.VersionName)
	row("versionCode", ref.VersionCode, go_.VersionCode)
	row("minSdk", ref.MinSDK, go_.MinSDK)
	row("targetSdk", ref.TargetSDK, go_.TargetSDK)
	row("permissions", itoa(len(ref.Permissions)), itoa(len(go_.Permissions)))
	row("components", itoa(len(ref.Components)), itoa(len(go_.Components)))
	row("exported", itoa(expCount(ref)), itoa(expCount(go_)))
	row("debuggable", b2s(ref.Debuggable), b2s(go_.Debuggable))
	row("allowBackup", b2s(ref.AllowBackup), b2s(go_.AllowBackup))
	row("cert.verified", b2s(ref.Cert.Verified), b2s(go_.Cert.Verified))
	row("cert.v1/v2/v3", schemes(ref.Cert), schemes(go_.Cert))
	row("cert.sha256", trunc16(ref.Cert.SHA256), trunc16(go_.Cert.SHA256))

	if ref.PackageName != go_.PackageName {
		t.Errorf("package mismatch: %q vs %q", ref.PackageName, go_.PackageName)
	}
	if ref.Cert.SHA256 != "" && go_.Cert.SHA256 != "" && ref.Cert.SHA256 != go_.Cert.SHA256 {
		t.Errorf("cert SHA-256 mismatch: %q vs %q", ref.Cert.SHA256, go_.Cert.SHA256)
	}
}

func itoa(n int) string         { return fmt.Sprintf("%d", n) }
func b2s(b bool) string         { return fmt.Sprintf("%v", b) }
func schemes(c APKCertInfo) string { return fmt.Sprintf("%v/%v/%v", c.V1, c.V2, c.V3) }
func trunc16(s string) string {
	if len(s) > 16 {
		return s[:16] + "…"
	}
	return s
}

func splitLines(s string) []string {
	if s == "" {
		return nil
	}
	var n []string
	for _, l := range strings.Split(s, "\n") {
		if l != "" {
			n = append(n, l)
		}
	}
	return n
}

// TestAuditInstalled audits a package off the connected device.
// Run: AUDIT_PKG=com.android.settings go test -run TestAuditInstalled -v
func TestAuditInstalled(t *testing.T) {
	pkg := os.Getenv("AUDIT_PKG")
	if pkg == "" {
		t.Skip("set AUDIT_PKG to audit an installed package")
	}
	app := NewApp()
	res, err := app.AuditInstalledApp(pkg)
	if err != nil {
		t.Fatalf("AuditInstalledApp error: %v", err)
	}
	dumpAudit(t, res)
}

func dumpAudit(t *testing.T, res APKAudit) {
	t.Helper()

	fmt.Printf("\n=== %s  (%s v%s)\n", res.AppLabel, res.PackageName, res.VersionName)
	fmt.Printf("score=%d grade=%s  min=%s target=%s\n", res.Score, res.Grade, res.MinSDK, res.TargetSDK)
	fmt.Printf("perms=%d components=%d files=%d trackers=%d findings=%d\n",
		len(res.Permissions), len(res.Components), len(res.Files), len(res.Trackers), len(res.Findings))
	fmt.Printf("cert: verified=%v v1=%v v2=%v v3=%v debug=%v err=%q\n",
		res.Cert.Verified, res.Cert.V1, res.Cert.V2, res.Cert.V3, res.Cert.IsDebug, res.Cert.Error)
	fmt.Printf("flags: debuggable=%v allowBackup=%v cleartext=%v nsc=%v\n",
		res.Debuggable, res.AllowBackup, res.UsesCleartext, res.HasNSC)
	fmt.Println("counts:", res.Counts)
	fmt.Println("--- findings ---")
	for _, f := range res.Findings {
		fmt.Printf("[%-8s] %-40s (%d matches) %s %s\n", f.Severity, f.Title, len(f.Matches), f.CWE, f.Masvs)
	}
	fmt.Println("--- trackers ---")
	for _, tr := range res.Trackers {
		fmt.Printf("  %-22s %-16s x%d\n", tr.Name, tr.Category, tr.Matches)
	}

	if res.PackageName == "" {
		t.Error("expected a package name from aapt2")
	}
	// quick JSON round-trip to ensure it serializes for the frontend
	if _, err := json.Marshal(res); err != nil {
		t.Errorf("json marshal failed: %v", err)
	}
}
