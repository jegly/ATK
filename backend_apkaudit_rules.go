package main

// Rule data and small helpers for the APK auditor. The rule set is authored
// from scratch (CWE / OWASP-MASVS taxonomy is public). Expand freely.

import (
	"archive/zip"
	"bytes"
	"context"
	"crypto/sha256"
	"encoding/hex"
	"io"
	"math"
	"os"
	"os/exec"
	"regexp"
	"strconv"
	"strings"
	"time"
)

// ---------------------------------------------------------------------------
// Rule tables
// ---------------------------------------------------------------------------

type codeRule struct {
	id, title, severity, category, description, cwe, masvs string
	confidence                                             int
	needles                                                []string
}

// codeRules match by substring presence in DEX-extracted strings (method/class
// names and string constants surface here).
var codeRules = []codeRule{
	{
		id: "crypto-weak-hash", title: "Weak hash algorithm (MD5/SHA-1)", severity: "medium",
		category: "crypto", cwe: "CWE-327", masvs: "MASVS-CRYPTO-1", confidence: 55,
		description: "References to MD5 or SHA-1, which are unsuitable for security-sensitive hashing.",
		needles:     []string{"MD5", "SHA-1", "SHA1"},
	},
	{
		id: "crypto-ecb", title: "ECB cipher mode", severity: "high",
		category: "crypto", cwe: "CWE-327", masvs: "MASVS-CRYPTO-1", confidence: 80,
		description: "AES/DES in ECB mode leaks plaintext structure; use an authenticated mode (GCM).",
		needles:     []string{"AES/ECB", "DES/ECB", "/ECB/"},
	},
	{
		id: "crypto-des-rc4", title: "Obsolete cipher (DES/RC4)", severity: "high",
		category: "crypto", cwe: "CWE-327", masvs: "MASVS-CRYPTO-1", confidence: 70,
		description: "DES/3DES/RC4 are broken or deprecated ciphers.",
		needles:     []string{"DES/", "DESede", "RC4", "ARCFOUR"},
	},
	{
		id: "net-cleartext-url", title: "Hardcoded cleartext HTTP URL", severity: "low",
		category: "network", cwe: "CWE-319", masvs: "MASVS-NETWORK-1", confidence: 50,
		description: "Plain http:// endpoints found in code.",
		needles:     []string{"http://"},
	},
	{
		id: "net-trustall", title: "Permissive TLS trust / hostname verifier", severity: "high",
		category: "network", cwe: "CWE-295", masvs: "MASVS-NETWORK-2", confidence: 65,
		description: "Custom TrustManager or hostname verifier bypass can disable certificate validation.",
		needles:     []string{"ALLOW_ALL_HOSTNAME_VERIFIER", "X509TrustManager", "checkServerTrusted", "setHostnameVerifier", "TrustAllCerts", "NullHostnameVerifier"},
	},
	{
		id: "webview-js", title: "WebView JavaScript / bridge", severity: "medium",
		category: "webview", cwe: "CWE-749", masvs: "MASVS-PLATFORM-2", confidence: 55,
		description: "addJavascriptInterface / setJavaScriptEnabled exposes a JS↔native bridge; risky with untrusted content.",
		needles:     []string{"addJavascriptInterface", "setJavaScriptEnabled", "setAllowFileAccess", "setAllowUniversalAccessFromFileURLs"},
	},
	{
		id: "storage-world", title: "World-readable/writable storage mode", severity: "high",
		category: "storage", cwe: "CWE-276", masvs: "MASVS-STORAGE-2", confidence: 70,
		description: "MODE_WORLD_READABLE/WRITABLE exposes private files to other apps.",
		needles:     []string{"MODE_WORLD_READABLE", "MODE_WORLD_WRITEABLE", "MODE_WORLD_WRITABLE"},
	},
	{
		id: "storage-extsd", title: "External storage use", severity: "low",
		category: "storage", cwe: "CWE-922", masvs: "MASVS-STORAGE-2", confidence: 40,
		description: "Reads/writes to shared external storage, which other apps may access.",
		needles:     []string{"getExternalStorageDirectory", "getExternalStoragePublicDirectory"},
	},
	{
		id: "code-runtime-exec", title: "Runtime command execution", severity: "medium",
		category: "code", cwe: "CWE-78", masvs: "MASVS-CODE-4", confidence: 50,
		description: "Runtime.exec / ProcessBuilder can run shell commands; dangerous with untrusted input.",
		needles:     []string{"Runtime;->exec", "Runtime.getRuntime", "ProcessBuilder"},
	},
	{
		id: "code-dynamic-load", title: "Dynamic code loading", severity: "medium",
		category: "code", cwe: "CWE-494", masvs: "MASVS-CODE-2", confidence: 55,
		description: "DexClassLoader / loadClass can load code at runtime, complicating integrity guarantees.",
		needles:     []string{"DexClassLoader", "PathClassLoader", "loadDex", "System.load"},
	},
	{
		id: "code-reflection", title: "Reflection", severity: "info",
		category: "code", cwe: "CWE-470", masvs: "MASVS-CODE-2", confidence: 40,
		description: "Heavy reflection usage; often benign but used to hide behaviour.",
		needles:     []string{"java.lang.reflect", "getDeclaredMethod", "setAccessible"},
	},
	{
		id: "code-root-check", title: "Root / emulator detection strings", severity: "info",
		category: "code", cwe: "", masvs: "MASVS-RESILIENCE-1", confidence: 45,
		description: "References to su/Magisk/test-keys suggest root or emulator detection.",
		needles:     []string{"/system/bin/su", "/system/xbin/su", "Superuser", "magisk", "test-keys", "/sbin/su"},
	},
	{
		id: "sql-raw", title: "Raw SQL query", severity: "low",
		category: "storage", cwe: "CWE-89", masvs: "MASVS-CODE-4", confidence: 35,
		description: "rawQuery/execSQL with concatenated input risks SQL injection.",
		needles:     []string{"rawQuery", "execSQL"},
	},
}

