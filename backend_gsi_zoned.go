package main

// Zoned-storage DSU installs. On devices whose /data is f2fs on zoned UFS
// (Pixel 11 and later) gsid can only place the pinned DSU images in completely
// empty zones; free space spread across part-filled zones doesn't count. A big
// userdata request then fails with "Fallocate retry failed, got X, asked for
// Y" once gsid's 30 s wait for f2fs GC runs out, even with hundreds of GB free.
//
// Without root that limit can't be lifted, so this mode works with it: it
// follows the install in logcat, runs idle maintenance (vold's f2fs GC, which
// empties zones) and retries when an allocation falls short, and can finally
// fall back to the largest userdata size the device showed it could fit.

import (
	"bufio"
	"context"
	"fmt"
	"os/exec"
	"regexp"
	"strconv"
	"strings"
	"time"

	"github.com/wailsapp/wails/v2/pkg/runtime"
)

// DsuInstallOpts controls how a DSU install is run.
type DsuInstallOpts struct {
	Zoned    bool `json:"zoned"`    // follow the install and retry short allocations
	Attempts int  `json:"attempts"` // tries at the requested size (default 3)
	Gc       bool `json:"gc"`       // run idle maintenance (f2fs GC) before each retry
	AutoFit  bool `json:"autoFit"`  // then fall back to the largest size that fit
}

const (
	dsuGcWait        = 90 * time.Second // time given to idle maintenance between tries
	dsuAttemptLimit  = 45 * time.Minute // one install, including writing the system image
	dsuFitMargin     = int64(1) << 30   // headroom left when falling back
	dsuFallbackTries = 3
	gib              = int64(1) << 30
)

var (
	dsuRetryRe    = regexp.MustCompile(`Retrying fallocate, got (\d+), asked for (\d+)`)
	dsuAllocFail  = regexp.MustCompile(`Fallocate retry failed, got (\d+), asked for (\d+)`)
	dsuStatusRe   = regexp.MustCompile(`status: (\w+), cause: (\w+)`)
	dsuProgressRe = regexp.MustCompile(`partition name: (\w+), progress: (\d+)/(\d+)`)
	dsuResultRe   = regexp.MustCompile(`onPostExecute\(\).*result: (\d+)`) // InstallationAsyncTask: 1 = OK
)

// dsuZonedStorage reports whether /data sits on zoned storage. f2fs only
// mounts zoned devices in LFS mode, which also needs no sysfs access to see.
func (a *App) dsuZonedStorage() bool {
	if out, err := a.runAdbShell("mount"); err == nil {
		for _, line := range strings.Split(out, "\n") {
			if strings.Contains(line, " on /data type f2fs ") {
				return strings.Contains(line, "mode=lfs")
			}
		}
	}
	out, _ := a.runAdbShell("cat", "/sys/block/*/queue/zoned", "2>/dev/null", ";", "true")
	return strings.Contains(out, "host-")
}

func (a *App) dsuLog(format string, args ...interface{}) {
	runtime.EventsEmit(a.ctx, "dsu:log", fmt.Sprintf(format, args...))
}

// dsuOutcome is how one install attempt ended.
type dsuOutcome struct {
	ok        bool
	short     bool   // an allocation fell short of the size asked for
	partition string // partition being created when it fell short
	got       int64  // bytes gsid managed to allocate for it
	detail    string
}

