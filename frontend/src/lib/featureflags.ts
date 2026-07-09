// Opt-in feature flags persisted in localStorage. Read on view mount (no live
// event needed — switching views remounts and re-reads).

const ROOT_TOOLS_KEY = 'atk-root-tools'

// Rooting / Magisk patching tools in the Flasher. Off by default — these are
// advanced, destructive-adjacent operations.
export function getRootTools(): boolean {
  return localStorage.getItem(ROOT_TOOLS_KEY) === '1'
}

export function setRootTools(on: boolean): void {
  localStorage.setItem(ROOT_TOOLS_KEY, on ? '1' : '0')
}

// Mute error pop-ups that are just "no device / offline / unauthorized".
const MUTE_NODEVICE_KEY = 'atk-mute-nodevice'
export function getMuteNoDevice(): boolean {
  return localStorage.getItem(MUTE_NODEVICE_KEY) === '1'
}
export function setMuteNoDevice(on: boolean): void {
  localStorage.setItem(MUTE_NODEVICE_KEY, on ? '1' : '0')
}

// ── Sidebar feature kill-switch ──────────────────────────────────────────────
// Users can hide nav entries they don't use. Settings is never hideable.
const HIDDEN_KEY = 'atk-hidden-views'
const HIDDEN_EVENT = 'atk-hidden-views-change'

export const TOGGLEABLE_VIEWS: { view: string; label: string }[] = [
  { view: 'dashboard', label: 'Dashboard' },
  { view: 'files', label: 'Files' },
  { view: 'mirror', label: 'Screen Mirror' },
  { view: 'packages', label: 'Packages' },
  { view: 'apkinstaller', label: 'APK Installer' },
  { view: 'debloater', label: 'Debloater' },
  { view: 'shell', label: 'Shell' },
  { view: 'logcat', label: 'Logcat' },
  { view: 'appinspect', label: 'App Inspector' },
  { view: 'intentlab', label: 'Intent Lab' },
  { view: 'apkaudit', label: 'APK Audit' },
  { view: 'certs', label: 'Certificates' },
  { view: 'backup', label: 'Backup' },
  { view: 'props', label: 'Prop Editor' },
  { view: 'utilities', label: 'Utilities' },
  { view: 'flasher', label: 'Flasher' },
  { view: 'gsiloader', label: 'GSI Loader' },
]

export function getHiddenViews(): string[] {
  try {
    const raw = localStorage.getItem(HIDDEN_KEY)
    return raw ? JSON.parse(raw) : []
  } catch {
    return []
  }
}

export function setHiddenViews(views: string[]): void {
  localStorage.setItem(HIDDEN_KEY, JSON.stringify(views))
  window.dispatchEvent(new CustomEvent(HIDDEN_EVENT, { detail: views }))
}

export function onHiddenViewsChange(cb: (views: string[]) => void): () => void {
  const handler = (e: Event) => cb((e as CustomEvent).detail as string[])
  window.addEventListener(HIDDEN_EVENT, handler)
  return () => window.removeEventListener(HIDDEN_EVENT, handler)
}

// ── Custom sidebar order (drag-to-reorder, dock-style) ───────────────────────
const ORDER_KEY = 'atk-nav-order'

export function getNavOrder(): string[] {
  try {
    const raw = localStorage.getItem(ORDER_KEY)
    return raw ? JSON.parse(raw) : []
  } catch {
    return []
  }
}

export function setNavOrder(order: string[]): void {
  localStorage.setItem(ORDER_KEY, JSON.stringify(order))
}
