import { useState } from 'react'
import { Archive, RotateCcw, AlertTriangle, Package, Check } from 'lucide-react'
import { StartBackup, RestoreBackup, SelectBackupFile, ListPackages } from '../../lib/wails'
import { notify } from '../../lib/notify'
import type { PackageInfo } from '../../lib/types'

export default function ViewBackup() {
  const [packages, setPackages]       = useState<PackageInfo[]>([])
  const [pkgsLoaded, setPkgsLoaded]   = useState(false)
  const [selected, setSelected]       = useState<Set<string>>(new Set())
  const [includeApks, setIncludeApks] = useState(true)
  const [includeShared, setIncludeShared] = useState(false)
  const [allApps, setAllApps]         = useState(false)
  const [backing, setBacking]         = useState(false)
  const [search, setSearch]           = useState('')
  const [result, setResult]           = useState('')

  const loadPackages = async () => {
    if (pkgsLoaded) return
    try {
      const pkgs = await ListPackages('user')
      setPackages(pkgs || [])
      setPkgsLoaded(true)
    } catch (e: any) {
      notify.error(e)
    }
  }

  const toggleSelect = (pkg: string) => setSelected(prev => {
    const next = new Set(prev)
    next.has(pkg) ? next.delete(pkg) : next.add(pkg)
    return next
  })

  const selectAll = () => {
    const visible = filtered.map(p => p.packageName)
    if (selected.size === visible.length) {
      setSelected(new Set())
    } else {
      setSelected(new Set(visible))
    }
  }

  const startBackup = async () => {
    if (!allApps && selected.size === 0) {
      notify.error('Select packages or enable "All Apps"')
      return
    }

    setBacking(true)
    setResult('')
    const id = notify.loading('Starting backup — confirm on device screen...')
    try {
      const out = await StartBackup({
        includeApks,
        includeShared,
        includeSystem: false,
        packages: [...selected],
        allApps,
      }, '')
      notify.dismiss(id)
      notify.success('Backup complete')
      setResult(out)
    } catch (e: any) {
      notify.dismiss(id)
      notify.error(e)
    } finally {
      setBacking(false)
    }
  }

  const restore = async () => {
    const path = await SelectBackupFile()
    if (!path) return
    if (!confirm(`Restore from:\n${path}\n\nThis will restore data on the device. Confirm on device screen.`)) return
    const id = notify.loading('Starting restore — confirm on device...')
    try {
      const out = await RestoreBackup(path)
      notify.dismiss(id)
      notify.success(out)
    } catch (e: any) {
      notify.dismiss(id)
      notify.error(e)
    }
  }

  const filtered = packages.filter(p =>
    p.packageName.toLowerCase().includes(search.toLowerCase())
  )

  return (
    <div className="flex flex-col h-full overflow-hidden p-4 gap-4">
      {/* Warning */}
      <div className="flex items-start gap-3 bg-warn/5 border border-warn/20 rounded-lg px-4 py-3 shrink-0">
        <AlertTriangle size={15} className="text-warn shrink-0 mt-0.5" />
        <div className="text-xs text-warn/80 space-y-1">
          <p className="font-medium">Android 12+ heavily restricts adb backup</p>
          <p>Apps must opt-in via <span className="mono">android:allowBackup="true"</span> and the <span className="mono">ALLOW_ADB_BACKUP</span> flag. Many modern apps will not be backed up. For full backup, use a rooted device with Titanium Backup or Swift Backup.</p>
        </div>
      </div>

      <div className="grid grid-cols-1 xl:grid-cols-2 gap-4 flex-1 overflow-hidden">
        {/* Backup config */}
        <div className="card p-4 space-y-4 overflow-auto">
          <p className="section-title">Backup Configuration</p>

          {/* Options */}
          <div className="space-y-2">
            <label className="flex items-center gap-3 cursor-pointer">
              <input type="checkbox" checked={includeApks} onChange={e => setIncludeApks(e.target.checked)} className="accent-accent-green" />
              <div>
                <p className="text-xs text-text-primary">Include APK files</p>
                <p className="text-xs text-text-muted">Backs up the app installer along with data</p>
              </div>
            </label>
            <label className="flex items-center gap-3 cursor-pointer">
              <input type="checkbox" checked={includeShared} onChange={e => setIncludeShared(e.target.checked)} className="accent-accent-green" />
              <div>
                <p className="text-xs text-text-primary">Include shared storage</p>
                <p className="text-xs text-text-muted">Includes /sdcard contents (photos, downloads etc)</p>
              </div>
            </label>
            <label className="flex items-center gap-3 cursor-pointer">
              <input type="checkbox" checked={allApps} onChange={e => { setAllApps(e.target.checked); if (e.target.checked) setSelected(new Set()) }} className="accent-accent-green" />
              <div>
                <p className="text-xs text-text-primary">All apps</p>
                <p className="text-xs text-text-muted">Back up all installed user apps (overrides selection below)</p>
              </div>
            </label>
          </div>

          {/* Package selection */}
          {!allApps && (
            <div className="space-y-2">
              <div className="flex items-center justify-between">
                <p className="text-xs text-text-muted">Select specific apps</p>
                <button onClick={() => { loadPackages(); selectAll() }} className="btn-ghost text-xs">
                  {selected.size > 0 ? 'Deselect all' : 'Select all'}
                </button>
              </div>
              <input
                className="input text-xs w-full"
                placeholder="Search packages..."
                value={search}
                onChange={e => setSearch(e.target.value)}
                onFocus={loadPackages}
              />
              <div className="max-h-48 overflow-auto space-y-0.5 border border-bg-border rounded">
                {!pkgsLoaded && (
                  <p className="text-text-muted text-xs text-center p-4">Focus search to load packages</p>
                )}
                {filtered.map(p => (
                  <label key={p.packageName} className="flex items-center gap-2 px-3 py-1.5 hover:bg-bg-raised cursor-pointer">
                    <input
                      type="checkbox"
                      checked={selected.has(p.packageName)}
                      onChange={() => toggleSelect(p.packageName)}
                      className="accent-accent-green shrink-0"
                    />
                    <span className="mono text-xs text-text-secondary truncate">{p.packageName}</span>
                  </label>
                ))}
              </div>
              {selected.size > 0 && (
                <p className="text-xs text-accent-green">{selected.size} app(s) selected</p>
              )}
            </div>
          )}

          <div className="flex gap-2 pt-2">
            <button onClick={startBackup} disabled={backing} className="btn-primary flex-1 justify-center">
              <Archive size={13} />
              {backing ? 'Backing up...' : 'Start Backup'}
            </button>
            <button onClick={restore} className="btn-ghost flex-1 justify-center text-xs">
              <RotateCcw size={13} /> Restore
            </button>
          </div>

          {result && (
            <div className="bg-bg-raised rounded p-3 text-xs mono text-text-secondary whitespace-pre-wrap border border-bg-border">
              {result}
            </div>
          )}
        </div>

        {/* Info panel */}
        <div className="card p-4 space-y-4 overflow-auto">
          <p className="section-title">How adb backup works</p>
          <div className="space-y-3 text-xs text-text-muted">
            <div className="flex gap-2">
              <Check size={12} className="text-accent-green shrink-0 mt-0.5" />
              <p>Creates an encrypted <span className="mono">.adb</span> file on your host machine</p>
            </div>
            <div className="flex gap-2">
              <Check size={12} className="text-accent-green shrink-0 mt-0.5" />
              <p>You must confirm the backup on the device screen — it won't start without device-side confirmation</p>
            </div>
            <div className="flex gap-2">
              <AlertTriangle size={12} className="text-warn shrink-0 mt-0.5" />
              <p>Apps that set <span className="mono">allowBackup=false</span> are silently skipped — you won't be told which ones</p>
            </div>
            <div className="flex gap-2">
              <AlertTriangle size={12} className="text-warn shrink-0 mt-0.5" />
              <p>Android 12+ requires the <span className="mono">ALLOW_ADB_BACKUP</span> flag — most production apps won't have it</p>
            </div>
            <div className="flex gap-2">
              <AlertTriangle size={12} className="text-warn shrink-0 mt-0.5" />
              <p>For bug hunting purposes, this is mainly useful for pulling app data from debuggable or rooted builds</p>
            </div>
          </div>

          <div className="border-t border-bg-border pt-4">
            <p className="section-title mb-2">Useful for bug hunting</p>
            <div className="space-y-1.5 text-xs text-text-muted">
              <p>• Back up a target app's data before testing so you can restore to a clean state</p>
              <p>• Use with <span className="mono">-apk</span> to get both the APK and its data in one file</p>
              <p>• Combine with ADB shell to inspect <span className="mono">/data/data/com.package</span> directly if rooted</p>
            </div>
          </div>
        </div>
      </div>
    </div>
  )
}
