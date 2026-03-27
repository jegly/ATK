import { useState, useEffect } from 'react'
import { Toaster } from 'sonner'
import Sidebar from './components/layout/Sidebar'
import ViewDashboard    from './components/views/ViewDashboard'
import ViewFiles        from './components/views/ViewFiles'
import ViewPackages     from './components/views/ViewPackages'
import ViewDebloater    from './components/views/ViewDebloater'
import ViewShell        from './components/views/ViewShell'
import ViewLogcat       from './components/views/ViewLogcat'
import ViewAppInspect   from './components/views/ViewAppInspect'
import ViewCerts        from './components/views/ViewCerts'
import ViewBackup       from './components/views/ViewBackup'
import ViewProps        from './components/views/ViewProps'
import ViewFlasher      from './components/views/ViewFlasher'
import ViewPixelFlasher from './components/views/ViewPixelFlasher'
import ViewUtilities    from './components/views/ViewUtilities'
import ViewSettings     from './components/views/ViewSettings'
import { CheckSystemRequirements } from './lib/wails'
import type { View } from './lib/types'

export default function App() {
  const [view, setView]         = useState<View>('dashboard')
  const [ready, setReady]       = useState(false)
  const [initError, setInitError] = useState('')

  useEffect(() => {
    CheckSystemRequirements()
      .then(() => setReady(true))
      .catch((err: string) => { setInitError(err); setReady(true) })
  }, [])

  const renderView = () => {
    switch (view) {
      case 'dashboard':    return <ViewDashboard />
      case 'files':        return <ViewFiles />
      case 'packages':     return <ViewPackages />
      case 'debloater':    return <ViewDebloater />
      case 'shell':        return <ViewShell />
      case 'logcat':       return <ViewLogcat />
      case 'appinspect':   return <ViewAppInspect />
      case 'certs':        return <ViewCerts />
      case 'backup':       return <ViewBackup />
      case 'props':        return <ViewProps />
      case 'flasher':      return <ViewFlasher />
      case 'pixelflasher': return <ViewPixelFlasher />
      case 'utilities':    return <ViewUtilities />
      case 'settings':     return <ViewSettings />
      default:             return <ViewDashboard />
    }
  }

  if (!ready) return (
    <div className="flex h-full items-center justify-center bg-bg-base">
      <div className="text-center">
        <div className="w-8 h-8 border-2 border-accent-green border-t-transparent rounded-full animate-spin mx-auto mb-3" />
        <p className="text-text-secondary text-sm">Initialising ATK...</p>
      </div>
    </div>
  )

  return (
    <div className="flex h-full bg-bg-base overflow-hidden">
      <Sidebar activeView={view} onViewChange={setView} />
      <main className="flex-1 overflow-hidden flex flex-col">
        {initError && (
          <div className="bg-danger/10 border-b border-danger/20 px-4 py-2 text-danger text-sm flex items-center gap-2">
            <span className="font-mono">⚠</span>
            <span>{initError}</span>
          </div>
        )}
        <div className="flex-1 overflow-auto">{renderView()}</div>
      </main>
      <Toaster
        position="bottom-right"
        theme="dark"
        toastOptions={{
          style: {
            background: '#18181f', border: '1px solid #252530',
            color: '#e8e8f0', fontFamily: "'IBM Plex Sans', sans-serif", fontSize: '13px',
          },
        }}
      />
    </div>
  )
}
