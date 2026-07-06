import { useState, useEffect } from 'react'
import { Search, Rocket, Play, Terminal, Package } from 'lucide-react'
import { ListActivities, StartActivity, StartIntentAction, ListPackages } from '../../lib/wails'
import { notify } from '../../lib/notify'
import type { IntentActivity, PackageInfo } from '../../lib/types'

export default function ViewIntentLab() {
  const [search, setSearch]         = useState('')
  const [packages, setPackages]     = useState<PackageInfo[]>([])
  const [pkgsLoaded, setPkgsLoaded] = useState(false)
  const [selected, setSelected]     = useState('')
  const [activities, setActivities] = useState<IntentActivity[]>([])
  const [loading, setLoading]       = useState(false)
  const [actFilter, setActFilter]   = useState('')
  const [lastResult, setLastResult] = useState('')

  // Free-form implicit-intent launcher
  const [action, setAction] = useState('android.intent.action.VIEW')
  const [data, setData]     = useState('')

  const loadPackages = async () => {
    if (pkgsLoaded) return
    try {
      const pkgs = await ListPackages('all')
      setPackages(pkgs || [])
      setPkgsLoaded(true)
    } catch {}
  }

  // Populate the picker on open so it isn't empty until the search box is focused.
  useEffect(() => { loadPackages() }, [])

  const loadActivities = async (pkg: string) => {
    if (!pkg.trim()) return
    setSelected(pkg.trim())
    setLoading(true)
    setActivities([])
    setLastResult('')
    try {
      const acts = await ListActivities(pkg.trim())
      setActivities(acts || [])
    } catch (e: any) {
      notify.error(e)
    } finally {
      setLoading(false)
    }
  }

  const launch = async (component: string) => {
    const id = notify.loading(`Launching ${component}...`)
    try {
      const out = await StartActivity(component)
      notify.dismiss(id)
      notify.success(out || 'Started')
      setLastResult(`✓ ${component}\n${out}`)
    } catch (e: any) {
      notify.dismiss(id)
      notify.error(e)
      setLastResult(`✗ ${component}\n${e?.message || e}`)
    }
  }

  const launchIntent = async () => {
    if (!action.trim()) { notify.error('Enter an action'); return }
    const id = notify.loading('Launching intent...')
    try {
      const out = await StartIntentAction(action.trim(), data.trim())
      notify.dismiss(id)
      notify.success(out || 'Started')
      setLastResult(`✓ ${action}${data ? ' ' + data : ''}\n${out}`)
    } catch (e: any) {
      notify.dismiss(id)
      notify.error(e)
      setLastResult(`✗ ${action}\n${e?.message || e}`)
    }
  }

  const filteredPkgs = packages.filter(p => p.packageName.toLowerCase().includes(search.toLowerCase()))
  const filteredActs = activities.filter(a =>
    a.name.toLowerCase().includes(actFilter.toLowerCase()) ||
    a.component.toLowerCase().includes(actFilter.toLowerCase())
  )

  return (
    <div className="flex h-full overflow-hidden">
      {/* Left: package picker */}
      <div className="w-72 shrink-0 border-r border-bg-border flex flex-col overflow-hidden">
        <div className="p-3 border-b border-bg-border space-y-2 shrink-0">
          <p className="section-title">Intent Lab</p>
          <div className="relative">
            <Search size={12} className="absolute left-2.5 top-1/2 -translate-y-1/2 text-text-muted" />
            <input
              className="input pl-7 text-xs w-full"
              placeholder="Package name..."
              value={search}
              onChange={e => setSearch(e.target.value)}
              onFocus={loadPackages}
              onKeyDown={e => e.key === 'Enter' && loadActivities(search)}
            />
          </div>
          <button onClick={() => loadActivities(search)} disabled={!search || loading} className="btn-primary text-xs w-full justify-center">
            {loading ? 'Loading...' : 'List activities'}
          </button>
        </div>
        <div className="flex-1 overflow-auto">
          {filteredPkgs.map(p => (
            <button
              key={p.packageName}
              onClick={() => { setSearch(p.packageName); loadActivities(p.packageName) }}
              className={`w-full text-left px-3 py-2 text-xs hover:bg-bg-raised transition-colors border-b border-bg-border/30 ${
                selected === p.packageName ? 'bg-accent-green/5 text-text-primary' : 'text-text-secondary'
              }`}
            >
              <p className="truncate mono">{p.packageName}</p>
            </button>
          ))}
          {!pkgsLoaded && (
            <p className="text-text-muted text-xs text-center p-4">Focus the box to load the package list</p>
          )}
        </div>
      </div>

      {/* Right: launcher */}
      <div className="flex-1 flex flex-col overflow-hidden">
        {!selected && !loading && (
          <div className="flex flex-col items-center justify-center h-full gap-3 text-text-muted">
            <Rocket size={32} className="opacity-20" />
            <p className="text-sm">Pick an app to see its launchable activities</p>
          </div>
        )}

        {(selected || loading) && (
          <>
            {/* Free-form implicit-intent launcher */}
            <div className="border-b border-bg-border p-3 shrink-0 space-y-2 bg-bg-surface">
              <p className="section-title flex items-center gap-1.5"><Terminal size={12} /> Implicit intent (action + data)</p>
              <div className="flex gap-2">
                <input
                  className="input text-xs flex-1"
                  placeholder="action, e.g. android.intent.action.VIEW"
                  value={action}
                  onChange={e => setAction(e.target.value)}
                />
                <input
                  className="input text-xs flex-1"
                  placeholder="data URI (optional), e.g. https://example.com"
                  value={data}
                  onChange={e => setData(e.target.value)}
                  onKeyDown={e => e.key === 'Enter' && launchIntent()}
                />
                <button onClick={launchIntent} className="btn-primary text-xs shrink-0">
                  <Play size={12} /> Fire
                </button>
              </div>
            </div>

            {/* Activities */}
            <div className="border-b border-bg-border px-3 py-2 shrink-0 flex items-center gap-2">
              <Package size={13} className="text-accent-green shrink-0" />
              <span className="mono text-xs text-text-primary truncate">{selected}</span>
              <span className="text-xs text-text-muted">· {activities.length} launchable</span>
              <div className="flex-1" />
              <div className="relative">
                <Search size={11} className="absolute left-2 top-1/2 -translate-y-1/2 text-text-muted" />
                <input
                  className="input pl-6 text-xs w-44 py-1"
                  placeholder="Filter activities..."
                  value={actFilter}
                  onChange={e => setActFilter(e.target.value)}
                />
              </div>
            </div>

            <div className="flex-1 overflow-auto">
              {loading && (
                <div className="flex items-center justify-center h-32">
                  <div className="w-5 h-5 border-2 border-accent-green border-t-transparent rounded-full animate-spin" />
                </div>
              )}
              {!loading && filteredActs.length === 0 && (
                <p className="text-text-muted text-xs text-center p-6">
                  No launchable activities{activities.length > 0 ? ' match the filter' : ' — this app exports none, or requires root to reach its internal screens'}.
                </p>
              )}
              {!loading && filteredActs.map(act => (
                <div
                  key={act.component}
                  className="flex items-center gap-3 px-3 py-2 border-b border-bg-border/30 hover:bg-bg-raised transition-colors group"
                >
                  <div className="flex-1 min-w-0">
                    <p className="mono text-xs text-text-primary truncate">{act.name}</p>
                    <p className="mono text-[10px] text-text-muted truncate">{act.component}</p>
                  </div>
                  {act.exported && <span className="badge-green text-xs shrink-0">exported</span>}
                  <button
                    onClick={() => launch(act.component)}
                    className="btn-ghost text-xs shrink-0 opacity-60 group-hover:opacity-100"
                  >
                    <Play size={12} /> Launch
                  </button>
                </div>
              ))}
            </div>

            {/* Last result */}
            {lastResult && (
              <div className="border-t border-bg-border px-3 py-2 shrink-0 bg-bg-surface">
                <pre className="mono text-[11px] whitespace-pre-wrap text-text-secondary max-h-24 overflow-auto">{lastResult}</pre>
              </div>
            )}
          </>
        )}
      </div>
    </div>
  )
}
