package main

import (
	"bufio"
	"context"
	"fmt"
	"os/exec"
	"strings"
	"sync"

	"github.com/wailsapp/wails/v2/pkg/runtime"
)

type LogcatLine struct {
	Raw     string `json:"raw"`
	Level   string `json:"level"`
	Tag     string `json:"tag"`
	Message string `json:"message"`
	PID     string `json:"pid"`
	Time    string `json:"time"`
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

// parseLogcatLine parses a threadtime format logcat line:
// MM-DD HH:MM:SS.mmm PID TID LEVEL TAG: message
func parseLogcatLine(line string) LogcatLine {
	result := LogcatLine{Raw: line}

	parts := strings.SplitN(line, " ", 7)
	if len(parts) < 7 {
		result.Message = line
		return result
	}

	result.Time = strings.TrimSpace(parts[0] + " " + parts[1])
	result.PID = strings.TrimSpace(parts[2])
	// parts[3] = TID
	level := strings.TrimSpace(parts[4])
	if len(level) > 0 {
		result.Level = level
	}
	tagAndMsg := strings.TrimSpace(parts[5])
	if idx := strings.Index(tagAndMsg, ":"); idx >= 0 {
		result.Tag = strings.TrimSpace(tagAndMsg[:idx])
		if len(parts) > 6 {
			result.Message = strings.TrimSpace(parts[6])
		}
	} else {
		result.Tag = tagAndMsg
		if len(parts) > 6 {
			result.Message = strings.TrimSpace(parts[6])
		}
	}

	return result
}
