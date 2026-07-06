package main

import (
	"embed"
	"os"
	"runtime"

	"github.com/wailsapp/wails/v2"
	"github.com/wailsapp/wails/v2/pkg/options"
	"github.com/wailsapp/wails/v2/pkg/options/assetserver"
	"github.com/wailsapp/wails/v2/pkg/options/linux"
)

//go:embed all:frontend/dist
var assets embed.FS

// ensureWebGLEnv makes WebKitGTK's WebGL actually work (needed by the Logcat
// visual map's GPU renderers). On Wayland/headless/VM setups the default DMABUF
// renderer breaks WebGL (black canvas), and hardware GL via the render node
// often doesn't work even when a /dev/dri node exists. The reliable fix that
// works everywhere is to disable the DMABUF renderer and use Mesa's software
// rasteriser (llvmpipe) — which is plenty fast for this 2D visualisation.
// We can't reliably detect "hardware WebGL actually works" from outside the
// webview (Mesa ships every driver .so regardless of hardware), so we force
// software GL by default. Power users with known-good hardware GL can set
// ATK_GPU=1 to keep hardware acceleration. Must run before the webview inits.
func ensureWebGLEnv() {
	if runtime.GOOS != "linux" || os.Getenv("ATK_GPU") == "1" {
		return
	}
	if os.Getenv("WEBKIT_DISABLE_DMABUF_RENDERER") == "" {
		os.Setenv("WEBKIT_DISABLE_DMABUF_RENDERER", "1")
	}
	if os.Getenv("LIBGL_ALWAYS_SOFTWARE") == "" {
		os.Setenv("LIBGL_ALWAYS_SOFTWARE", "1")
	}
}

func main() {
	ensureWebGLEnv()
	app := NewApp()

	err := wails.Run(&options.App{
		Title:     "ATK — Android Toolkit",
		Width:     1280,
		Height:    800,
		Frameless: true, // custom React TitleBar; also drops the GTK title (no app name)
		// Restore the native right-click Copy/Paste/Select-All menu — Wails hides
		// it in production by default, which made text feel uncopyable everywhere.
		EnableDefaultContextMenu: true,
		AssetServer: &assetserver.Options{
			Assets:  assets,
			Handler: app.fileHandler(), // serves /__file for the image viewer
		},
		// Transparent surface so the CSS-rounded root corners show through
		// (frameless window can't round itself — see App.tsx root + global.css).
		BackgroundColour: &options.RGBA{R: 0, G: 0, B: 0, A: 0},
		OnStartup:        app.Startup,
		OnShutdown:       app.Shutdown,
		// Drop a Pixel factory .zip onto the Flasher's Pixel Factory tab to load it.
		DragAndDrop: &options.DragAndDrop{
			EnableFileDrop: true,
		},
		Bind: []interface{}{
			app,
		},
		Linux: &linux.Options{
			WindowIsTranslucent: true,
			// Always-on GPU compositing — smoother repaints during drag-select on
			// the translucent (rounded-corner) window than the on-demand policy.
			WebviewGpuPolicy: linux.WebviewGpuPolicyAlways,
		},
	})

	if err != nil {
		println("Error:", err.Error())
	}
}
