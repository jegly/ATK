package main

import (
	"regexp"
	"strings"
)

// Relationship extraction for the Logcat visual map — ported to Go so the mining
// heuristics live in native (compiled) code rather than shipped JavaScript.
//
// A log line is just text, but Android's framework + system-event logs encode
// real relationships: who started whom, who crashed, who got killed, who sent a
// signal to which pid. We mine those so the map can draw meaningful edges on top
// of the ambient co-occurrence web. Runs in the existing per-line log pipeline
// (parseLogcatLine), so the result ships attached to each LogcatLine — no extra IPC.

// LogRef is one relationship a log line implies. JSON shape matches the frontend.
type LogRef struct {
	Kind       string `json:"kind"`       // activity|spawn|death|crash|anr|signal|gfx|mention
	Target     string `json:"target"`     // package, component, or pid payload
	TargetKind string `json:"targetKind"` // package|component|pid
}

var (
	lcpPkg       = regexp.MustCompile(`\b([a-z][a-z0-9_]*(?:\.[a-z0-9_]+){2,})\b`)
	lcpPkgAnchor = regexp.MustCompile(`^[a-z][a-z0-9_]*(?:\.[a-z0-9_]+){2,}$`)
	lcpComponent = regexp.MustCompile(`(?i)([a-z][a-z0-9_.]+)/([a-z0-9_.$]+)`)
	lcpEventCSV  = regexp.MustCompile(`\[([^\]]*)\]`)
	lcpSig       = regexp.MustCompile(`Sending signal\.\s*PID:\s*(\d+)`)
	lcpProcess   = regexp.MustCompile(`(?i)Process:\s*([a-z][a-z0-9_.]+)`)
	lcpANRin     = regexp.MustCompile(`\bANR in\b`)
	lcpStartProc = regexp.MustCompile(`\bStart proc\b`)
	lcpKilling   = regexp.MustCompile(`\bKilling\b|\bhas died\b|\bdied\b`)
	lcpStartAct  = regexp.MustCompile(`\bSTART u\d+|\bDisplayed\b|\bmoveTaskTo`)
	lcpFatal     = regexp.MustCompile(`FATAL EXCEPTION`)
	lcpGfxTag    = regexp.MustCompile(`^(SurfaceFlinger|WindowManager|ViewRootImpl|Choreographer|gralloc|OpenGLRenderer)`)
	lcpMentSkip  = regexp.MustCompile(`^(java|javax|sun|kotlin|android|androidx|dalvik)\.`)
)

func lcpFirstPackage(s string) string {
	if m := lcpPkg.FindStringSubmatch(s); m != nil {
		return m[1]
	}
	return ""
}

// Pull the package field out of an event-log CSV payload (first dotted token).
func lcpEventPackage(msg string) string {
	csv := lcpEventCSV.FindStringSubmatch(msg)
	if csv == nil {
		return lcpFirstPackage(msg)
	}
	for _, f := range strings.Split(csv[1], ",") {
		t := strings.TrimSpace(f)
		if lcpPkgAnchor.MatchString(t) {
			return t
		}
	}
	return lcpFirstPackage(msg)
}

// lcpExtractRefs mines the relationships a single log line implies. Returns an
// empty slice for the vast majority of lines.
func lcpExtractRefs(tag, msg string) []LogRef {
	refs := []LogRef{}
	push := func(kind, target, targetKind string) {
		if target != "" {
			refs = append(refs, LogRef{Kind: kind, Target: target, TargetKind: targetKind})
		}
	}

	// binary event-log tags (events buffer)
	switch tag {
	case "am_proc_start", "am_proc_bound":
		push("spawn", lcpEventPackage(msg), "package")
		return refs
	case "am_proc_died", "am_kill", "am_low_memory":
		push("death", lcpEventPackage(msg), "package")
		return refs
	case "am_crash":
		push("crash", lcpEventPackage(msg), "package")
		return refs
	case "am_anr":
		push("anr", lcpEventPackage(msg), "package")
		return refs
	case "am_activity_launch_time", "am_focused_activity", "am_resume_activity", "am_pause_activity", "wm_focused_window":
		if c := lcpComponent.FindStringSubmatch(msg); c != nil {
			push("activity", c[1]+"/"+c[2], "component")
		} else {
			push("activity", lcpEventPackage(msg), "package")
		}
		return refs
	}

	// framework text logs (main/system buffers)
	if tag == "ActivityManager" || tag == "ActivityTaskManager" {
		if lcpANRin.MatchString(msg) {
			push("anr", lcpFirstPackage(msg), "package")
		}
		if lcpStartProc.MatchString(msg) {
			push("spawn", lcpFirstPackage(msg), "package")
		}
		if lcpKilling.MatchString(msg) {
			push("death", lcpFirstPackage(msg), "package")
		}
		if sig := lcpSig.FindStringSubmatch(msg); sig != nil {
			push("signal", sig[1], "pid")
		}
		if lcpStartAct.MatchString(msg) {
			if c := lcpComponent.FindStringSubmatch(msg); c != nil {
				push("activity", c[1]+"/"+c[2], "component")
			} else {
				push("activity", lcpFirstPackage(msg), "package")
			}
		}
		if len(refs) > 0 {
			return refs
		}
	}

	if tag == "AndroidRuntime" || lcpFatal.MatchString(msg) {
		if p := lcpProcess.FindStringSubmatch(msg); p != nil {
			push("crash", p[1], "package")
		} else {
			push("crash", lcpFirstPackage(msg), "package")
		}
		if len(refs) > 0 {
			return refs
		}
	}

	if tag == "lowmemorykiller" || tag == "lmkd" {
		push("death", lcpFirstPackage(msg), "package")
		if len(refs) > 0 {
			return refs
		}
	}

	if lcpGfxTag.MatchString(tag) {
		if c := lcpComponent.FindStringSubmatch(msg); c != nil {
			push("gfx", c[1]+"/"+c[2], "component")
			return refs
		}
	}

	return refs
}

// lcpExtractMentions: generic fallback — up to `max` package-looking tokens
// (used when the map's "parsed mentions" toggle is on).
func lcpExtractMentions(msg string, max int) []LogRef {
	out := []LogRef{}
	seen := map[string]bool{}
	for _, m := range lcpPkg.FindAllStringSubmatch(msg, -1) {
		if len(out) >= max {
			break
		}
		t := m[1]
		if seen[t] {
			continue
		}
		seen[t] = true
		if lcpMentSkip.MatchString(t) {
			continue
		}
		out = append(out, LogRef{Kind: "mention", Target: t, TargetKind: "package"})
	}
	return out
}
