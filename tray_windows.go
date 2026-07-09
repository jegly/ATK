package main

// No tray implementation on Windows yet - only verified on Linux (see
// tray_linux.go) against this project's actual dev/test machine. ATK runs
// fine without it; the frontend's close dialog just won't offer "Minimize to
// tray" here (TrayAvailable() is false).

func initTray(a *App)   {}
func closeTray()        {}
func trayAvailable() bool { return false }
