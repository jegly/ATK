// System-wide appearance overrides layered ON TOP of the selected theme:
//   - a custom accent colour (overrides --accent-green / --accent-dim)
//   - a custom UI font (overrides the app's sans font)
//
// Both are applied as INLINE custom properties on <html>, which beats the
// per-theme stylesheet rules, and persist in localStorage. Clearing an override
// removes the inline prop so the theme's own value shows through again.

const ACCENT_KEY = 'atk-custom-accent'
const FONT_KEY = 'atk-custom-font'

// Built-in font choices. '' = use the theme/app default. The two @fontsource
// families are bundled; the rest are system generics that always resolve.
export const FONT_OPTIONS: { id: string; label: string; stack: string }[] = [
  { id: '',                 label: 'Default (IBM Plex Sans)', stack: '' },
  { id: 'jetbrains',        label: 'JetBrains Mono',          stack: "'JetBrains Mono', monospace" },
  { id: 'system-sans',      label: 'System Sans',             stack: 'system-ui, sans-serif' },
  { id: 'system-serif',     label: 'System Serif',            stack: 'Georgia, \'Times New Roman\', serif' },
  { id: 'system-mono',      label: 'System Monospace',        stack: 'ui-monospace, \'Cascadia Code\', \'Courier New\', monospace' },
]

export function hexToChannels(hex: string): string | null {
  const m = /^#?([0-9a-fA-F]{6})$/.exec(hex.trim())
  if (!m) return null
  const n = parseInt(m[1], 16)
  return `${(n >> 16) & 255} ${(n >> 8) & 255} ${n & 255}`
}

function darkenChannels(ch: string, f: number): string {
  const [r, g, b] = ch.split(' ').map(Number)
  return `${Math.round(r * f)} ${Math.round(g * f)} ${Math.round(b * f)}`
}

export function getCustomAccent(): string { return localStorage.getItem(ACCENT_KEY) || '' }
export function getCustomFont(): string { return localStorage.getItem(FONT_KEY) || '' }

export function setCustomAccent(hex: string | null): void {
  if (hex && hexToChannels(hex)) localStorage.setItem(ACCENT_KEY, hex)
  else localStorage.removeItem(ACCENT_KEY)
  applyAppearance()
}

export function setCustomFont(id: string | null): void {
  if (id) localStorage.setItem(FONT_KEY, id)
  else localStorage.removeItem(FONT_KEY)
  applyAppearance()
}

// applyAppearance (re)applies the stored overrides. Call on boot and after a change.
export function applyAppearance(): void {
  const root = document.documentElement

  const accent = getCustomAccent()
  const ch = accent ? hexToChannels(accent) : null
  if (ch) {
    root.style.setProperty('--accent-green', ch)
    root.style.setProperty('--accent-dim', darkenChannels(ch, 0.82))
  } else {
    root.style.removeProperty('--accent-green')
    root.style.removeProperty('--accent-dim')
  }

  const fontId = getCustomFont()
  const stack = FONT_OPTIONS.find(f => f.id === fontId)?.stack
  if (stack) root.style.setProperty('--app-font', stack)
  else root.style.removeProperty('--app-font')
}
