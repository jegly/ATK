import React from 'react'
import ReactDOM from 'react-dom/client'
import App from './App'
// Local self-hosted fonts (bundled into the app — no network/CDN at runtime)
import '@fontsource/ibm-plex-sans/400.css'
import '@fontsource/ibm-plex-sans/500.css'
import '@fontsource/ibm-plex-sans/600.css'
import '@fontsource/jetbrains-mono/400.css'
import '@fontsource/jetbrains-mono/500.css'
import './styles/global.css'
import { applyTheme, getTheme } from './lib/theme'
import { applyAppearance } from './lib/appearance'

// Apply the saved theme + custom accent/font before first paint to avoid a flash.
applyTheme(getTheme())
applyAppearance()

ReactDOM.createRoot(document.getElementById('root')!).render(
  <React.StrictMode>
    <App />
  </React.StrictMode>,
)
