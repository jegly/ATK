// App-lock frontend orchestration.
//
// Two things live here:
//  1. A cached copy of the backend lock status (enabled / requireForDanger) so
//     destructive handlers can decide whether to prompt without an await round-
//     trip every time.
//  2. ensureDangerUnlocked() — call this at the top of any destructive action.
//     When "require password for destructive actions" is on and the backend
//     session window has lapsed, it pops a re-auth modal (hosted by <DangerGate/>
//     in App.tsx) and resolves true only once UnlockDanger succeeds.
//
// The backend enforces the gate for real (see backend_applock.go); this is the
// UX layer that collects the password and keeps the window warm.

import { AppLockStatus, UnlockDanger } from './wails'

export type AppLockState = { enabled: boolean; requireForDanger: boolean }

let cached: AppLockState = { enabled: false, requireForDanger: false }

export function appLockState(): AppLockState {
  return cached
}

export async function refreshAppLockStatus(): Promise<AppLockState> {
  try {
    cached = await AppLockStatus()
  } catch {
    // backend not reachable yet — keep last known (defaults to unlocked)
  }
  return cached
}

// ----- danger re-auth modal host wiring -----

export type DangerRequest = { resolve: (ok: boolean) => void }
let host: ((req: DangerRequest | null) => void) | null = null

// Called once by <DangerGate/> to register itself as the modal host.
export function _registerDangerHost(fn: (req: DangerRequest | null) => void): () => void {
  host = fn
  return () => { if (host === fn) host = null }
}

// Local mirror of the backend's unlock window. Kept slightly shorter so we
// re-prompt a touch before the server window actually lapses.
const DANGER_WINDOW_MS = 4.5 * 60 * 1000
let unlockedUntil = 0

// Call the backend with the entered password; on success arm the local window.
export async function tryUnlockDanger(password: string): Promise<boolean> {
  const ok = await UnlockDanger(password)
  if (ok) unlockedUntil = Date.now() + DANGER_WINDOW_MS
  return ok
}

// Guard for destructive handlers: `if (!(await ensureDangerUnlocked())) return`.
export async function ensureDangerUnlocked(): Promise<boolean> {
  if (!cached.enabled || !cached.requireForDanger) return true
  if (Date.now() < unlockedUntil) return true
  if (!host) return true // modal not mounted (shouldn't happen) — backend still gates
  return new Promise<boolean>(resolve => host!({ resolve }))
}

// Recognise the backend sentinel so callers can surface a friendlier message.
export function isDangerLocked(err: unknown): boolean {
  return String(err).includes('DANGER_LOCKED')
}
