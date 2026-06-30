package main

// APK Auditor — static analysis of an APK (local file or installed package).
//
// Clean-room implementation. The feature concept (a tabbed APK static auditor:
// overview/findings/manifest/components/cert/explorer) is inspired by
// apkauditor.com by Sandeep Wawdane, but none of its code is used here — this
// engine is written from scratch in Go and shells out to the Android SDK
// build-tools (aapt2, apksigner) plus the JBR's keytool for the heavy parsing.

import (
	"archive/zip"
	"context"
	"fmt"
	"os"
	"path/filepath"
	"sort"
	"strings"
	"time"

	"github.com/ncruces/zenity"
)

// ---------------------------------------------------------------------------
// Result types (JSON-tagged for the Wails frontend)
// ---------------------------------------------------------------------------

type APKAudit struct {
	// Source
	Source    string `json:"source"`    // "file" | "device"
	Path      string `json:"path"`      // display path (remote path for device source)
	LocalPath string `json:"localPath"` // on-disk APK to read entries from (Explorer/export)
	FileName  string `json:"fileName"`
	FileSize int64  `json:"fileSize"`
	SHA256   string `json:"sha256"`

	// Metadata
	PackageName string `json:"packageName"`
	AppLabel    string `json:"appLabel"`
	VersionName string `json:"versionName"`
	VersionCode string `json:"versionCode"`
	MinSDK      string `json:"minSdk"`
	TargetSDK   string `json:"targetSdk"`
	CompileSDK  string `json:"compileSdk"`

	// Manifest-level flags
	Debuggable    bool `json:"debuggable"`
	AllowBackup   bool `json:"allowBackup"`
	UsesCleartext bool `json:"usesCleartext"`
	HasNSC        bool `json:"hasNetworkSecurityConfig"`

	Permissions []Permission `json:"permissions"`
	Components  []Component  `json:"components"`
	Cert        APKCertInfo     `json:"cert"`
	Findings    []Finding    `json:"findings"`
	Trackers    []Tracker    `json:"trackers"`
	Files       []APKFileEntry  `json:"files"`
	ManifestXML string       `json:"manifestXml"`

	// Scoring
	Score  int            `json:"score"`  // 0-100
	Grade  string         `json:"grade"`  // A-F
	Counts map[string]int `json:"counts"` // severity -> count

	noManifestMF bool // transient: no META-INF/MANIFEST.MF in the archive
}

type Permission struct {
	Name      string `json:"name"`
	Dangerous bool   `json:"dangerous"`
}

type Component struct {
	Type             string   `json:"type"` // activity|service|receiver|provider
	Name             string   `json:"name"`
	Exported         bool     `json:"exported"`
	ExportedImplicit bool     `json:"exportedImplicit"`
	Permission       string   `json:"permission"`
	IntentFilters    []string `json:"intentFilters"`

	explicitExported bool // set when android:exported was present (not serialized)
}

type APKCertInfo struct {
	Verified  bool   `json:"verified"`
	Subject   string `json:"subject"`
	Issuer    string `json:"issuer"`
	SigAlgo   string `json:"sigAlgo"`
	Serial    string `json:"serial"`
	SHA256    string `json:"sha256"`
	SHA1      string `json:"sha1"`
	ValidFrom string `json:"validFrom"`
	ValidTo   string `json:"validTo"`
	V1        bool   `json:"v1"`
	V2        bool   `json:"v2"`
	V3        bool   `json:"v3"`
	IsDebug   bool   `json:"isDebug"`
	Expired   bool   `json:"expired"`
	WeakAlgo  bool   `json:"weakAlgo"`
	Error     string `json:"error"`
}

type Finding struct {
	ID          string         `json:"id"`
	Title       string         `json:"title"`
	Severity    string         `json:"severity"` // critical|high|medium|low|info
	Category    string         `json:"category"`
	Description string         `json:"description"`
	CWE         string         `json:"cwe"`
	Masvs       string         `json:"masvs"`
	Confidence  int            `json:"confidence"`
	Matches     []FindingMatch `json:"matches"`
}

type FindingMatch struct {
	File  string `json:"file"`
	Value string `json:"value"`
}

