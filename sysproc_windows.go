package main

import "os/exec"

func setCommandSysProcAttr(cmd *exec.Cmd) {
	// Windows does not use Setpgid
}