type secretRule struct {
	id, title, severity, description string
	confidence                       int
	entropyMin                       float64
	re                               *regexp.Regexp
}

var secretRules = []secretRule{
	{id: "secret-aws", title: "AWS access key ID", severity: "critical", confidence: 90,
		description: "An AWS access key ID was found embedded in the code.",
		re: regexp.MustCompile(`AKIA[0-9A-Z]{16}`)},
	{id: "secret-google-api", title: "Google API key", severity: "high", confidence: 80,
		description: "A Google API key (AIza...) was found.", entropyMin: 3.0,
		re: regexp.MustCompile(`AIza[0-9A-Za-z_\-]{35}`)},
	{id: "secret-stripe", title: "Stripe secret/live key", severity: "critical", confidence: 90,
		description: "A Stripe live/secret key was found.",
		re: regexp.MustCompile(`(?:sk|rk)_live_[0-9A-Za-z]{20,}`)},
	{id: "secret-github", title: "GitHub token", severity: "critical", confidence: 90,
		description: "A GitHub personal access / app token was found.",
		re: regexp.MustCompile(`gh[posru]_[0-9A-Za-z]{36,}`)},
	{id: "secret-slack", title: "Slack token", severity: "high", confidence: 85,
		description: "A Slack token was found.",
		re: regexp.MustCompile(`xox[baprs]-[0-9A-Za-z\-]{10,}`)},
	{id: "secret-twilio", title: "Twilio account SID", severity: "high", confidence: 80,
		description: "A Twilio account SID was found.",
		re: regexp.MustCompile(`AC[0-9a-fA-F]{32}`)},
	{id: "secret-jwt", title: "JSON Web Token", severity: "medium", confidence: 60,
		description: "A JWT was found; may embed sensitive claims.", entropyMin: 3.5,
		re: regexp.MustCompile(`eyJ[A-Za-z0-9_\-]{8,}\.[A-Za-z0-9_\-]{8,}\.[A-Za-z0-9_\-]{4,}`)},
	{id: "secret-pem", title: "Private key (PEM)", severity: "critical", confidence: 95,
		description: "A PEM private-key header was found embedded in the APK.",
		re: regexp.MustCompile(`-----BEGIN (?:RSA |EC |DSA |OPENSSH |PGP )?PRIVATE KEY-----`)},
	{id: "secret-firebase-db", title: "Firebase database URL", severity: "low", confidence: 60,
		description: "A Firebase Realtime Database URL was found; check its rules are not public.",
		re: regexp.MustCompile(`https://[a-z0-9\-]+\.firebaseio\.com`)},
}

// trackerSignatures maps an SDK name to DEX path fragments that identify it.
var trackerSignatures = map[string][]string{
	"Google Firebase":      {"com/google/firebase"},
	"Google AdMob":         {"com/google/android/gms/ads"},
	"Google Analytics":     {"com/google/android/gms/analytics", "com/google/analytics"},
	"Google Crashlytics":   {"com/google/firebase/crashlytics", "com/crashlytics"},
	"Facebook SDK":         {"com/facebook/"},
	"Branch":               {"io/branch/"},
	"AppsFlyer":            {"com/appsflyer"},
	"Adjust":               {"com/adjust/sdk"},
	"Mixpanel":             {"com/mixpanel"},
	"Amplitude":            {"com/amplitude"},
	"Segment":              {"com/segment/analytics"},
	"Flurry":               {"com/flurry"},
	"OneSignal":            {"com/onesignal"},
	"Bugsnag":              {"com/bugsnag"},
	"Sentry":               {"io/sentry/"},
	"Unity Ads":            {"com/unity3d/ads"},
	"AppLovin":             {"com/applovin"},
	"ironSource":           {"com/ironsource"},
	"Tapjoy":               {"com/tapjoy"},
	"Chartboost":           {"com/chartboost"},
	"Vungle":               {"com/vungle"},
	"InMobi":               {"com/inmobi"},
	"MoPub":                {"com/mopub"},
	"Yandex Metrica":       {"com/yandex/metrica"},
	"Kochava":              {"com/kochava"},
	"Singular":             {"com/singular/sdk"},
	"Braze":                {"com/appboy", "com/braze"},
	"Localytics":           {"com/localytics"},
	"ComScore":             {"com/comscore"},
	"Tencent Bugly":        {"com/tencent/bugly"},
	"Umeng":                {"com/umeng"},
}

