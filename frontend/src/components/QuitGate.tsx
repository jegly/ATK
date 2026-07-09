import { useEffect, useState } from 'react'
import { LogOut, Minus, X } from 'lucide-react'
import { HideWindow, QuitApp, TrayAvailable } from '../lib/wails'
import { _registerQuitHost } from '../lib/quitgate'

// Modal shown when the title bar's close button is clicked. Mirrors
// Frequency's close dialog: offer Minimize-to-tray (default) alongside Quit,
// rather than one silently winning. "Minimize to tray" only shows up if a
// tray icon actually registered (TrayAvailable) - otherwise there'd be no way
// back to the window.
export default function QuitGate() {
  const [open, setOpen] = useState(false)
  const [trayOk, setTrayOk] = useState(false)

  useEffect(() => _registerQuitHost(() => {
    TrayAvailable().then(setTrayOk).catch(() => setTrayOk(false))
    setOpen(true)
  }), [])

  if (!open) return null

  const close = () => setOpen(false)
  const minimize = () => { close(); HideWindow() }
  const quit = () => { close(); QuitApp() }

  return (
    <div
      className="fixed inset-0 z-50 flex items-center justify-center bg-black/50"
      onMouseDown={e => { if (e.target === e.currentTarget) close() }}
    >
      <div className="card p-5 w-80 space-y-4">
        <div className="flex items-center justify-between">
          <p className="text-sm font-medium text-text-primary">Close ATK?</p>
          <button onClick={close} className="btn-ghost text-xs p-1"><X size={14} /></button>
        </div>
        <p className="text-xs text-text-muted">
          {trayOk
            ? 'ATK can keep running in the background and stay reachable from the tray, or quit completely.'
            : 'No tray icon is available on this system, so closing quits ATK completely.'}
        </p>
        <div className="flex gap-2 justify-end">
          <button onClick={close} className="btn-ghost text-xs">Cancel</button>
          {trayOk && (
            <button onClick={minimize} className="btn-ghost text-xs flex items-center gap-1.5">
              <Minus size={12} /> Minimize to tray
            </button>
          )}
          <button onClick={quit} className="btn-danger text-xs flex items-center gap-1.5">
            <LogOut size={12} /> Quit
          </button>
        </div>
      </div>
    </div>
  )
}
