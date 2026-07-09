// Trigger for the close-confirmation dialog (QuitGate.tsx). The title bar's
// close button calls requestQuitConfirm() instead of quitting directly, so
// the user picks Minimize-to-tray vs Quit rather than the window just vanishing.
let host: (() => void) | null = null

export function _registerQuitHost(fn: () => void): () => void {
  host = fn
  return () => { host = null }
}

export function requestQuitConfirm() {
  host?.()
}
