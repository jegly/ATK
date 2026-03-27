/** @type {import('tailwindcss').Config} */
export default {
  content: [
    "./index.html",
    "./src/**/*.{js,ts,jsx,tsx}",
  ],
  theme: {
    extend: {
      colors: {
        bg: {
          base:    '#0a0a0f',
          surface: '#111118',
          raised:  '#18181f',
          border:  '#252530',
        },
        accent: {
          green:   '#00ff88',
          dim:     '#00cc6a',
          muted:   '#003322',
        },
        text: {
          primary:   '#e8e8f0',
          secondary: '#8888aa',
          muted:     '#44445a',
        },
        danger: '#ff4444',
        warn:   '#ffaa00',
      },
      fontFamily: {
        mono: ['"JetBrains Mono"', '"Fira Code"', 'monospace'],
        sans: ['"IBM Plex Sans"', 'sans-serif'],
      },
    },
  },
  plugins: [],
}
