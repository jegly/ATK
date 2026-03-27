//go:build !windows

package main

import (
	"os/exec"
	"syscall"
)

// setCommandSysProcAttr sets platform-specific process attributes.
// On Linux: sets a new process group so child processes don't receive
// terminal signals meant for the parent, and enables proper cleanup.
func setCommandSysProcAttr(cmd *exec.Cmd) {
	cmd.SysProcAttr = &syscall.SysProcAttr{
		Setpgid: true,
	}
}