type Tracker struct {
	Name     string `json:"name"`
	Category string `json:"category"`
	Matches  int    `json:"matches"`
}

type APKFileEntry struct {
	Path       string `json:"path"`
	Size       int64  `json:"size"`
	Compressed int64  `json:"compressed"`
}

// ---------------------------------------------------------------------------
// Tunables
// ---------------------------------------------------------------------------

const (
	auditCommandTimeout = 90 * time.Second
	maxDexBytes         = 64 << 20 // skip a single dex larger than 64 MB
	maxCandidates       = 250000   // cap extracted strings scanned
	maxMatchesPerRule   = 25       // cap reported instances per finding
	minStringLen        = 6
)

// ---------------------------------------------------------------------------
// Public API (auto-bound to the frontend via the single App bind)
// ---------------------------------------------------------------------------

// SelectAPKForAudit opens a native file picker filtered to APKs.
func (a *App) SelectAPKForAudit() (string, error) {
	path, err := zenity.SelectFile(
		zenity.Title("Select APK to audit"),
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

// AuditInstalledApp pulls the base APK of an installed package off the device
// into a temp file, audits it, then removes the temp copy.
func (a *App) AuditInstalledApp(packageName string) (APKAudit, error) {
	if err := validatePackageName(packageName); err != nil {
		return APKAudit{}, err
	}

	out, err := a.runAdbShell("pm", "path", packageName)
	if err != nil {
		return APKAudit{}, fmt.Errorf("could not locate package on device: %w", err)
	}

	var remote string
	for _, line := range strings.Split(out, "\n") {
		line = strings.TrimSpace(line)
		p := strings.TrimPrefix(line, "package:")
		if strings.HasSuffix(p, "base.apk") {
			remote = p
			break
		}
		if remote == "" && strings.HasSuffix(p, ".apk") {
			remote = p // fall back to the first apk if no base.apk
		}
	}
	if remote == "" {
		return APKAudit{}, fmt.Errorf("no APK path found for %s", packageName)
	}

	// Remove temps from earlier device audits, then keep this one on disk so
	// the Explorer/export can read entries from it after the audit returns.
	cleanStaleAuditTemps()
	tmp := filepath.Join(os.TempDir(), "atk-audit-"+sanitizeFileToken(packageName)+".apk")
	if _, err := a.runCommandTimeout(auditCommandTimeout, "adb", "pull", remote, tmp); err != nil {
		return APKAudit{}, fmt.Errorf("failed to pull APK: %w", err)
	}

	audit, err := a.auditFile(tmp)
	if err != nil {
		os.Remove(tmp)
		return audit, err
	}
	audit.Source = "device"
	audit.Path = remote
	audit.LocalPath = tmp
	audit.FileName = packageName + " (base.apk)"
	return audit, nil
}

// AuditAPK audits a local APK file path.
func (a *App) AuditAPK(path string) (APKAudit, error) {
	if strings.TrimSpace(path) == "" {
		return APKAudit{}, fmt.Errorf("no APK path provided")
	}
	if info, err := os.Stat(path); err != nil || info.IsDir() {
		return APKAudit{}, fmt.Errorf("file not found: %s", path)
	}
	audit, err := a.auditFile(path)
	if err != nil {
		return audit, err
	}
	audit.Source = "file"
	return audit, nil
}

// ---------------------------------------------------------------------------
// Core pipeline
// ---------------------------------------------------------------------------

func (a *App) auditFile(path string) (APKAudit, error) {
	audit := APKAudit{
		Path:      path,
		LocalPath: path,
		FileName:  filepath.Base(path),
		Counts:    map[string]int{},
	}

	if info, err := os.Stat(path); err == nil {
		audit.FileSize = info.Size()
	}
	if sum, err := fileSHA256(path); err == nil {
		audit.SHA256 = sum
	}

	ctx, cancel := context.WithTimeout(context.Background(), auditCommandTimeout)
	defer cancel()

	// 1. Manifest + metadata: aapt2 when available, else pure-Go fallback.
	a.parseManifestHybrid(ctx, path, &audit)

	// 2. Signing certificate: apksigner+keytool when available, else pure-Go.
	a.parseCertHybrid(ctx, path, &audit)

	// 3. ZIP walk: file tree + dex string extraction for code/secret/tracker rules.
	a.scanArchive(path, &audit)

	// 4. Manifest-derived findings.
	a.deriveManifestFindings(&audit)

	// 5. Score.
	a.scoreAudit(&audit)

	return audit, nil
}

// ---------------------------------------------------------------------------
// aapt2: badging
// ---------------------------------------------------------------------------

func (a *App) parseBadging(ctx context.Context, path string, audit *APKAudit) {
	out, err := a.runBuildTool(ctx, "aapt2", "dump", "badging", path)
	if err != nil || out == "" {
		return
	}
	for _, line := range strings.Split(out, "\n") {
		line = strings.TrimSpace(line)
		switch {
		case strings.HasPrefix(line, "package:"):
			audit.PackageName = badgingField(line, "name")
			audit.VersionCode = badgingField(line, "versionCode")
			audit.VersionName = badgingField(line, "versionName")
			audit.CompileSDK = badgingField(line, "compileSdkVersion")
		case strings.HasPrefix(line, "sdkVersion:"):
			audit.MinSDK = strings.Trim(strings.TrimPrefix(line, "sdkVersion:"), "'")
		case strings.HasPrefix(line, "targetSdkVersion:"):
			audit.TargetSDK = strings.Trim(strings.TrimPrefix(line, "targetSdkVersion:"), "'")
		case strings.HasPrefix(line, "application-label:"):
			if audit.AppLabel == "" {
				audit.AppLabel = strings.Trim(strings.TrimPrefix(line, "application-label:"), "'")
			}
		case strings.HasPrefix(line, "uses-permission:"):
			name := badgingField(line, "name")
			if name != "" {
				audit.Permissions = append(audit.Permissions, Permission{
					Name:      name,
					Dangerous: dangerousPermissions[name],
				})
			}
		}
	}
}

// badgingField extracts key='value' from an aapt2 badging line.
func badgingField(line, key string) string {
	marker := key + "='"
	i := strings.Index(line, marker)
	if i < 0 {
		return ""
	}
	rest := line[i+len(marker):]
	j := strings.Index(rest, "'")
	if j < 0 {
		return rest
	}
	return rest[:j]
}

// ---------------------------------------------------------------------------
// aapt2: xmltree manifest parse (components, exported flags, intent filters,
// application flags) + a readable reconstruction for the Manifest tab.
// ---------------------------------------------------------------------------

func (a *App) parseManifestTree(ctx context.Context, path string, audit *APKAudit) {
	out, err := a.runBuildTool(ctx, "aapt2", "dump", "xmltree", path, "--file", "AndroidManifest.xml")
	if err != nil || out == "" {
		return
	}
	audit.ManifestXML = out

	// Frames store the component index (not a pointer) so appends to
	// audit.Components can't leave us holding a stale pointer.
	type frame struct {
		indent  int
		name    string
		compIdx int // -1 when the element is not a component
	}
	var stack []frame

	curComp := func() int {
		for i := len(stack) - 1; i >= 0; i-- {
			if stack[i].compIdx >= 0 {
				return stack[i].compIdx
			}
		}
		return -1
	}
	top := func() string {
		if len(stack) == 0 {
			return ""
		}
		return stack[len(stack)-1].name
	}

	for _, raw := range strings.Split(out, "\n") {
		indent := countIndent(raw)
		line := strings.TrimSpace(raw)

		switch {
		case strings.HasPrefix(line, "E:"):
			for len(stack) > 0 && stack[len(stack)-1].indent >= indent {
				stack = stack[:len(stack)-1]
			}
			elem := elementName(line)
			switch elem {
			case "activity", "activity-alias", "service", "receiver", "provider":
				typ := elem
				if typ == "activity-alias" {
					typ = "activity"
				}
				audit.Components = append(audit.Components, Component{Type: typ})
				stack = append(stack, frame{indent: indent, name: elem, compIdx: len(audit.Components) - 1})
			case "intent-filter":
				if ci := curComp(); ci >= 0 {
					audit.Components[ci].IntentFilters = append(audit.Components[ci].IntentFilters, "")
				}
				stack = append(stack, frame{indent: indent, name: elem, compIdx: -1})
			default:
				stack = append(stack, frame{indent: indent, name: elem, compIdx: -1})
			}

		case strings.HasPrefix(line, "A:"):
			attr, val := manifestAttr(line)
			switch top() {
			case "uses-sdk":
				if attr == "minSdkVersion" && audit.MinSDK == "" {
					audit.MinSDK = val
				}
				if attr == "targetSdkVersion" && audit.TargetSDK == "" {
					audit.TargetSDK = val
				}
			case "application":
				switch attr {
				case "debuggable":
					audit.Debuggable = isTrue(val)
				case "allowBackup":
					audit.AllowBackup = isTrue(val)
				case "usesCleartextTraffic":
					audit.UsesCleartext = isTrue(val)
				case "networkSecurityConfig":
					audit.HasNSC = true
				}
			case "activity", "activity-alias", "service", "receiver", "provider":
				if ci := curComp(); ci >= 0 {
					switch attr {
					case "name":
						audit.Components[ci].Name = val
					case "exported":
						audit.Components[ci].Exported = isTrue(val)
						audit.Components[ci].explicitExported = true
					case "permission":
						audit.Components[ci].Permission = val
					}
				}
			case "action", "category":
				if attr == "name" {
					if ci := curComp(); ci >= 0 && len(audit.Components[ci].IntentFilters) > 0 {
						idx := len(audit.Components[ci].IntentFilters) - 1
						sep := ""
						if audit.Components[ci].IntentFilters[idx] != "" {
							sep = ", "
						}
						audit.Components[ci].IntentFilters[idx] += sep + shortName(val)
					}
				}
			}
		}
	}

	// Defaults the tree walk can't see: allowBackup defaults on when absent;
	// cleartext defaults on for targetSdk < 28.
	if !strings.Contains(out, "allowBackup") {
		audit.AllowBackup = true
	}
	if !strings.Contains(out, "usesCleartextTraffic") {
		if t := atoiSafe(audit.TargetSDK); t > 0 && t < 28 {
			audit.UsesCleartext = true
		}
	}

	// Implicit export: an intent-filter present with no explicit android:exported
	// means the component is reachable by other apps (pre-Android 12 behaviour).
	for i := range audit.Components {
		c := &audit.Components[i]
		if !c.Exported && !c.explicitExported && len(c.IntentFilters) > 0 {
			c.ExportedImplicit = true
		}
	}
}

// ---------------------------------------------------------------------------
// Signing certificate
// ---------------------------------------------------------------------------

// parseManifestHybrid uses aapt2 when present (reference parse), otherwise the
// pure-Go apkparser fallback. Both populate the same audit fields.
func (a *App) parseManifestHybrid(ctx context.Context, path string, audit *APKAudit) {
	if a.hasBuildTool("aapt2") {
		a.parseBadging(ctx, path, audit)
		a.parseManifestTree(ctx, path, audit)
		if audit.PackageName != "" {
			return // aapt2 succeeded
		}
	}
	parseManifestGo(path, audit)
}

// parseCertHybrid resolves the signing certificate. The pure-Go x509 path
// (apkverifier) always owns cert *identity* — subject/issuer/serial/validity/
// algorithm/fingerprints — because it is accurate, consistent across machines,
// and needs no JDK. When apksigner is available it additionally refines the
// authoritative per-scheme booleans (v1/v2/v3 reported independently, which
// apksigner does better than a single "highest scheme" number).
func (a *App) parseCertHybrid(ctx context.Context, path string, audit *APKAudit) {
	parseCertGo(path, audit)
	if a.hasBuildTool("apksigner") && findJBR() != "" {
		a.refineSchemesApksigner(ctx, path, audit)
	}
	finalizeCert(audit)
}

// refineSchemesApksigner overlays apksigner's authoritative verification result
// (verified + independent v1/v2/v3 flags) onto the Go-parsed cert. It ignores
// the Play "Source Stamp" signer, which is not the app's signing certificate.
func (a *App) refineSchemesApksigner(ctx context.Context, path string, audit *APKAudit) {
	out, _ := a.runBuildToolJava(ctx, "apksigner", "verify", "--verbose", path)
	if out == "" {
		return
	}
	var v1, v2, v3, verifies, sawScheme bool
	for _, line := range strings.Split(out, "\n") {
		l := strings.TrimSpace(line)
		if strings.Contains(l, "Source Stamp") {
			continue
		}
		switch {
		case l == "Verifies":
			verifies = true
		case strings.HasPrefix(l, "Verified using v1 scheme"):
			v1 = strings.HasSuffix(l, "true")
			sawScheme = true
		case strings.HasPrefix(l, "Verified using v2 scheme"):
			v2 = strings.HasSuffix(l, "true")
			sawScheme = true
		case strings.Contains(l, "v3 scheme"), strings.Contains(l, "v3.1 scheme"), strings.Contains(l, "v3.2 scheme"):
			if strings.HasPrefix(l, "Verified using") && strings.HasSuffix(l, "true") {
				v3 = true
			}
			sawScheme = true
		}
	}
	if sawScheme {
		audit.Cert.Verified = verifies
		audit.Cert.V1, audit.Cert.V2, audit.Cert.V3 = v1, v2, v3
	}
}

// ---------------------------------------------------------------------------
// ZIP / DEX scanning
// ---------------------------------------------------------------------------

func (a *App) scanArchive(path string, audit *APKAudit) {
	zr, err := zip.OpenReader(path)
	if err != nil {
		audit.addFinding(Finding{
			ID: "zip-open", Title: "APK archive could not be opened", Severity: "high",
			Category: "code", Description: "The APK ZIP structure could not be read: " + err.Error(),
		})
		return
	}
	defer zr.Close()

	hasManifestMF := false
	candidates := make([]candidate, 0, 4096)
	seen := make(map[string]struct{}, 4096)
	trackerHits := map[string]int{}

	for _, f := range zr.File {
		audit.Files = append(audit.Files, APKFileEntry{
			Path:       f.Name,
			Size:       int64(f.UncompressedSize64),
			Compressed: int64(f.CompressedSize64),
		})
		if f.Name == "META-INF/MANIFEST.MF" {
			hasManifestMF = true
		}

		if strings.HasPrefix(f.Name, "classes") && strings.HasSuffix(f.Name, ".dex") {
			if f.UncompressedSize64 > maxDexBytes {
				continue
			}
			data := readZipEntry(f)
			if data == nil {
				continue
			}
			extractStrings(data, f.Name, &candidates, seen)
			matchTrackers(data, trackerHits)
		}
	}

	sort.Slice(audit.Files, func(i, j int) bool { return audit.Files[i].Path < audit.Files[j].Path })

	// Tracker findings.
	for name, n := range trackerHits {
		audit.Trackers = append(audit.Trackers, Tracker{
			Name: name, Category: trackerCategory[name], Matches: n,
		})
	}
	sort.Slice(audit.Trackers, func(i, j int) bool { return audit.Trackers[i].Name < audit.Trackers[j].Name })

	// Code-pattern + secret rules over extracted strings.
	a.applyStringRules(candidates, audit)

	// A missing JAR manifest only matters when the APK also fails to verify —
	// v2/v3-only signed APKs legitimately have no META-INF/MANIFEST.MF.
	audit.noManifestMF = !hasManifestMF
}

// candidate is one extracted printable string and where it came from.
type candidate struct {
	val  string
	file string
}

// extractStrings pulls printable ASCII runs of length >= minStringLen out of a
// dex blob, de-duplicating globally, capped at maxCandidates.
func extractStrings(data []byte, file string, out *[]candidate, seen map[string]struct{}) {
	var b strings.Builder
	flush := func() {
		if b.Len() >= minStringLen {
			s := b.String()
			if _, ok := seen[s]; !ok && len(*out) < maxCandidates {
				seen[s] = struct{}{}
				*out = append(*out, candidate{val: s, file: file})
			}
		}
		b.Reset()
	}
	for _, c := range data {
		if c >= 0x20 && c < 0x7f {
			b.WriteByte(c)
		} else {
			flush()
		}
		if len(*out) >= maxCandidates {
			return
		}
	}
	flush()
}

func (a *App) applyStringRules(cands []candidate, audit *APKAudit) {
	// Code/network/crypto/webview/storage rules: substring presence.
	for _, rule := range codeRules {
		var matches []FindingMatch
		for _, c := range cands {
			hit := false
			for _, needle := range rule.needles {
				if strings.Contains(c.val, needle) {
					hit = true
					break
				}
			}
			if hit {
				if len(matches) < maxMatchesPerRule {
					matches = append(matches, FindingMatch{File: c.file, Value: truncate(c.val, 200)})
				}
			}
		}
		if len(matches) > 0 {
			audit.addFinding(Finding{
				ID: rule.id, Title: rule.title, Severity: rule.severity, Category: rule.category,
				Description: rule.description, CWE: rule.cwe, Masvs: rule.masvs,
				Confidence: rule.confidence, Matches: matches,
			})
		}
	}

	// Secret rules: regex + Shannon-entropy gate to suppress noise.
	for _, rule := range secretRules {
		var matches []FindingMatch
		for _, c := range cands {
			for _, m := range rule.re.FindAllString(c.val, -1) {
				if rule.entropyMin > 0 && shannonEntropy(m) < rule.entropyMin {
					continue
				}
				if len(matches) < maxMatchesPerRule {
					matches = append(matches, FindingMatch{File: c.file, Value: redactSecret(m)})
				}
			}
		}
		if len(matches) > 0 {
			audit.addFinding(Finding{
				ID: rule.id, Title: rule.title, Severity: rule.severity, Category: "secret",
				Description: rule.description, CWE: "CWE-798", Masvs: "MASVS-STORAGE-1",
				Confidence: rule.confidence, Matches: matches,
			})
		}
	}
}

func matchTrackers(data []byte, hits map[string]int) {
	s := string(data)
	for name, sigs := range trackerSignatures {
		for _, sig := range sigs {
			if c := strings.Count(s, sig); c > 0 {
				hits[name] += c
				break
			}
		}
	}
}

// ---------------------------------------------------------------------------
// Manifest-derived findings
// ---------------------------------------------------------------------------

func (a *App) deriveManifestFindings(audit *APKAudit) {
	if audit.Debuggable {
		audit.addFinding(Finding{
			ID: "manifest-debuggable", Title: "Application is debuggable", Severity: "high",
			Category: "manifest", Confidence: 100, CWE: "CWE-489", Masvs: "MASVS-RESILIENCE-2",
			Description: "android:debuggable=\"true\" lets anyone attach a debugger and inspect/modify the running app.",
		})
	}
	if audit.AllowBackup {
		audit.addFinding(Finding{
			ID: "manifest-allowbackup", Title: "Backups allowed (allowBackup)", Severity: "medium",
			Category: "manifest", Confidence: 90, CWE: "CWE-530", Masvs: "MASVS-STORAGE-2",
			Description: "android:allowBackup is enabled (or defaulted on). App data can be extracted over adb with `adb backup`.",
		})
	}
	if audit.UsesCleartext {
		audit.addFinding(Finding{
			ID: "manifest-cleartext", Title: "Cleartext HTTP traffic permitted", Severity: "medium",
			Category: "network", Confidence: 85, CWE: "CWE-319", Masvs: "MASVS-NETWORK-1",
			Description: "Cleartext (unencrypted HTTP) traffic is allowed, exposing data to network interception.",
		})
	}
	if !audit.HasNSC {
		audit.addFinding(Finding{
			ID: "manifest-no-nsc", Title: "No Network Security Config", Severity: "low",
			Category: "network", Confidence: 60, CWE: "CWE-295", Masvs: "MASVS-NETWORK-2",
			Description: "No networkSecurityConfig is declared, so the app relies on platform defaults (no pinning, no per-domain cleartext rules).",
		})
	}

	var exported []FindingMatch
	for _, c := range audit.Components {
		if (c.Exported || c.ExportedImplicit) && c.Permission == "" {
			label := c.Type + ": " + shortName(c.Name)
			if c.ExportedImplicit {
				label += " (implicit)"
			}
			exported = append(exported, FindingMatch{Value: label})
		}
	}
	if len(exported) > 0 {
		if len(exported) > maxMatchesPerRule {
			exported = exported[:maxMatchesPerRule]
		}
		audit.addFinding(Finding{
			ID: "exported-components", Title: "Exported components without permission",
			Severity: "medium", Category: "manifest", Confidence: 80, CWE: "CWE-926",
			Masvs:       "MASVS-PLATFORM-1",
			Description: "These components are reachable by other apps and declare no protecting permission.",
			Matches:     exported,
		})
	}

	// Signing-derived findings.
	toolMissing := strings.Contains(audit.Cert.Error, "not found")
	if !audit.Cert.Verified && !toolMissing {
		desc := "The APK signature does not verify"
		if audit.Cert.Error != "" {
			desc += " (" + audit.Cert.Error + ")"
		}
		desc += ". It is unsigned or was repacked without re-signing, so it cannot be installed on a stock device and its integrity is unverifiable."
		sev := "high"
		if audit.noManifestMF {
			sev = "critical"
		}
		audit.addFinding(Finding{
			ID: "unsigned", Title: "APK is unsigned or fails verification", Severity: sev,
			Category: "signing", Confidence: 95, CWE: "CWE-347", Masvs: "MASVS-CODE-1",
			Description: desc,
		})
	}
	if audit.Cert.IsDebug {
		audit.addFinding(Finding{
			ID: "cert-debug", Title: "Signed with a debug certificate", Severity: "high",
			Category: "signing", Confidence: 95, CWE: "CWE-321", Masvs: "MASVS-CODE-1",
			Description: "The APK is signed with the well-known Android debug key; anyone can forge a matching signature.",
		})
	}
	if audit.Cert.Expired {
		audit.addFinding(Finding{
			ID: "cert-expired", Title: "Signing certificate is expired", Severity: "low",
			Category: "signing", Confidence: 90, CWE: "CWE-298",
			Description: "The signing certificate validity period has ended.",
		})
	}
	if audit.Cert.WeakAlgo {
		audit.addFinding(Finding{
			ID: "cert-weak-algo", Title: "Weak signature algorithm", Severity: "medium",
			Category: "signing", Confidence: 95, CWE: "CWE-327", Masvs: "MASVS-CRYPTO-1",
			Description: "The certificate uses a weak signature algorithm (" + audit.Cert.SigAlgo + ").",
		})
	}
	if audit.Cert.Verified && audit.Cert.V1 && !audit.Cert.V2 && !audit.Cert.V3 {
		audit.addFinding(Finding{
			ID: "cert-v1-only", Title: "v1-only signing (Janus exploit)", Severity: "medium",
			Category: "signing", Confidence: 90, CWE: "CWE-347", Masvs: "MASVS-CODE-1",
			Description: "Signed only with the v1 JAR scheme. On Android < 7.0 such APKs are vulnerable to the Janus exploit (CVE-2017-13156).",
		})
	}
}

// ---------------------------------------------------------------------------
// Scoring
// ---------------------------------------------------------------------------

func (a *App) scoreAudit(audit *APKAudit) {
	weights := map[string]int{"critical": 25, "high": 15, "medium": 8, "low": 3, "info": 0}
	score := 100
	for _, f := range audit.Findings {
		audit.Counts[f.Severity]++
		score -= weights[f.Severity]
	}
	if score < 0 {
		score = 0
	}
	audit.Score = score
	switch {
	case score >= 90:
		audit.Grade = "A"
	case score >= 75:
		audit.Grade = "B"
	case score >= 60:
		audit.Grade = "C"
	case score >= 40:
		audit.Grade = "D"
	default:
		audit.Grade = "F"
	}

	// stable severity-then-title ordering
	order := map[string]int{"critical": 0, "high": 1, "medium": 2, "low": 3, "info": 4}
	sort.SliceStable(audit.Findings, func(i, j int) bool {
		if order[audit.Findings[i].Severity] != order[audit.Findings[j].Severity] {
			return order[audit.Findings[i].Severity] < order[audit.Findings[j].Severity]
		}
		return audit.Findings[i].Title < audit.Findings[j].Title
	})
}

func (audit *APKAudit) addFinding(f Finding) {
	if f.Confidence == 0 {
		f.Confidence = 80
	}
	audit.Findings = append(audit.Findings, f)
}

// ---------------------------------------------------------------------------
// Build-tool / java command runners
// ---------------------------------------------------------------------------

// runBuildTool runs an SDK build-tool that does not need a JVM (aapt2).
func (a *App) runBuildTool(ctx context.Context, name string, args ...string) (string, error) {
	bin, err := a.resolveBuildTool(name)
	if err != nil {
		return "", err
	}
	return runExternal(ctx, bin, nil, args...)
}

// runBuildToolJava runs an SDK build-tool that needs a JVM (apksigner).
func (a *App) runBuildToolJava(ctx context.Context, name string, args ...string) (string, error) {
	bin, err := a.resolveBuildTool(name)
	if err != nil {
		return "", err
	}
	return runExternal(ctx, bin, a.javaEnv(), args...)
}

// javaEnv returns an environment with the JBR's java on PATH + JAVA_HOME set,
// so apksigner/keytool work even when no system JDK is installed.
func (a *App) javaEnv() []string {
	jbr := findJBR()
	if jbr == "" {
		return nil
	}
	env := os.Environ()
	env = append(env, "JAVA_HOME="+jbr)
	env = append(env, "PATH="+filepath.Join(jbr, "bin")+string(os.PathListSeparator)+os.Getenv("PATH"))
	return env
}

// resolveBuildTool finds an SDK build-tool, preferring PATH then the newest
// build-tools directory under known SDK roots.
func (a *App) resolveBuildTool(name string) (string, error) {
	a.cacheMutex.RLock()
	if c, ok := a.binaryCache["bt:"+name]; ok {
		a.cacheMutex.RUnlock()
		return c, nil
	}
	a.cacheMutex.RUnlock()

	var candidates []string
	if p := lookPath(name); p != "" {
		candidates = append(candidates, p)
	}
	for _, bt := range buildToolsDirs() {
		candidates = append(candidates, filepath.Join(bt, name))
	}
	for _, c := range candidates {
		if info, err := os.Stat(c); err == nil && !info.IsDir() {
			abs, _ := filepath.Abs(c)
			a.cacheMutex.Lock()
			a.binaryCache["bt:"+name] = abs
			a.cacheMutex.Unlock()
			return abs, nil
		}
	}
	return "", fmt.Errorf("%s not found — install Android SDK build-tools (e.g. sdkmanager \"build-tools;37.0.0\")", name)
}

// buildToolsDirs returns build-tools version dirs, newest first, across SDK roots.
func buildToolsDirs() []string {
	var roots []string
	for _, env := range []string{"ANDROID_HOME", "ANDROID_SDK_ROOT"} {
		if v := os.Getenv(env); v != "" {
			roots = append(roots, v)
		}
	}
	if home, err := os.UserHomeDir(); err == nil {
		roots = append(roots,
			filepath.Join(home, "Android", "Sdk"),
			filepath.Join(home, "Library", "Android", "sdk"),
		)
	}
	var dirs []string
	for _, r := range roots {
		bt := filepath.Join(r, "build-tools")
		entries, err := os.ReadDir(bt)
		if err != nil {
			continue
		}
		var versions []string
		for _, e := range entries {
			if e.IsDir() {
				versions = append(versions, e.Name())
			}
		}
		sort.Sort(sort.Reverse(sort.StringSlice(versions)))
		for _, v := range versions {
			dirs = append(dirs, filepath.Join(bt, v))
		}
	}
	return dirs
}

// findJBR locates a JBR/JDK home (for apksigner/keytool). Prefers Android
// Studio's bundled JBR, matching the project's build recipe.
func findJBR() string {
	if v := os.Getenv("JAVA_HOME"); v != "" {
		if _, err := os.Stat(filepath.Join(v, "bin", "java")); err == nil {
			return v
		}
	}
	home, _ := os.UserHomeDir()
	globs := []string{
		filepath.Join(home, "Documents", "android-studio*", "android-studio", "jbr"),
		filepath.Join(home, "android-studio", "jbr"),
		"/opt/android-studio/jbr",
		"/usr/lib/jvm/*/",
	}
	for _, g := range globs {
		matches, _ := filepath.Glob(g)
		for _, m := range matches {
			if _, err := os.Stat(filepath.Join(m, "bin", "java")); err == nil {
				return strings.TrimRight(m, "/")
			}
		}
	}
	if p := lookPath("java"); p != "" {
		// java is .../bin/java → JAVA_HOME is two levels up
		return filepath.Dir(filepath.Dir(p))
	}
	return ""
}
