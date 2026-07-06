package main

// Privacy & Tracker Scanner.
//
// Pulls an installed app's base APK, scans its DEX bytecode for known
// third-party tracker/analytics/ad SDK signatures, cross-references declared
// dangerous permissions, and derives a 0-100 Privacy Score (A-F grade). This
// reuses the APK auditor's DEX tracker matcher (matchTrackers /
// trackerSignatures) and the shared dangerousPermissions set, and additionally
// enriches the shared tracker DB below (which also improves the full auditor).
//
// Data source: a bundled static signature list (Exodus-Privacy-style code
// signatures = Java package prefixes as they appear in classes*.dex). No runtime
// network — works fully offline on any device.

import (
	"archive/zip"
	"fmt"
	"os"
	"path/filepath"
	"sort"
	"strings"
)

// extraTrackerSignatures widens the built-in trackerSignatures set with more
// well-known Exodus-catalogued SDKs. Merged into the shared maps at init so both
// the Privacy Scanner and the APK auditor see them. Signatures are conservative
// package prefixes chosen to avoid false positives.
var extraTrackerSignatures = map[string][]string{
	"Google Tag Manager": {"com/google/android/gms/tagmanager"},
	"Amazon Mobile Ads":  {"com/amazon/device/ads", "com/amazon/aps"},
	"AdColony":           {"com/adcolony"},
	"Startapp":           {"com/startapp"},
	"Mintegral":          {"com/mbridge", "com/mintegral"},
	"Pangle (ByteDance)": {"com/bytedance/sdk/openadsdk", "com/bytedance/pangle"},
	"ByteDance AppLog":   {"com/bytedance/applog"},
	"PubMatic":           {"com/pubmatic"},
	"Criteo":             {"com/criteo"},
	"Smaato":             {"com/smaato"},
	"Fyber":              {"com/fyber"},
	"Taboola":            {"com/taboola"},
	"Outbrain":           {"com/outbrain"},
	"CleverTap":          {"com/clevertap"},
	"MoEngage":           {"com/moengage"},
	"Airship":            {"com/urbanairship"},
	"Leanplum":           {"com/leanplum"},
	"Batch":              {"com/batch/android"},
	"Iterable":           {"com/iterable"},
	"Pushwoosh":          {"com/pushwoosh"},
	"Swrve":              {"com/swrve"},
	"Optimizely":         {"com/optimizely"},
	"Adobe Experience":   {"com/adobe/marketing/mobile", "com/adobe/mobile"},
	"New Relic":          {"com/newrelic"},
	"Datadog":            {"com/datadog/android"},
	"Instabug":           {"com/instabug"},
	"Embrace":            {"io/embrace/android"},
	"Countly":            {"ly/count/android"},
	"Matomo":             {"org/matomo", "org/piwik"},
	"Snowplow":           {"com/snowplowanalytics"},
	"Smartlook":          {"com/smartlook"},
	"Nielsen":            {"com/nielsen/app"},
	"Mapbox Telemetry":   {"com/mapbox/android/telemetry"},
	"Foursquare":         {"com/foursquare"},
	"Gimbal":             {"com/gimbal"},
	"Radar":              {"io/radar/sdk"},
}

var extraTrackerCategory = map[string]string{
	"Google Tag Manager": "Analytics", "Amazon Mobile Ads": "Advertising", "AdColony": "Advertising",
	"Startapp": "Advertising", "Mintegral": "Advertising", "Pangle (ByteDance)": "Advertising",
	"ByteDance AppLog": "Analytics", "PubMatic": "Advertising", "Criteo": "Advertising",
	"Smaato": "Advertising", "Fyber": "Advertising", "Taboola": "Advertising", "Outbrain": "Advertising",
	"CleverTap": "Analytics", "MoEngage": "Marketing", "Airship": "Marketing", "Leanplum": "Marketing",
	"Batch": "Marketing", "Iterable": "Marketing", "Pushwoosh": "Push/Analytics", "Swrve": "Marketing",
	"Optimizely": "Analytics", "Adobe Experience": "Analytics", "New Relic": "Analytics",
	"Datadog": "Analytics", "Instabug": "Crash reporting", "Embrace": "Crash reporting",
	"Countly": "Analytics", "Matomo": "Analytics", "Snowplow": "Analytics", "Smartlook": "Analytics",
	"Nielsen": "Analytics", "Mapbox Telemetry": "Location", "Foursquare": "Location",
	"Gimbal": "Location", "Radar": "Location",
}

func init() {
	for name, sigs := range extraTrackerSignatures {
		if _, exists := trackerSignatures[name]; !exists {
			trackerSignatures[name] = sigs
		}
	}
	for name, cat := range extraTrackerCategory {
		if _, exists := trackerCategory[name]; !exists {
			trackerCategory[name] = cat
		}
	}
}

// privacyCategoryWeight is the score penalty per unique tracker of a category.
// Advertising / attribution / location are weighted heaviest (most invasive);
// crash reporting is light (usually operational, not surveillance).
var privacyCategoryWeight = map[string]int{
	"Advertising":     12,
	"Location":        12,
	"Attribution":     8,
	"Marketing":       8,
	"Analytics":       7,
	"Push/Analytics":  6,
	"Crash reporting": 3,
}

const defaultTrackerWeight = 6

