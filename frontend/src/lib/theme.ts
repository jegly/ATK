// Theme management. Palettes are defined in src/styles/global.css and selected
// by the data-theme attribute on <html>. Choice is persisted in localStorage.
//
// The catalogue below is the single source of truth: adding a palette here
// (plus its CSS block in global.css) makes it appear in the Settings picker
// automatically. The `swatch` tuple ([base, surface, accent, text]) drives the
// preview shown on each theme card.

export interface ThemeDef {
  id: string
  label: string
  hint: string
  swatch: [string, string, string, string]
}

export const THEMES: ThemeDef[] = [
  // ATK originals
  { id: 'dark',   label: 'Dark',   hint: 'Terminal green on black',     swatch: ['#0a0a0f', '#111118', '#00ff88', '#e8e8f0'] },
  { id: 'frappe', label: 'Frappé', hint: 'Catppuccin — pastels, dark',  swatch: ['#303446', '#292c3c', '#a6d189', '#c6d0f5'] },
  { id: 'latte',  label: 'Latte',  hint: 'Catppuccin — pastels, light', swatch: ['#eff1f5', '#e6e9ef', '#40a02b', '#4c4f69'] },
  // Ported from Notas
  { id: 'dracula', label: 'Dracula', hint: 'Purple & pink on charcoal', swatch: ['#282a36', '#343746', '#bd93f9', '#f8f8f2'] },
  { id: 'catppuccin-macchiato', label: 'Catppuccin Macchiato', hint: 'Catppuccin — pastels, medium-dark', swatch: ['#24273a', '#363a4f', '#c6a0f6', '#cad3f5'] },
  { id: 'catppuccin-mocha', label: 'Catppuccin Mocha', hint: 'Catppuccin — pastels, darkest', swatch: ['#1e1e2e', '#313244', '#cba6f7', '#cdd6f4'] },
  { id: 'vintage-light', label: 'Vintage Light', hint: 'Warm sepia paper, light', swatch: ['#f6efe1', '#efe5d0', '#b07d3a', '#46392b'] },
  { id: 'neon-tessera', label: 'Neon Tessera', hint: 'Cyan & magenta neon on black', swatch: ['#0a0e14', '#11161f', '#00e5ff', '#d8e6f2'] },
  { id: 'adventure-time', label: 'Adventure Time', hint: 'Playful purple & orange', swatch: ['#1f1d45', '#2a2755', '#e7741e', '#f8dcc0'] },
  { id: 'borland', label: 'Borland', hint: 'Retro blue IDE', swatch: ['#0000a4', '#0a1ab0', '#ffff4e', '#ffff80'] },
  { id: 'c64', label: 'Commodore 64', hint: 'Commodore 64 blues', swatch: ['#40318d', '#4d3ea0', '#bfce72', '#cabdf2'] },
  { id: 'fairy-floss-dark', label: 'Fairy Floss Dark', hint: 'Cotton-candy pastels', swatch: ['#3b364c', '#4a4564', '#ffb8d1', '#f8f8f2'] },
  { id: 'flat', label: 'Flat', hint: 'Flat-UI slate & blue', swatch: ['#2c3e50', '#34495e', '#3498db', '#ecf0f1'] },
  { id: 'gogh', label: 'Gogh — Starry Night', hint: 'Starry Night blues & gold', swatch: ['#0d1b34', '#14264a', '#f4cd3a', '#e8eeff'] },
  { id: 'grass', label: 'Grass', hint: 'Green field & amber', swatch: ['#13773d', '#1c8a4a', '#e7b000', '#fff0a5'] },
  { id: 'gruvbox-material', label: 'Gruvbox Material', hint: 'Warm retro earth tones', swatch: ['#282828', '#32302f', '#d8a657', '#d4be98'] },
  { id: 'homebrew', label: 'Homebrew', hint: 'Green-on-black terminal', swatch: ['#000000', '#0c140c', '#00ff00', '#00d000'] },
  { id: 'ocean', label: 'Ocean', hint: 'Muted blue-grey', swatch: ['#2b303b', '#343d46', '#8fa1b3', '#c0c5ce'] },
  { id: 'kokuban', label: 'Kokuban', hint: 'Chalkboard green', swatch: ['#1f3526', '#274030', '#f2e9c8', '#f0f0e8'] },
  { id: 'mono-cyan', label: 'Mono Cyan', hint: 'Monochrome cyan glow', swatch: ['#081414', '#0e1f1f', '#00d0d0', '#c8f0f0'] },
  // More additions
  { id: 'nord', label: 'Nord', hint: 'Arctic blue-grey with frost green', swatch: ['#2e3440', '#3b4252', '#a3be8c', '#eceff4'] },
  { id: 'tokyo-night', label: 'Tokyo Night', hint: 'Neon purple & blue on midnight', swatch: ['#1a1b26', '#16161e', '#9ece6a', '#c0caf5'] },
  { id: 'solarized-dark', label: 'Solarized Dark', hint: 'Low-contrast teal & olive', swatch: ['#002b36', '#073642', '#859900', '#93a1a1'] },
  { id: 'solarized-light', label: 'Solarized Light', hint: 'Low-contrast teal & olive, light', swatch: ['#fdf6e3', '#eee8d5', '#859900', '#586e75'] },
  { id: 'rose-pine', label: 'Rosé Pine', hint: 'Elegant muted purple & rose', swatch: ['#191724', '#1f1d2e', '#9ccfd8', '#e0def4'] },
  { id: 'everforest', label: 'Everforest', hint: 'Warm forest green, easy on the eyes', swatch: ['#2d353b', '#343f44', '#a7c080', '#d3c6aa'] },
]

export type Theme = string

const STORAGE_KEY = 'atk-theme'
const VALID_IDS = new Set(THEMES.map(t => t.id))
const DEFAULT_THEME: Theme = 'gruvbox-material'

export function getTheme(): Theme {
  const t = localStorage.getItem(STORAGE_KEY)
  return t && VALID_IDS.has(t) ? t : DEFAULT_THEME
}

export function applyTheme(theme: Theme): void {
  const t = VALID_IDS.has(theme) ? theme : DEFAULT_THEME
  document.documentElement.setAttribute('data-theme', t)
  localStorage.setItem(STORAGE_KEY, t)
}
