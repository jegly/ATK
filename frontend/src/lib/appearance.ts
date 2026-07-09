// System-wide appearance overrides layered ON TOP of the selected theme:
//   - a custom accent colour (overrides --accent-green / --accent-dim)
//   - a custom UI font (overrides the app's sans font)
//
// Both are applied as INLINE custom properties on <html>, which beats the
// per-theme stylesheet rules, and persist in localStorage. Clearing an override
// removes the inline prop so the theme's own value shows through again.

const ACCENT_KEY = 'atk-custom-accent'
const TEXT_COLOR_KEY = 'atk-custom-text-color'
const FONT_KEY = 'atk-custom-font'
const FONT_SIZE_KEY = 'atk-custom-font-size'

// Base UI font size in px. The slider in Settings ranges over these bounds;
// FONT_SIZE_DEFAULT matches global.css's hardcoded fallback (var(--app-font-size, 14px)).
export const FONT_SIZE_MIN = 12
export const FONT_SIZE_MAX = 18
export const FONT_SIZE_DEFAULT = 14

// Built-in font choices. '' = use the theme/app default. The @fontsource
// families and the 8 self-hosted display fonts (styles/fonts.css) are
// bundled; the "system-*" entries are generics that always resolve.
export const FONT_OPTIONS: { id: string; label: string; stack: string }[] = [
  { id: '',                 label: 'Default (IBM Plex Sans)', stack: '' },
  { id: 'jetbrains',        label: 'JetBrains Mono',          stack: "'JetBrains Mono', monospace" },
  { id: 'system-sans',      label: 'System Sans',             stack: 'system-ui, sans-serif' },
  { id: 'system-serif',     label: 'System Serif',            stack: 'Georgia, \'Times New Roman\', serif' },
  { id: 'system-mono',      label: 'System Monospace',        stack: 'ui-monospace, \'Cascadia Code\', \'Courier New\', monospace' },
  { id: 'dotgothic16',      label: 'DotGothic16',             stack: "'DotGothic16', sans-serif" },
  { id: 'geist-pixel',      label: 'Geist Pixel',             stack: "'Geist Pixel', monospace" },
  { id: 'gugi',             label: 'Gugi',                    stack: "'Gugi', sans-serif" },
  { id: 'orbitron',         label: 'Orbitron',                stack: "'Orbitron', sans-serif" },
  { id: 'playfair-display', label: 'Playfair Display',        stack: "'Playfair Display', serif" },
  { id: 'press-start-2p',   label: 'Press Start 2P',          stack: "'Press Start 2P', monospace" },
  { id: 'space-grotesk',    label: 'Space Grotesk',           stack: "'Space Grotesk', sans-serif" },
  { id: 'vt323',            label: 'VT323',                   stack: "'VT323', monospace" },
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
export function getCustomTextColor(): string { return localStorage.getItem(TEXT_COLOR_KEY) || '' }
export function getCustomFont(): string { return localStorage.getItem(FONT_KEY) || '' }

// Returns 0 when unset (theme default applies via the CSS fallback).
export function getCustomFontSize(): number {
  const v = parseInt(localStorage.getItem(FONT_SIZE_KEY) || '', 10)
  return Number.isFinite(v) && v >= FONT_SIZE_MIN && v <= FONT_SIZE_MAX ? v : 0
}

export function setCustomAccent(hex: string | null): void {
  if (hex && hexToChannels(hex)) localStorage.setItem(ACCENT_KEY, hex)
  else localStorage.removeItem(ACCENT_KEY)
  applyAppearance()
}

export function setCustomTextColor(hex: string | null): void {
  if (hex && hexToChannels(hex)) localStorage.setItem(TEXT_COLOR_KEY, hex)
  else localStorage.removeItem(TEXT_COLOR_KEY)
  applyAppearance()
}

export function setCustomFont(id: string | null): void {
  if (id) localStorage.setItem(FONT_KEY, id)
  else localStorage.removeItem(FONT_KEY)
  applyAppearance()
}

export function setCustomFontSize(px: number | null): void {
  if (px && px >= FONT_SIZE_MIN && px <= FONT_SIZE_MAX) localStorage.setItem(FONT_SIZE_KEY, String(px))
  else localStorage.removeItem(FONT_SIZE_KEY)
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

  const textColor = getCustomTextColor()
  const tch = textColor ? hexToChannels(textColor) : null
  if (tch) {
    root.style.setProperty('--text-primary', tch)
  } else {
    root.style.removeProperty('--text-primary')
  }

  const fontId = getCustomFont()
  const stack = FONT_OPTIONS.find(f => f.id === fontId)?.stack
  if (stack) root.style.setProperty('--app-font', stack)
  else root.style.removeProperty('--app-font')

  const fontSize = getCustomFontSize()
  if (fontSize) root.style.setProperty('--app-font-size', `${fontSize}px`)
  else root.style.removeProperty('--app-font-size')
}
