// Theme management. Palettes are defined in src/styles/global.css and selected
// by the data-theme attribute on <html>. Choice is persisted in localStorage.

export type Theme = 'dark' | 'frappe' | 'latte'

export const THEMES: { id: Theme; label: string; hint: string }[] = [
  { id: 'dark',   label: 'Dark',   hint: 'Terminal green on black' },
  { id: 'frappe', label: 'Frappé', hint: 'Catppuccin — soft pastels, dark' },
  { id: 'latte',  label: 'Latte',  hint: 'Catppuccin — soft pastels, light (default)' },
]

const STORAGE_KEY = 'atk-theme'

export function getTheme(): Theme {
  const t = localStorage.getItem(STORAGE_KEY)
  return t === 'frappe' || t === 'latte' || t === 'dark' ? t : 'latte'
}

export function applyTheme(theme: Theme): void {
  document.documentElement.setAttribute('data-theme', theme)
  localStorage.setItem(STORAGE_KEY, theme)
}
