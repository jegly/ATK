// Sidebar position preference. Mirrors src/lib/theme.ts: persisted in
// localStorage, but here we also broadcast a window event so App.tsx can swap
// its layout live (the theme just flips a <html> attribute and needs no React
// state — the sidebar position changes the React tree, so it does).

export type SidebarPosition = 'left' | 'top' | 'bottom'

export const SIDEBAR_POSITIONS: { id: SidebarPosition; label: string; hint: string }[] = [
  { id: 'left',   label: 'Left',   hint: 'Vertical rail on the side' },
  { id: 'top',    label: 'Top',    hint: 'Horizontal bar across the top' },
  { id: 'bottom', label: 'Bottom', hint: 'Horizontal bar across the bottom (default)' },
]

const STORAGE_KEY = 'atk-sidebar-position'
const EVENT = 'atk-sidebar-position-change'

export function getSidebarPosition(): SidebarPosition {
  const p = localStorage.getItem(STORAGE_KEY)
  return p === 'top' || p === 'bottom' || p === 'left' ? p : 'bottom'
}

export function setSidebarPosition(p: SidebarPosition): void {
  localStorage.setItem(STORAGE_KEY, p)
  window.dispatchEvent(new CustomEvent(EVENT, { detail: p }))
}

export function onSidebarPositionChange(cb: (p: SidebarPosition) => void): () => void {
  const handler = (e: Event) => cb((e as CustomEvent).detail as SidebarPosition)
  window.addEventListener(EVENT, handler)
  return () => window.removeEventListener(EVENT, handler)
}

// Whether to show the text label under each sidebar icon. Same live-broadcast
// pattern as the position pref above.
const LABELS_KEY = 'atk-sidebar-labels'
const LABELS_EVENT = 'atk-sidebar-labels-change'

export function getSidebarLabels(): boolean {
  return localStorage.getItem(LABELS_KEY) !== '0' // on by default
}

export function setSidebarLabels(on: boolean): void {
  localStorage.setItem(LABELS_KEY, on ? '1' : '0')
  window.dispatchEvent(new CustomEvent(LABELS_EVENT, { detail: on }))
}

export function onSidebarLabelsChange(cb: (on: boolean) => void): () => void {
  const handler = (e: Event) => cb((e as CustomEvent).detail as boolean)
  window.addEventListener(LABELS_EVENT, handler)
  return () => window.removeEventListener(LABELS_EVENT, handler)
}
