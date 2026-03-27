import { useState } from 'react'
import { Search, Package, Shield, Activity, Server, Database, Cpu, FileCode, AlertTriangle } from 'lucide-react'
import { InspectApp, CheckPinning, ListPackages } from '../../lib/wails'
import { notify } from '../../lib/notify'
import type { AppInspection, PackageInfo } from '../../lib/types'

export default function ViewAppInspect() {
  const [search, setSearch]         = useState('')
  const [packages, setPackages]     = useState<PackageInfo[]>([])
  const [pkgsLoaded, setPkgsLoaded] = useState(false)
  const [loading, setLoading]       = useState(false)
  const [result, setResult]         = useState<AppInspection | null>(null)
  const [pinning, setPinning]       = useState('')
  const [activeTab, setActiveTab]   = useState('overview')
  const [showManifest, setShowManifest] = useState(false)

  const loadPackages = async () => {
    if (pkgsLoaded) return
    try {
      const pkgs = await ListPackages('all')
      setPackages(pkgs || [])
      setPkgsLoaded(true)
    } catch {}
  }

  const inspect = async (pkg: string) => {
    if (!pkg.trim()) return
    setLoading(true)
    setResult(null)
    setPinning('')
    setActiveTab('overview')
    try {
      const data = await InspectApp(pkg.trim())
      setResult(data)
    } catch (e: any) {
      notify.error(e)
    } finally {
      setLoading(false)
    }
  }

  const checkPinning = async () => {
    if (!result) return
    try {
      const out = await CheckPinning(result.packageName)
      setPinning(out)
    } catch (e: any) {
      notify.error(e)
    }
  }

  const filtered = packages.filter(p =>
    p.packageName.toLowerCase().includes(search.toLowerCase())
  ).slice(0, 20)

  const tabs = [
    { id: 'overview',     label: 'Overview',     icon: <Package size={12} /> },
    { id: 'permissions',  label: `Permissions (${result?.permissions?.length || 0})`, icon: <Shield size={12} /> },
    { id: 'components',   label: 'Components',   icon: <Activity size={12} /> },
    { id: 'libs',         label: 'Native Libs',  icon: <Cpu size={12} /> },
    { id: 'cert',         label: 'Signing Cert', icon: <FileCode size={12} /> },
    { id: 'manifest',     label: 'Full Dump',    icon: <Database size={12} /> },
  ]

  return (
    <div className="flex h-full overflow-hidden">
      {/* Left: package picker */}
      <div className="w-64 shrink-0 border-r border-bg-border flex flex-col overflow-hidden">
        <div className="p-3 border-b border-bg-border space-y-2 shrink-0">
          <p className="section-title">App Inspector</p>
          <div className="relative">
            <Search size={12} className="absolute left-2.5 top-1/2 -translate-y-1/2 text-text-muted" />
            <input
              className="input pl-7 text-xs w-full"
              placeholder="Package name..."
              value={search}
              onChange={e => setSearch(e.target.value)}
              onFocus={loadPackages}
              onKeyDown={e => e.key === 'Enter' && inspect(search)}
            />
          </div>
          <button onClick={() => inspect(search)} disabled={!search || loading} className="btn-primary text-xs w-full justify-center">
            {loading ? 'Inspecting...' : 'Inspect'}
          </button>
        </div>

        <div className="flex-1 overflow-auto">
          {filtered.map(p => (
            <button
              key={p.packageName}
              onClick={() => { setSearch(p.packageName); inspect(p.packageName) }}
              className="w-full text-left px-3 py-2 text-xs text-text-secondary hover:bg-bg-raised hover:text-text-primary transition-colors border-b border-bg-border/30"
            >
              <p className="truncate mono">{p.packageName}</p>
              <p className={p.isEnabled ? 'text-accent-green' : 'text-danger'}>{p.isEnabled ? 'enabled' : 'disabled'}</p>
            </button>
          ))}
          {!pkgsLoaded && (
            <p className="text-text-muted text-xs text-center p-4">Type to search or focus to load package list</p>
          )}
        </div>
      </div>

      {/* Right: inspection results */}
      <div className="flex-1 flex flex-col overflow-hidden">
        {!result && !loading && (
          <div className="flex flex-col items-center justify-center h-full gap-3 text-text-muted">
            <Package size={32} className="opacity-20" />
            <p className="text-sm">Select a package to inspect</p>
          </div>
        )}

        {loading && (
          <div className="flex items-center justify-center h-full">
            <div className="w-6 h-6 border-2 border-accent-green border-t-transparent rounded-full animate-spin" />
          </div>
        )}

        {result && (
          <>
            {/* Package header */}
            <div className="border-b border-bg-border px-4 py-3 flex items-start justify-between shrink-0">
              <div>
                <p className="mono text-sm text-text-primary">{result.packageName}</p>
                <p className="text-xs text-text-muted mt-0.5">
                  v{result.versionName} (code {result.versionCode}) · SDK {result.minSdk}–{result.targetSdk}
                </p>
                <div className="flex gap-2 mt-1.5 flex-wrap">
                  {result.isSystem && <span className="badge-gray">system</span>}
                  {result.isDebuggable && <span className="badge-yellow">debuggable</span>}
                  {result.isEnabled
                    ? <span className="badge-green">enabled</span>
                    : <span className="badge-red">disabled</span>
                  }
                  <span className="badge-gray">UID {result.uid}</span>
                </div>
              </div>
              <button onClick={checkPinning} className="btn-ghost text-xs shrink-0">
                <AlertTriangle size={12} /> Check Pinning
              </button>
            </div>

            {/* Pinning result */}
            {pinning && (
              <div className="border-b border-warn/20 bg-warn/5 px-4 py-2 text-xs shrink-0">
                <pre className="whitespace-pre-wrap text-warn/90">{pinning}</pre>
              </div>
            )}

            {/* Tabs */}
            <div className="border-b border-bg-border flex shrink-0 overflow-x-auto">
              {tabs.map(tab => (
                <button
                  key={tab.id}
                  onClick={() => setActiveTab(tab.id)}
                  className={`flex items-center gap-1.5 px-3 py-2 text-xs whitespace-nowrap border-b-2 transition-colors ${
                    activeTab === tab.id
                      ? 'border-accent-green text-accent-green'
                      : 'border-transparent text-text-muted hover:text-text-secondary'
                  }`}
                >
                  {tab.icon} {tab.label}
                </button>
              ))}
            </div>

            {/* Tab content */}
            <div className="flex-1 overflow-auto p-4">
              {activeTab === 'overview' && (
                <div className="grid grid-cols-2 gap-x-8 gap-y-2">
                  {[
                    { label: 'Install path',    value: result.installPath },
                    { label: 'Data dir',        value: result.dataDir },
                    { label: 'Installed by',    value: result.installer || 'Unknown' },
                    { label: 'First installed', value: result.firstInstall },
                    { label: 'Last updated',    value: result.lastUpdated },
                    { label: 'UID',             value: result.uid },
                    { label: 'Target SDK',      value: result.targetSdk },
                    { label: 'Min SDK',         value: result.minSdk },
                  ].map(({ label, value }) => (
                    <div key={label} className="flex gap-2 min-w-0">
                      <span className="text-text-muted text-xs w-28 shrink-0">{label}</span>
                      <span className="text-xs text-text-primary mono truncate">{value || 'N/A'}</span>
                    </div>
                  ))}
                </div>
              )}

              {activeTab === 'permissions' && (
                <div className="space-y-1">
                  {result.permissions?.length === 0 && (
                    <p className="text-text-muted text-xs">No permissions detected</p>
                  )}
                  {result.permissions?.map(p => (
                    <div key={p} className="flex items-center gap-2 py-1 border-b border-bg-border/30">
                      <Shield size={11} className="text-warn shrink-0" />
                      <span className="mono text-xs text-text-secondary">{p}</span>
                    </div>
                  ))}
                </div>
              )}

              {activeTab === 'components' && (
                <div className="space-y-4">
                  {[
                    { label: 'Activities',  items: result.activities,  icon: <Activity size={11} /> },
                    { label: 'Services',    items: result.services,    icon: <Server size={11} /> },
                    { label: 'Receivers',   items: result.receivers,   icon: <Activity size={11} /> },
                    { label: 'Providers',   items: result.providers,   icon: <Database size={11} /> },
                  ].map(({ label, items, icon }) => (
                    <div key={label}>
                      <p className="section-title mb-2">{label} ({items?.length || 0})</p>
                      {!items?.length && <p className="text-text-muted text-xs">None detected</p>}
                      {items?.map(item => (
                        <div key={item} className="flex items-center gap-2 py-1 border-b border-bg-border/30">
                          <span className="text-text-muted shrink-0">{icon}</span>
                          <span className="mono text-xs text-text-secondary">{item}</span>
                        </div>
                      ))}
                    </div>
                  ))}
                </div>
              )}

              {activeTab === 'libs' && (
                <div className="space-y-1">
                  {!result.nativeLibs?.length && (
                    <p className="text-text-muted text-xs">No native libraries detected</p>
                  )}
                  {result.nativeLibs?.map(lib => (
                    <div key={lib} className="flex items-center gap-2 py-1 border-b border-bg-border/30">
                      <Cpu size={11} className="text-text-muted shrink-0" />
                      <span className="mono text-xs text-text-secondary">{lib}</span>
                    </div>
                  ))}
                </div>
              )}

              {activeTab === 'cert' && (
                <div className="space-y-3">
                  {[
                    { label: 'Subject',      value: result.certSubject },
                    { label: 'Issuer',       value: result.certIssuer },
                    { label: 'Expires',      value: result.certExpiry },
                    { label: 'SHA-256',      value: result.certSha256 },
                  ].map(({ label, value }) => (
                    <div key={label}>
                      <p className="text-xs text-text-muted mb-0.5">{label}</p>
                      <p className="mono text-xs text-text-primary bg-bg-raised rounded px-3 py-1.5 break-all">
                        {value || 'Not available — run aapt or apksigner manually for cert details'}
                      </p>
                    </div>
                  ))}
                </div>
              )}

              {activeTab === 'manifest' && (
                <div>
                  <button
                    onClick={() => setShowManifest(v => !v)}
                    className="btn-ghost text-xs mb-3"
                  >
                    {showManifest ? 'Hide' : 'Show'} full package dump ({result.manifestDump?.split('\n').length} lines)
                  </button>
                  {showManifest && (
                    <pre className="mono text-xs text-text-secondary whitespace-pre-wrap break-words leading-relaxed bg-bg-raised rounded p-3 border border-bg-border max-h-[60vh] overflow-auto">
                      {result.manifestDump}
                    </pre>
                  )}
                </div>
              )}
            </div>
          </>
        )}
      </div>
    </div>
  )
}
