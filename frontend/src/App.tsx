import { useState, useEffect } from 'react'
import { Toaster } from 'sonner'
import Sidebar from './components/layout/Sidebar'
import TitleBar from './components/layout/TitleBar'
import DismissibleBanner from './components/DismissibleBanner'
import LockGate from './components/LockGate'
import DangerGate from './components/DangerGate'
import ViewDashboard    from './components/views/ViewDashboard'
import ViewFiles        from './components/views/ViewFiles'
import ViewScreenMirror from './components/views/ViewScreenMirror'
import ViewPackages     from './components/views/ViewPackages'
import ViewDebloater    from './components/views/ViewDebloater'
import ViewShell        from './components/views/ViewShell'
import ViewLogcat       from './components/views/ViewLogcat'
import ViewAppInspect   from './components/views/ViewAppInspect'
import ViewApkAudit     from './components/views/ViewApkAudit'
import ViewCerts        from './components/views/ViewCerts'
import ViewBackup       from './components/views/ViewBackup'
import ViewProps        from './components/views/ViewProps'
import ViewFlasher      from './components/views/ViewFlasher'
import ViewUtilities    from './components/views/ViewUtilities'
import ViewSettings     from './components/views/ViewSettings'
import { CheckSystemRequirements } from './lib/wails'
import { getSidebarPosition, onSidebarPositionChange, getSidebarLabels, onSidebarLabelsChange } from './lib/layout'
import { refreshAppLockStatus } from './lib/applock'
import type { View } from './lib/types'

export default function App() {
  const [view, setView]         = useState<View>('dashboard')
  const [ready, setReady]       = useState(false)
  const [initError, setInitError] = useState('')
  const [sidebarPos, setSidebarPos] = useState(getSidebarPosition())
  const [sidebarLabels, setSidebarLabels] = useState(getSidebarLabels())
  const [locked, setLocked]     = useState(false)

  useEffect(() => {
    // Resolve the lock status before anything else so the gate can show.
    refreshAppLockStatus()
      .then(s => setLocked(s.enabled))
      .finally(() => {
        CheckSystemRequirements()
          .then(() => setReady(true))
          .catch((err: string) => { setInitError(err); setReady(true) })
      })
  }, [])

  useEffect(() => onSidebarPositionChange(setSidebarPos), [])
  useEffect(() => onSidebarLabelsChange(setSidebarLabels), [])

  const renderView = () => {
    switch (view) {
      case 'dashboard':    return <ViewDashboard />
      case 'files':        return <ViewFiles />
      case 'mirror':       return <ViewScreenMirror />
      case 'packages':     return <ViewPackages />
      case 'debloater':    return <ViewDebloater />
      case 'shell':        return <ViewShell />
      case 'logcat':       return <ViewLogcat />
      case 'appinspect':   return <ViewAppInspect />
      case 'apkaudit':     return <ViewApkAudit />
      case 'certs':        return <ViewCerts />
      case 'backup':       return <ViewBackup />
      case 'props':        return <ViewProps />
      case 'flasher':      return <ViewFlasher />
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

  if (locked) return <LockGate onUnlock={() => setLocked(false)} />

  const sidebar = <Sidebar activeView={view} onViewChange={setView} position={sidebarPos} showLabels={sidebarLabels} />

  return (
    <div className="flex flex-col h-full bg-bg-base overflow-hidden rounded-[10px]">
      <DangerGate />
      <TitleBar />
      <div className={`flex-1 flex overflow-hidden ${sidebarPos === 'left' ? 'flex-row' : 'flex-col'}`}>
        {sidebarPos !== 'bottom' && sidebar}
        <main className="flex-1 overflow-hidden flex flex-col">
          {initError && (
            <DismissibleBanner
              id={`init-error:${initError}`}
              className="bg-danger/10 border-b border-danger/20 px-4 py-2 text-danger text-sm"
            >
              <span className="font-mono">⚠</span>
              <span>{initError}</span>
            </DismissibleBanner>
          )}
          <div className="flex-1 overflow-auto">{renderView()}</div>
        </main>
        {sidebarPos === 'bottom' && sidebar}
      </div>
      <Toaster
        position="bottom-right"
        toastOptions={{
          style: {
            background: 'rgb(var(--bg-raised))', border: '1px solid rgb(var(--bg-border))',
            color: 'rgb(var(--text-primary))', fontFamily: "'IBM Plex Sans', sans-serif", fontSize: '13px',
          },
        }}
      />
    </div>
  )
}
