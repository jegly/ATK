package main

import (
	"bufio"
	"bytes"
	"context"
	"fmt"
	"os/exec"
	"regexp"
	"strconv"
	"strings"
	"time"

	"github.com/wailsapp/wails/v2/pkg/runtime"
)

// Streaming push/pull with live progress. adb prints transfer progress as
// `[ 42%] path` lines terminated by a carriage return; we split on \r as well
// as \n so each update is its own token, parse the percentage, and forward it
// to the frontend via transfer:* events. ETA is computed frontend-side from the
// percentage over elapsed time. Integrates with beginCancellableOp so the
// existing Cancel button (CancelOperation) aborts a transfer.

var transferPercentRe = regexp.MustCompile(`(\d+)%`)

// scanCRLF is a bufio.SplitFunc that breaks on either \n or \r, so adb's
// carriage-return progress updates surface as discrete tokens.
func scanCRLF(data []byte, atEOF bool) (advance int, token []byte, err error) {
	if atEOF && len(data) == 0 {
		return 0, nil, nil
	}
	for i, b := range data {
		if b == '\n' || b == '\r' {
			return i + 1, data[:i], nil
		}
	}
	if atEOF {
		return len(data), data, nil
	}
	return 0, nil, nil
}

func baseName(p string) string {
	p = strings.TrimRight(p, "/")
	if i := strings.LastIndexAny(p, `/\`); i >= 0 {
		return p[i+1:]
	}
	return p
}

// runTransfer runs an adb push/pull, emitting transfer:progress events as it
// goes. kind is "push" or "pull"; label is the item name shown in the UI.
func (a *App) runTransfer(ctx context.Context, kind, label string, args ...string) error {
	adbPath, err := a.getBinaryPath("adb")
	if err != nil {
		return err
	}

	cmd := exec.CommandContext(ctx, adbPath, args...)
	setCommandSysProcAttr(cmd)

	stdout, err := cmd.StdoutPipe()
	if err != nil {
		return fmt.Errorf("stdout pipe: %w", err)
	}
	var stderr bytes.Buffer
	cmd.Stderr = &stderr

	if err := cmd.Start(); err != nil {
		return fmt.Errorf("failed to start adb %s: %w", kind, err)
	}

	emit := func(percent int) {
		runtime.EventsEmit(a.ctx, "transfer:progress", map[string]interface{}{
			"kind": kind, "label": label, "percent": percent,
		})
	}
	emit(0)

	scanner := bufio.NewScanner(stdout)
	scanner.Buffer(make([]byte, 64*1024), 1024*1024)
	scanner.Split(scanCRLF)
	last := -1
	for scanner.Scan() {
		tok := strings.TrimSpace(scanner.Text())
		if tok == "" {
			continue
		}
		if m := transferPercentRe.FindStringSubmatch(tok); m != nil {
			if p, perr := strconv.Atoi(m[1]); perr == nil && p != last {
				last = p
				emit(p)
			}
		}
	}

	if werr := cmd.Wait(); werr != nil {
		if ctx.Err() == context.Canceled {
			return fmt.Errorf("cancelled")
		}
		msg := strings.TrimSpace(stderr.String())
		if msg == "" {
			msg = werr.Error()
		}
		return fmt.Errorf("%s", msg)
	}
	emit(100)
	return nil
}

// PushWithProgress pushes a local file into remoteDir, streaming progress.
func (a *App) PushWithProgress(localPath, remoteDir string) (string, error) {
	ctx, cancel := a.beginCancellableOp(60 * time.Minute)
	defer cancel()

	name := baseName(localPath)
	err := a.runTransfer(ctx, "push", name, "push", localPath, remoteDir)
	runtime.EventsEmit(a.ctx, "transfer:done", nil)
	if err != nil {
		if strings.Contains(err.Error(), "cancelled") {
			return "", fmt.Errorf("push cancelled")
		}
		return "", fmt.Errorf("push failed: %w", err)
	}
	return fmt.Sprintf("Pushed %s", name), nil
}

// PushPathsWithProgress pushes the given local files into remoteDir on the
// device, one at a time, each with its own progress bar. Used by the Computer
// browser's "Push to device" action.
func (a *App) PushPathsWithProgress(localPaths []string, remoteDir string) (string, error) {
	if len(localPaths) == 0 {
		return "", fmt.Errorf("no files selected")
	}
	if strings.TrimSpace(remoteDir) == "" {
		return "", fmt.Errorf("no device destination")
	}

	ctx, cancel := a.beginCancellableOp(60 * time.Minute)
	defer cancel()

	var ok, fail int
	var details strings.Builder
	for _, lp := range localPaths {
		name := baseName(lp)
		err := a.runTransfer(ctx, "push", name, "push", lp, remoteDir)
		if err != nil {
			if strings.Contains(err.Error(), "cancelled") {
				details.WriteString(fmt.Sprintf("• %s: cancelled\n", name))
				fail++
				break
			}
			fail++
			details.WriteString(fmt.Sprintf("• %s: %v\n", name, err))
		} else {
			ok++
		}
	}
	runtime.EventsEmit(a.ctx, "transfer:done", nil)

	summary := fmt.Sprintf("Pushed %d item(s) to %s.", ok, remoteDir)
	if fail > 0 {
		summary += fmt.Sprintf(" Failed: %d\n%s", fail, details.String())
	}
	return summary, nil
}

// PullPathsWithProgress pulls the given remote paths into a user-chosen local
// directory, one at a time, each with its own progress bar.
func (a *App) PullPathsWithProgress(remotePaths []string) (string, error) {
	if len(remotePaths) == 0 {
		return "", fmt.Errorf("no files selected")
	}

	localDir, err := a.SelectDirectoryForPull()
	if err != nil {
		return "", fmt.Errorf("folder dialog failed: %w", err)
	}
	if localDir == "" {
		return "Pull cancelled.", nil
	}

	ctx, cancel := a.beginCancellableOp(0)
	defer cancel()

	var ok, fail int
	var details strings.Builder
	for _, rp := range remotePaths {
		name := baseName(rp)
		// -a preserves timestamps
		err := a.runTransfer(ctx, "pull", name, "pull", "-a", rp, localDir)
		if err != nil {
			if strings.Contains(err.Error(), "cancelled") {
				details.WriteString(fmt.Sprintf("• %s: cancelled\n", name))
				fail++
				break
			}
			fail++
			details.WriteString(fmt.Sprintf("• %s: %v\n", name, err))
		} else {
			ok++
		}
	}
	runtime.EventsEmit(a.ctx, "transfer:done", nil)

	summary := fmt.Sprintf("Pulled %d item(s) to %s.", ok, localDir)
	if fail > 0 {
		summary += fmt.Sprintf(" Failed: %d\n%s", fail, details.String())
	}
	return summary, nil
}
