package main

// diskFreeBytes is not implemented on Windows; -1 means unknown and the
// Pixel Flasher only warns instead of blocking.
func diskFreeBytes(path string) int64 {
	return -1
}
