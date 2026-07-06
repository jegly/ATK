package main

import (
	"bufio"
	"context"
	"fmt"
	"os/exec"
	"regexp"
	"strings"
	"sync"

	"github.com/wailsapp/wails/v2/pkg/runtime"
)

type LogcatLine struct {
	Raw      string   `json:"raw"`
	Level    string   `json:"level"`
	Tag      string   `json:"tag"`
	Message  string   `json:"message"`
	PID      string   `json:"pid"`
	TID      string   `json:"tid"`
	Time     string   `json:"time"`
	Refs     []LogRef `json:"refs"`     // mined relationships (native, for the visual map)
	Mentions []LogRef `json:"mentions"` // generic package mentions (optional/noisy)
}

var (
	logcatCancel context.CancelFunc
	logcatMu     sync.Mutex
)

// StartLogcat begins streaming logcat to the frontend via events.
// filter: optional tag filter e.g. "ActivityManager:I *:S"
// buffer: "main", "radio", "events", "crash", or "all"
func (a *App) StartLogcat(filter string, buffer string) error {
	logcatMu.Lock()
	defer logcatMu.Unlock()

	// Stop any existing logcat
	if logcatCancel != nil {
		logcatCancel()
		logcatCancel = nil
	}

	adbPath, err := a.getBinaryPath("adb")
	if err != nil {
		return err
	}

	args := []string{"logcat", "-v", "threadtime"}

	if buffer != "" && buffer != "main" {
		if buffer == "all" {
			args = append(args, "-b", "all")
		} else {
			args = append(args, "-b", buffer)
		}
	}

	if filter != "" {
		args = append(args, strings.Fields(filter)...)
	}

	ctx, cancel := context.WithCancel(context.Background())
	logcatCancel = cancel

	cmd := exec.CommandContext(ctx, adbPath, args...)
	setCommandSysProcAttr(cmd)

	stdout, err := cmd.StdoutPipe()
	if err != nil {
		cancel()
		return fmt.Errorf("failed to get stdout pipe: %w", err)
	}

	if err := cmd.Start(); err != nil {
		cancel()
		return fmt.Errorf("failed to start logcat: %w", err)
	}

	go func() {
		defer cancel()
		scanner := bufio.NewScanner(stdout)
		scanner.Buffer(make([]byte, 1024*1024), 1024*1024)
		for scanner.Scan() {
			line := scanner.Text()
			parsed := parseLogcatLine(line)
			runtime.EventsEmit(a.ctx, "logcat:line", parsed)
		}
		runtime.EventsEmit(a.ctx, "logcat:stopped", nil)
		cmd.Wait()
	}()

	return nil
}

// StopLogcat stops the running logcat stream.
func (a *App) StopLogcat() {
	logcatMu.Lock()
	defer logcatMu.Unlock()
	if logcatCancel != nil {
		logcatCancel()
		logcatCancel = nil
	}
}

// ClearLogcat clears all logcat buffers.
func (a *App) ClearLogcat() error {
	_, err := a.runCommand("adb", "logcat", "-c")
	return err
}

// LogcatProcessNames returns a best-effort PID -> process/package name map so the
// visual map can label process nodes with real names (e.g. com.android.systemui)
// instead of bare PIDs. Parsed from `ps -A`; the NAME column is the last field
// and the PID is the second. Best-effort: a failure just yields an empty map and
// the UI falls back to PIDs.
func (a *App) LogcatProcessNames() (map[string]string, error) {
	out, err := a.runAdbShell("ps", "-A", "-o", "PID,NAME")
	if err != nil || strings.TrimSpace(out) == "" {
		// Older toybox builds reject -o; fall back to the full table.
		out, err = a.runAdbShell("ps", "-A")
		if err != nil {
			return map[string]string{}, nil
		}
	}

	names := make(map[string]string)
	for i, line := range strings.Split(out, "\n") {
		fields := strings.Fields(line)
		if len(fields) < 2 {
			continue
		}
		// Skip a header row ("PID NAME" or the ps -A column header).
		if i == 0 && !isAllDigits(fields[0]) && !isAllDigits(fields[1]) {
			continue
		}
		var pid, name string
		if isAllDigits(fields[0]) {
			// `ps -A -o PID,NAME` → "PID NAME"
			pid, name = fields[0], fields[len(fields)-1]
		} else if isAllDigits(fields[1]) {
			// full `ps -A` table → "USER PID PPID ... NAME"
			pid, name = fields[1], fields[len(fields)-1]
		} else {
			continue
		}
		if pid != "" && name != "" {
			names[pid] = name
		}
	}
	return names, nil
}

func isAllDigits(s string) bool {
	if s == "" {
		return false
	}
	for _, r := range s {
		if r < '0' || r > '9' {
			return false
		}
	}
	return true
}

// threadtime format: "MM-DD HH:MM:SS.mmm  PID  TID L TAG: message"
// PID/TID are right-aligned with variable padding, so a naive split-on-space
// mis-assigns fields. This regex tolerates arbitrary whitespace runs.
var logcatRe = regexp.MustCompile(`^(\d{2}-\d{2} \d{2}:\d{2}:\d{2}\.\d{3})\s+(\d+)\s+(\d+)\s+([A-Za-z])\s+(.*?):\s?(.*)$`)

// parseLogcatLine parses a threadtime logcat line. Non-matching lines (e.g.
// "--------- beginning of main") keep their raw text as the message.
func parseLogcatLine(line string) LogcatLine {
	result := LogcatLine{Raw: line}

	m := logcatRe.FindStringSubmatch(line)
	if m == nil {
		result.Message = strings.TrimSpace(line)
		result.Refs = []LogRef{}
		result.Mentions = []LogRef{}
		return result
	}

	result.Time = m[1]
	result.PID = m[2]
	result.TID = m[3]
	result.Level = m[4]
	result.Tag = strings.TrimSpace(m[5])
	result.Message = m[6]
	result.Refs = lcpExtractRefs(result.Tag, result.Message)
	result.Mentions = lcpExtractMentions(result.Message, 3)
	return result
}