var trackerCategory = map[string]string{
	"Google Firebase": "Analytics", "Google AdMob": "Advertising", "Google Analytics": "Analytics",
	"Google Crashlytics": "Crash reporting", "Facebook SDK": "Analytics", "Branch": "Attribution",
	"AppsFlyer": "Attribution", "Adjust": "Attribution", "Mixpanel": "Analytics",
	"Amplitude": "Analytics", "Segment": "Analytics", "Flurry": "Analytics",
	"OneSignal": "Push/Analytics", "Bugsnag": "Crash reporting", "Sentry": "Crash reporting",
	"Unity Ads": "Advertising", "AppLovin": "Advertising", "ironSource": "Advertising",
	"Tapjoy": "Advertising", "Chartboost": "Advertising", "Vungle": "Advertising",
	"InMobi": "Advertising", "MoPub": "Advertising", "Yandex Metrica": "Analytics",
	"Kochava": "Attribution", "Singular": "Attribution", "Braze": "Marketing",
	"Localytics": "Analytics", "ComScore": "Analytics", "Tencent Bugly": "Crash reporting",
	"Umeng": "Analytics",
}

// dangerousPermissions is the runtime-permission set (Android dangerous group).
var dangerousPermissions = map[string]bool{
	"android.permission.READ_CALENDAR": true, "android.permission.WRITE_CALENDAR": true,
	"android.permission.CAMERA":             true,
	"android.permission.READ_CONTACTS":      true, "android.permission.WRITE_CONTACTS": true,
	"android.permission.GET_ACCOUNTS":       true,
	"android.permission.ACCESS_FINE_LOCATION": true, "android.permission.ACCESS_COARSE_LOCATION": true,
	"android.permission.ACCESS_BACKGROUND_LOCATION": true,
	"android.permission.RECORD_AUDIO":               true,
	"android.permission.READ_PHONE_STATE":           true, "android.permission.READ_PHONE_NUMBERS": true,
	"android.permission.CALL_PHONE":   true, "android.permission.ANSWER_PHONE_CALLS": true,
	"android.permission.READ_CALL_LOG": true, "android.permission.WRITE_CALL_LOG": true,
	"android.permission.ADD_VOICEMAIL": true, "android.permission.USE_SIP": true,
	"android.permission.BODY_SENSORS":    true,
	"android.permission.SEND_SMS":        true, "android.permission.RECEIVE_SMS": true,
	"android.permission.READ_SMS":        true, "android.permission.RECEIVE_WAP_PUSH": true,
	"android.permission.RECEIVE_MMS":     true,
	"android.permission.READ_EXTERNAL_STORAGE": true, "android.permission.WRITE_EXTERNAL_STORAGE": true,
	"android.permission.READ_MEDIA_IMAGES": true, "android.permission.READ_MEDIA_VIDEO": true,
	"android.permission.READ_MEDIA_AUDIO": true,
	"android.permission.POST_NOTIFICATIONS": true,
	"android.permission.BLUETOOTH_SCAN":     true, "android.permission.BLUETOOTH_CONNECT": true,
	"android.permission.BLUETOOTH_ADVERTISE": true,
	"android.permission.ACTIVITY_RECOGNITION": true,
}

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

// runExternal executes a binary with optional custom env, returning trimmed stdout.
func runExternal(ctx context.Context, bin string, env []string, args ...string) (string, error) {
	cmd := exec.CommandContext(ctx, bin, args...)
	setCommandSysProcAttr(cmd)
	if env != nil {
		cmd.Env = env
	}
	var stdout, stderr bytes.Buffer
	cmd.Stdout = &stdout
	cmd.Stderr = &stderr
	err := cmd.Run()
	out := strings.TrimSpace(stdout.String())
	if err != nil {
		if out != "" {
			return out, nil // some tools exit non-zero but print useful output (e.g. apksigner DOES NOT VERIFY)
		}
		msg := strings.TrimSpace(stderr.String())
		if msg == "" {
			msg = err.Error()
		}
		return "", &runError{msg}
	}
	return out, nil
}