type PrivacyTracker struct {
	Name     string `json:"name"`
	Category string `json:"category"`
	Matches  int    `json:"matches"`
}

type PrivacyReport struct {
	PackageName          string           `json:"packageName"`
	Score                int              `json:"score"` // 0-100, higher = more private
	Grade                string           `json:"grade"` // A-F
	TrackerCount         int              `json:"trackerCount"`
	Trackers             []PrivacyTracker `json:"trackers"`
	DangerousPermissions []string         `json:"dangerousPermissions"`
	ApkSize              int64            `json:"apkSize"`
}

// ScanAppPrivacy pulls the base APK of an installed package, scans it for
// tracker SDKs, collects its declared dangerous permissions, and scores it.
func (a *App) ScanAppPrivacy(packageName string) (PrivacyReport, error) {
	if err := validatePackageName(packageName); err != nil {
		return PrivacyReport{}, err
	}
	report := PrivacyReport{PackageName: packageName}

	// Locate the base APK on the device.
	out, err := a.runAdbShell("pm", "path", packageName)
	if err != nil {
		return report, fmt.Errorf("could not locate package on device: %w", err)
	}
	var remote string
	for _, line := range strings.Split(out, "\n") {
		p := strings.TrimPrefix(strings.TrimSpace(line), "package:")
		if strings.HasSuffix(p, "base.apk") {
			remote = p
			break
		}
		if remote == "" && strings.HasSuffix(p, ".apk") {
			remote = p
		}
	}
	if remote == "" {
		return report, fmt.Errorf("no APK path found for %s", packageName)
	}

	// Pull to a temp file; unlike the auditor we don't need to keep it around.
	tmp := filepath.Join(os.TempDir(), "atk-privacy-"+sanitizeFileToken(packageName)+".apk")
	if _, err := a.runCommandTimeout(auditCommandTimeout, "adb", "pull", remote, tmp); err != nil {
		return report, fmt.Errorf("failed to pull APK: %w", err)
	}
	defer os.Remove(tmp)
	if info, statErr := os.Stat(tmp); statErr == nil {
		report.ApkSize = info.Size()
	}

	// Scan DEX bytecode for tracker signatures.
	trackerHits := map[string]int{}
	if zr, zerr := zip.OpenReader(tmp); zerr == nil {
		for _, f := range zr.File {
			if !strings.HasPrefix(f.Name, "classes") || !strings.HasSuffix(f.Name, ".dex") {
				continue
			}
			if f.UncompressedSize64 > maxDexBytes {
				continue
			}
			if data := readZipEntry(f); data != nil {
				matchTrackers(data, trackerHits)
			}
		}
		zr.Close()
	} else {
		return report, fmt.Errorf("could not open pulled APK: %w", zerr)
	}
	for name, n := range trackerHits {
		report.Trackers = append(report.Trackers, PrivacyTracker{
			Name: name, Category: trackerCategory[name], Matches: n,
		})
	}
	// Heaviest categories first, then alphabetical.
	sort.Slice(report.Trackers, func(i, j int) bool {
		wi, wj := privacyCategoryWeight[report.Trackers[i].Category], privacyCategoryWeight[report.Trackers[j].Category]
		if wi != wj {
			return wi > wj
		}
		return report.Trackers[i].Name < report.Trackers[j].Name
	})
	report.TrackerCount = len(report.Trackers)

	// Declared dangerous permissions (a permission named anywhere in the package
	// dump is declared/involved for this package).
	report.DangerousPermissions = a.declaredDangerousPermissions(packageName)

	report.Score, report.Grade = computePrivacyScore(report.Trackers, report.DangerousPermissions)
	return report, nil
}

// declaredDangerousPermissions returns the dangerous permissions the package
// declares, read from its dumpsys output.
func (a *App) declaredDangerousPermissions(packageName string) []string {
	dump, err := a.runAdbShellTimeout(30*1e9, "dumpsys", "package", packageName)
	if err != nil || dump == "" {
		return nil
	}
	var found []string
	for perm := range dangerousPermissions {
		if strings.Contains(dump, perm) {
			found = append(found, perm)
		}
	}
	sort.Strings(found)
	return found
}

// computePrivacyScore derives a 0-100 score (higher = more private) and an A-F
// grade from the detected trackers and declared dangerous permissions. Trackers
// dominate; permissions are a secondary, capped penalty.
func computePrivacyScore(trackers []PrivacyTracker, dangerousPerms []string) (int, string) {
	score := 100
	for _, t := range trackers {
		w, ok := privacyCategoryWeight[t.Category]
		if !ok {
			w = defaultTrackerWeight
		}
		score -= w
	}
	// Permissions: -2 each, capped at -24 so a permission-heavy but tracker-free
	// app (e.g. a camera app) isn't punished as hard as a tracker-laden one.
	permPenalty := len(dangerousPerms) * 2
	if permPenalty > 24 {
		permPenalty = 24
	}
	score -= permPenalty

	if score < 0 {
		score = 0
	}
	if score > 100 {
		score = 100
	}

	var grade string
	switch {
	case score >= 85:
		grade = "A"
	case score >= 70:
		grade = "B"
	case score >= 55:
		grade = "C"
	case score >= 40:
		grade = "D"
	default:
		grade = "F"
	}
	return score, grade
}