// installDsuZoned runs the install, retrying and (optionally) shrinking
// userdata until it fits.
func (a *App) installDsuZoned(remote string, sysSize, userdataSize int64, opts DsuInstallOpts) (string, error) {
	attempts := opts.Attempts
	if attempts <= 0 {
		attempts = 3
	}
	ctx, cancel := a.beginCancellableOp(0)
	defer cancel()

	done := func(size int64) string {
		return fmt.Sprintf("DSU installed (system %s, userdata %s). On the device, tap Restart in the notification to boot the GSI. Use 'gsi_tool enable' for sticky mode.",
			humanBytes(sysSize), humanBytes(size))
	}

	var fit int64 // largest userdata the device has shown room for
	for i := 1; i <= attempts; i++ {
		a.dsuLog("Attempt %d/%d: userdata %s", i, attempts, humanBytes(userdataSize))
		out, err := a.dsuAttempt(ctx, remote, sysSize, userdataSize)
		if err != nil {
			return "", err
		}
		if out.ok {
			return done(userdataSize), nil
		}
		if !out.short {
			return "", fmt.Errorf("DSU install failed: %s", out.detail)
		}
		if f := dsuFit(out, sysSize, userdataSize); f > fit {
			fit = f
		}
		a.dsuLog("Not enough empty zones: %s allocation got %s — room for about %s of userdata",
			out.partition, humanBytes(out.got), humanBytes(fit))
		if i < attempts && opts.Gc {
			if err := a.dsuRunGc(ctx); err != nil {
				return "", err
			}
		}
	}

	if fit < gib {
		return "", fmt.Errorf("not enough empty zones for the DSU images — run idle maintenance, leave the device charging with the screen off for a while, and retry")
	}
	if !opts.AutoFit {
		return "", fmt.Errorf("userdata %s doesn't fit in the empty zones right now; about %s does — retry with that, or enable auto-fit",
			humanBytes(userdataSize), humanBytes(fit))
	}

	size, tried := fit, fit
	for i := 0; i < dsuFallbackTries && size >= gib; i++ {
		a.dsuLog("Falling back to userdata %s", humanBytes(size))
		tried = size
		out, err := a.dsuAttempt(ctx, remote, sysSize, size)
		if err != nil {
			return "", err
		}
		if out.ok {
			return done(size) + fmt.Sprintf("\nAuto-fit: asked for %s, installed with %s.", humanBytes(userdataSize), humanBytes(size)), nil
		}
		if !out.short {
			return "", fmt.Errorf("DSU install failed: %s", out.detail)
		}
		next := dsuFit(out, sysSize, size)
		if next >= size {
			next = size - gib
		}
		size = next
	}
	return "", fmt.Errorf("DSU install kept falling short of empty zones; the last size tried was %s", humanBytes(tried))
}

// dsuFit estimates the largest userdata that fits, from a short allocation.
// userdata is created first; if it was the system image that fell short, the
// userdata it already held counts towards the room available.
func dsuFit(out dsuOutcome, sysSize, userdataSize int64) int64 {
	room := out.got
	if out.partition != "userdata" {
		room += userdataSize
	}
	fit := room - sysSize - dsuFitMargin
	return fit / gib * gib
}

// dsuRunGc asks vold for idle maintenance — on f2fs that includes GC, which is
// what turns part-filled zones back into empty ones — and gives it time.
func (a *App) dsuRunGc(ctx context.Context) error {
	if _, err := a.runAdbShellTimeout(30*time.Second, "sm", "idle-maint", "run"); err != nil {
		a.dsuLog("Idle maintenance unavailable (%v); waiting before retrying", err)
	} else {
		a.dsuLog("Running idle maintenance (f2fs GC) to empty more zones; waiting %s", dsuGcWait)
	}
	select {
	case <-ctx.Done():
		return fmt.Errorf("cancelled")
	case <-time.After(dsuGcWait):
		return nil
	}
}

