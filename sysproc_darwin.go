package main

import (
	"os/exec"
	"syscall"
)

func setCommandSysProcAttr(cmd *exec.Cmd) {
	cmd.SysProcAttr = &syscall.SysProcAttr{
		Setpgid: true,
	}
}