type runError struct{ msg string }

func (e *runError) Error() string { return e.msg }

func lookPath(name string) string {
	if p, err := exec.LookPath(name); err == nil {
		return p
	}
	return ""
}

func fileSHA256(path string) (string, error) {
	f, err := os.Open(path)
	if err != nil {
		return "", err
	}
	defer f.Close()
	h := sha256.New()
	if _, err := io.Copy(h, f); err != nil {
		return "", err
	}
	return hex.EncodeToString(h.Sum(nil)), nil
}

func readZipEntry(f *zip.File) []byte {
	rc, err := f.Open()
	if err != nil {
		return nil
	}
	defer rc.Close()
	data, err := io.ReadAll(rc)
	if err != nil {
		return nil
	}
	return data
}

// shannonEntropy returns the per-character Shannon entropy (bits) of s.
func shannonEntropy(s string) float64 {
	if s == "" {
		return 0
	}
	var freq [256]float64
	for i := 0; i < len(s); i++ {
		freq[s[i]]++
	}
	n := float64(len(s))
	var h float64
	for _, c := range freq {
		if c == 0 {
			continue
		}
		p := c / n
		h -= p * math.Log2(p)
	}
	return h
}

func redactSecret(s string) string {
	if len(s) <= 10 {
		return s
	}
	return s[:6] + "…" + s[len(s)-4:]
}

func truncate(s string, n int) string {
	if len(s) <= n {
		return s
	}
	return s[:n] + "…"
}

func firstLine(s string) string {
	if i := strings.IndexByte(s, '\n'); i >= 0 {
		return s[:i]
	}
	return s
}

func isTrue(v string) bool {
	v = strings.TrimSpace(strings.ToLower(v))
	return v == "true" || v == "0xffffffff" || v == "-1" || v == "1"
}

func atoiSafe(s string) int {
	n, _ := strconv.Atoi(strings.TrimSpace(s))
	return n
}

func sanitizeFileToken(s string) string {
	return strings.Map(func(r rune) rune {
		if (r >= 'a' && r <= 'z') || (r >= 'A' && r <= 'Z') || (r >= '0' && r <= '9') || r == '.' || r == '_' || r == '-' {
			return r
		}
		return '_'
	}, s)
}

func shortName(fqcn string) string {
	if i := strings.LastIndex(fqcn, "."); i >= 0 && i < len(fqcn)-1 {
		// keep a leading dot (relative names) readable
		if strings.HasPrefix(fqcn, ".") {
			return fqcn
		}
		return fqcn[i+1:]
	}
	return fqcn
}

// countIndent returns leading-space count of a line.
func countIndent(s string) int {
	n := 0
	for _, c := range s {
		if c == ' ' {
			n++
		} else {
			break
		}
	}
	return n
}

// elementName extracts the tag name from an "E: name (line=..)" xmltree line.
func elementName(line string) string {
	line = strings.TrimSpace(strings.TrimPrefix(strings.TrimSpace(line), "E:"))
	if i := strings.Index(line, " "); i >= 0 {
		line = line[:i]
	}
	return strings.TrimSpace(line)
}

// manifestAttr parses an "A: ns:attr(0xhex)=value (Raw: ..)" xmltree line into
// a bare attribute name and a cleaned value.
func manifestAttr(line string) (string, string) {
	line = strings.TrimSpace(strings.TrimPrefix(strings.TrimSpace(line), "A:"))
	eq := strings.Index(line, "=")
	if eq < 0 {
		return "", ""
	}
	name := strings.TrimSpace(line[:eq])
	val := strings.TrimSpace(line[eq+1:])

	// strip "(0x...)" hex id from name and any namespace prefix
	if p := strings.Index(name, "("); p >= 0 {
		name = name[:p]
	}
	if c := strings.LastIndex(name, ":"); c >= 0 {
		name = name[c+1:]
	}

	// prefer the Raw: "..." form when present
	if r := strings.Index(val, "(Raw: \""); r >= 0 {
		rest := val[r+len("(Raw: \""):]
		if e := strings.Index(rest, "\""); e >= 0 {
			return name, rest[:e]
		}
	}
	val = strings.Trim(val, "\"")
	return name, val
}

func parseCertTime(s string) (time.Time, bool) {
	layouts := []string{
		"Mon Jan 02 15:04:05 MST 2006",
		"Mon Jan 2 15:04:05 MST 2006",
		"Jan 2, 2006",
		"2006-01-02",
	}
	for _, l := range layouts {
		if t, err := time.Parse(l, strings.TrimSpace(s)); err == nil {
			return t, true
		}
	}
	return time.Time{}, false
}
