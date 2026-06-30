package main

import (
	"strings"
	"sync"
)

// SecurityOverview is a quick at-a-glance device security/diagnostic summary
// for the Dashboard. All fields are best-effort (N/A when unavailable).
type SecurityOverview struct {
	Root             string `json:"root"`
	SELinux          string `json:"selinux"`
	VerifiedBoot     string `json:"verifiedBoot"`
	BootloaderLocked string `json:"bootloaderLocked"`
	Encryption       string `json:"encryption"`
	SecurityPatch    string `json:"securityPatch"`
	DmVerity         string `json:"dmVerity"`
	Debuggable       string `json:"debuggable"`
	Secure           string `json:"secure"`
	BuildType        string `json:"buildType"`
	BuildTags        string `json:"buildTags"`
	AdbEnabled       string `json:"adbEnabled"`
	DevOptions       string `json:"devOptions"`
}

// GetSecurityOverview gathers security-relevant device state concurrently.
func (a *App) GetSecurityOverview() (SecurityOverview, error) {
	var o SecurityOverview
	var wg sync.WaitGroup
	var mu sync.Mutex
	run := func(f func()) { wg.Add(1); go func() { defer wg.Done(); f() }() }
	put := func(set func()) { mu.Lock(); set(); mu.Unlock() }

	run(func() {
		su, _ := a.runAdbShell("which", "su")
		put(func() {
			if strings.TrimSpace(su) != "" {
				o.Root = "su present"
			} else {
				o.Root = "not detected"
			}
		})
	})
	run(func() {
		e, _ := a.runAdbShell("getenforce")
		if e = strings.TrimSpace(e); e != "" {
			put(func() { o.SELinux = e })
		}
	})
	run(func() {
		v := a.getProp("ro.boot.verifiedbootstate")
		put(func() { o.VerifiedBoot = v })
	})
	run(func() {
		locked := a.getProp("ro.boot.flash.locked")
		put(func() {
			switch locked {
			case "1":
				o.BootloaderLocked = "Locked"
			case "0":
				o.BootloaderLocked = "Unlocked"
			default:
				o.BootloaderLocked = "unknown"
			}
		})
	})
	run(func() {
		st, ty := a.getProp("ro.crypto.state"), a.getProp("ro.crypto.type")
		put(func() {
			if ty != "" && ty != "N/A" {
				o.Encryption = st + " (" + ty + ")"
			} else {
				o.Encryption = st
			}
		})
	})
	run(func() { v := a.getProp("ro.build.version.security_patch"); put(func() { o.SecurityPatch = v }) })
	run(func() { v := a.getProp("ro.boot.veritymode"); put(func() { o.DmVerity = v }) })
	run(func() { v := a.getProp("ro.debuggable"); put(func() { o.Debuggable = v }) })
	run(func() { v := a.getProp("ro.secure"); put(func() { o.Secure = v }) })
	run(func() { v := a.getProp("ro.build.type"); put(func() { o.BuildType = v }) })
	run(func() { v := a.getProp("ro.build.tags"); put(func() { o.BuildTags = v }) })
	run(func() {
		v, _ := a.runAdbShell("settings", "get", "global", "adb_enabled")
		if v = strings.TrimSpace(v); v != "" {
			put(func() { o.AdbEnabled = v })
		}
	})
	run(func() {
		v, _ := a.runAdbShell("settings", "get", "global", "development_settings_enabled")
		if v = strings.TrimSpace(v); v != "" {
			put(func() { o.DevOptions = v })
		}
	})

	wg.Wait()
	return o, nil
}