// dsuAttempt fires the install and follows it in logcat until it completes or
// fails.
func (a *App) dsuAttempt(ctx context.Context, remote string, sysSize, userdataSize int64) (dsuOutcome, error) {
	adbPath, err := a.getBinaryPath("adb")
	if err != nil {
		return dsuOutcome{}, err
	}
	actx, cancel := context.WithTimeout(ctx, dsuAttemptLimit)
	defer cancel()

	// Only read log lines from now on, so an earlier attempt's failure isn't
	// mistaken for this one's.
	args := []string{"logcat", "-v", "tag"}
	if now, err := a.runAdbShell("date", shellQuote("+%m-%d %H:%M:%S.000")); err == nil && strings.TrimSpace(now) != "" {
		args = append(args, "-T", strings.TrimSpace(now))
	} else {
		args = append(args, "-T", "1")
	}
	args = append(args, "-s", "gsid", "DynamicSystemService", "DynamicSystemInstallationService", "InstallationAsyncTask")

	cmd := exec.CommandContext(actx, adbPath, args...)
	setCommandSysProcAttr(cmd)
	stdout, err := cmd.StdoutPipe()
	if err != nil {
		return dsuOutcome{}, fmt.Errorf("logcat pipe: %w", err)
	}
	if err := cmd.Start(); err != nil {
		return dsuOutcome{}, fmt.Errorf("failed to start logcat: %w", err)
	}

	lines := make(chan string, 256)
	go func() {
		defer close(lines)
		sc := bufio.NewScanner(stdout)
		sc.Buffer(make([]byte, 64*1024), 1024*1024)
		for sc.Scan() {
			lines <- sc.Text()
		}
	}()
	// Stop logcat, let the reader drain to EOF, then reap the process.
	defer func() {
		cancel()
		for range lines {
		}
		cmd.Wait()
	}()

	if err := a.fireDsuIntent(remote, sysSize, userdataSize); err != nil {
		return dsuOutcome{}, err
	}

	out := dsuOutcome{partition: "userdata"}
	lastPct := -1
	for {
		select {
		case <-ctx.Done():
			return dsuOutcome{}, fmt.Errorf("cancelled — the install may still be running on the device; Discard it from the notification")
		case <-actx.Done():
			if ctx.Err() != nil {
				continue // reported by the ctx.Done case
			}
			return dsuOutcome{}, fmt.Errorf("no result from the DSU installer after %s", dsuAttemptLimit)
		case line, ok := <-lines:
			if !ok {
				if ctx.Err() != nil || actx.Err() != nil {
					continue // reported by the Done cases
				}
				return dsuOutcome{}, fmt.Errorf("lost logcat while following the install — check the device notification")
			}
			msg := line
			if i := strings.Index(line, ": "); i >= 0 {
				msg = line[i+2:]
			}

			if m := dsuProgressRe.FindStringSubmatch(msg); m != nil {
				out.partition = m[1]
				done, _ := strconv.ParseInt(m[2], 10, 64)
				total, _ := strconv.ParseInt(m[3], 10, 64)
				pct := 0
				if total > 0 {
					pct = int(done * 100 / total)
				}
				if pct != lastPct {
					lastPct = pct
					runtime.EventsEmit(a.ctx, "dsu:progress", map[string]interface{}{"label": m[1], "percent": pct})
				}
			}
			if m := dsuRetryRe.FindStringSubmatch(msg); m != nil {
				got, _ := strconv.ParseInt(m[1], 10, 64)
				a.dsuLog("Waiting for empty zones: %s of %s", humanBytes(got), dsuHumanStr(m[2]))
				continue
			}
			if m := dsuAllocFail.FindStringSubmatch(msg); m != nil {
				out.short = true
				out.got, _ = strconv.ParseInt(m[1], 10, 64)
				a.dsuLog("%s", msg)
				continue
			}
			if m := dsuResultRe.FindStringSubmatch(msg); m != nil {
				if m[1] == "1" {
					runtime.EventsEmit(a.ctx, "dsu:progress", map[string]interface{}{"label": "done", "percent": 100})
					out.ok = true
					return out, nil
				}
				if m[1] != "0" {
					out.detail = msg
					a.dsuLog("%s", msg)
					return out, nil
				}
				continue
			}
			if m := dsuStatusRe.FindStringSubmatch(msg); m != nil {
				status, cause := m[1], m[2]
				switch {
				case status == "READY" || cause == "INSTALL_COMPLETED":
					runtime.EventsEmit(a.ctx, "dsu:progress", map[string]interface{}{"label": "done", "percent": 100})
					out.ok = true
					return out, nil
				case status == "NOT_STARTED" && (strings.HasPrefix(cause, "ERROR") || cause == "INSTALL_CANCELLED"):
					out.detail = msg
					a.dsuLog("%s", msg)
					return out, nil
				}
				continue
			}
			if strings.HasPrefix(line, "E/") {
				a.dsuLog("%s", msg)
			}
		}
	}
}

func dsuHumanStr(n string) string {
	v, err := strconv.ParseInt(n, 10, 64)
	if err != nil {
		return n
	}
	return humanBytes(v)
}
