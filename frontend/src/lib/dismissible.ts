// Remembers which dismissible banners/warnings the user has hidden.
// Each banner has a stable string id; dismissals persist in localStorage.

const STORAGE_KEY = 'atk-dismissed'

function load(): Record<string, true> {
  try {
    return JSON.parse(localStorage.getItem(STORAGE_KEY) || '{}')
  } catch {
    return {}
  }
}

function save(map: Record<string, true>): void {
  localStorage.setItem(STORAGE_KEY, JSON.stringify(map))
}

export function isDismissed(id: string): boolean {
  return load()[id] === true
}

export function dismiss(id: string): void {
  const map = load()
  map[id] = true
  save(map)
}

export function undismiss(id: string): void {
  const map = load()
  delete map[id]
  save(map)
}

/** Clear every remembered dismissal (used by a "show all warnings again" action). */
export function resetDismissed(): void {
  localStorage.removeItem(STORAGE_KEY)
}
