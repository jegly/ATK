//go:build !windows

package main

import "syscall"

// diskFreeBytes returns the space available to this user on the filesystem
// holding path, or -1 if it cannot be read.
func diskFreeBytes(path string) int64 {
	var st syscall.Statfs_t
	if err := syscall.Statfs(path, &st); err != nil {
		return -1
	}
	return int64(st.Bavail) * int64(st.Bsize)
}
