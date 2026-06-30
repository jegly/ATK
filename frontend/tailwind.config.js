/** @type {import('tailwindcss').Config} */
// Colors are driven by CSS variables (RGB channels) defined per theme in
// src/styles/global.css, so opacity modifiers like `bg-accent-green/5` keep
// working. Switch themes by setting data-theme="dark|frappe|latte" on <html>.
const rgbVar = (name) => `rgb(var(${name}) / <alpha-value>)`

export default {
  content: [
    "./index.html",
    "./src/**/*.{js,ts,jsx,tsx}",
  ],
  theme: {
    extend: {
      colors: {
        bg: {
          base:    rgbVar('--bg-base'),
          surface: rgbVar('--bg-surface'),
          raised:  rgbVar('--bg-raised'),
          border:  rgbVar('--bg-border'),
        },
        accent: {
          green:   rgbVar('--accent-green'),
          dim:     rgbVar('--accent-dim'),
          muted:   rgbVar('--accent-muted'),
        },
        text: {
          primary:   rgbVar('--text-primary'),
          secondary: rgbVar('--text-secondary'),
          muted:     rgbVar('--text-muted'),
        },
        danger: rgbVar('--danger'),
        warn:   rgbVar('--warn'),
      },
      fontFamily: {
        mono: ['"JetBrains Mono"', '"Fira Code"', 'monospace'],
        sans: ['"IBM Plex Sans"', 'sans-serif'],
      },
    },
  },
  plugins: [],
}
