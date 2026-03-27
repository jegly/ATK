import { useState, useCallback, useMemo } from 'react'
import { Package, RefreshCw, Search, Download, Trash2, Power, PowerOff, X } from 'lucide-react'
import {
  ListPackages, UninstallMultiplePackages, DisableMultiplePackages,
  EnableMultiplePackages, PullApk, ClearData, ForceStopPackage,
  SelectFileForInstall, InstallPackage
} from '../../lib/wails'
import { notify } from '../../lib/notify'
import type { PackageInfo } from '../../lib/types'

type Filter = 'all' | 'user' | 'system'

export default function ViewPackages() {
  const [packages, setPackages] = useState<PackageInfo[]>([])
  const [loading, setLoading] = useState(false)
  const [filter, setFilter] = useState<Filter>('user')
  const [search, setSearch] = useState('')
  const [selected, setSelected] = useState<Set<string>>(new Set())
  const [activeCtx, setActiveCtx] = useState<string | null>(null)

  const load = useCallback(async (f: Filter) => {
    setLoading(true)
    setSelected(new Set())
    setPackages([])
    try {
      const pkgs = await ListPackages(f)
      setPackages(pkgs || [])
    } catch (e: any) {
      notify.error(e)
    } finally {
      setLoading(false)
    }
  }, [])

  const filtered = useMemo(() =>
    packages
      .filter(p => p.packageName.toLowerCase().includes(search.toLowerCase()))
      .sort((a, b) => a.packageName.localeCompare(b.packageName)),
    [packages, search]
  )

  const toggleSelect = (pkg: string) => {
    setSelected(prev => {
      const next = new Set(prev)
      next.has(pkg) ? next.delete(pkg) : next.add(pkg)
      return next
    })
  }

  const selectAll = () => {
    if (selected.size === filtered.length) {
      setSelected(new Set())
    } else {
      setSelected(new Set(filtered.map(p => p.packageName)))
    }
  }

  const batchOp = async (label: string, op: (pkgs: string[]) => Promise<string>) => {
    if (selected.size === 0) { notify.error('Select packages first'); return }
    const id = notify.loading(`${label} ${selected.size} package(s)...`)
    try {
      const out = await op([...selected])
      notify.dismiss(id)
      notify.success(out)
      load(filter)
    } catch (e: any) {
      notify.dismiss(id)
      notify.error(e)
    }
  }

  const handleInstall = async () => {
    const path = await SelectFileForInstall()
    if (!path) return
    const id = notify.loading('Installing APK...')
    try {
      const out = await InstallPackage(path)
      notify.dismiss(id)
      notify.success(out || 'Installed successfully')
      load(filter)
    } catch (e: any) {
      notify.dismiss(id)
      notify.error(e)
    }
  }

  const handlePullApk = async (pkg: string) => {
    const id = notify.loading(`Pulling APK for ${pkg}...`)
    try {
      const out = await PullApk(pkg)
      notify.dismiss(id)
      notify.success(out)
    } catch (e: any) {
      notify.dismiss(id)
      notify.error(e)
    }
    setActiveCtx(null)
  }

  const handleClearData = async (pkg: string) => {
    if (!confirm(`Clear data for ${pkg}?`)) return
    try {
      const out = await ClearData(pkg)
      notify.success(out)
    } catch (e: any) {
      notify.error(e)
    }
    setActiveCtx(null)
  }

  const handleForceStop = async (pkg: string) => {
    try {
      const out = await ForceStopPackage(pkg)
      notify.success(out)
    } catch (e: any) {
      notify.error(e)
    }
    setActiveCtx(null)
  }

  return (
    <div className="flex flex-col h-full">
      {/* Toolbar */}
      <div className="border-b border-bg-border px-4 py-2 flex items-center gap-2 shrink-0 flex-wrap">
        {/* Filter tabs */}
        <div className="flex gap-1 bg-bg-raised rounded p-0.5">
          {(['user', 'system', 'all'] as Filter[]).map(f => (
            <button
              key={f}
              onClick={() => { setFilter(f); load(f) }}
              className={`px-3 py-1 rounded text-xs font-medium transition-colors ${
                filter === f ? 'bg-accent-green/20 text-accent-green' : 'text-text-muted hover:text-text-secondary'
              }`}
            >
              {f.charAt(0).toUpperCase() + f.slice(1)}
            </button>
          ))}
        </div>

        <button onClick={() => load(filter)} disabled={loading} className="btn-ghost text-xs">
          <RefreshCw size={13} className={loading ? 'animate-spin' : ''} />
          {loading ? 'Loading...' : 'Load'}
        </button>

        <div className="relative flex-1 min-w-[180px]">
          <Search size={13} className="absolute left-3 top-1/2 -translate-y-1/2 text-text-muted" />
          <input
            className="input pl-8 text-xs"
            placeholder="Filter packages..."
            value={search}
            onChange={e => setSearch(e.target.value)}
          />
        </div>

        <div className="w-px h-5 bg-bg-border" />

        <button onClick={handleInstall} className="btn-primary text-xs">
          <Package size={13} /> Install APK
        </button>

        {selected.size > 0 && (
          <>
            <button onClick={() => batchOp('Uninstalling', UninstallMultiplePackages)} className="btn-danger text-xs">
              <Trash2 size={13} /> Uninstall ({selected.size})
            </button>
            <button onClick={() => batchOp('Disabling', DisableMultiplePackages)} className="btn-warn text-xs">
              <PowerOff size={13} /> Disable ({selected.size})
            </button>
            <button onClick={() => batchOp('Enabling', EnableMultiplePackages)} className="btn-ghost text-xs">
              <Power size={13} /> Enable ({selected.size})
            </button>
          </>
        )}
      </div>

      {/* Package list header */}
      <div className="grid grid-cols-[24px_1fr_80px_100px] gap-2 px-4 py-1.5 border-b border-bg-border text-text-muted text-xs shrink-0">
        <input
          type="checkbox"
          checked={filtered.length > 0 && selected.size === filtered.length}
          onChange={selectAll}
          className="accent-accent-green"
        />
        <span>Package</span>
        <span>State</span>
        <span>Actions</span>
      </div>

      {/* Package list */}
      <div className="flex-1 overflow-auto relative">
        {loading && (
          <div className="flex items-center justify-center h-32">
            <div className="w-5 h-5 border-2 border-accent-green border-t-transparent rounded-full animate-spin" />
          </div>
        )}
        {!loading && packages.length === 0 && (
          <div className="flex flex-col items-center justify-center h-32 gap-2">
            <Package size={24} className="text-text-muted" />
            <p className="text-text-muted text-sm">Click "Load" to fetch packages</p>
          </div>
        )}
        {filtered.map(pkg => (
          <div
            key={pkg.packageName}
            className={`
              grid grid-cols-[24px_1fr_80px_100px] gap-2 px-4 py-2
              border-b border-bg-border/50 items-center text-xs
              hover:bg-bg-raised transition-colors
              ${selected.has(pkg.packageName) ? 'bg-accent-green/5' : ''}
            `}
          >
            <input
              type="checkbox"
              checked={selected.has(pkg.packageName)}
              onChange={() => toggleSelect(pkg.packageName)}
              className="accent-accent-green"
            />
            <span className="mono text-text-secondary truncate">{pkg.packageName}</span>
            <span>
              <span className={pkg.isEnabled ? 'badge-green' : 'badge-red'}>
                {pkg.isEnabled ? 'enabled' : 'disabled'}
              </span>
            </span>
            <div className="relative">
              <button
                onClick={() => setActiveCtx(activeCtx === pkg.packageName ? null : pkg.packageName)}
                className="btn-ghost text-xs py-0.5 px-2"
              >
                ···
              </button>
              {activeCtx === pkg.packageName && (
                <div className="absolute right-0 top-full mt-1 bg-bg-raised border border-bg-border rounded shadow-xl z-10 min-w-[160px]">
                  <button onClick={() => handlePullApk(pkg.packageName)} className="flex items-center gap-2 w-full px-3 py-2 text-xs text-text-secondary hover:text-text-primary hover:bg-bg-surface">
                    <Download size={12} /> Pull APK
                  </button>
                  <button onClick={() => handleClearData(pkg.packageName)} className="flex items-center gap-2 w-full px-3 py-2 text-xs text-warn hover:bg-bg-surface">
                    <X size={12} /> Clear Data
                  </button>
                  <button onClick={() => handleForceStop(pkg.packageName)} className="flex items-center gap-2 w-full px-3 py-2 text-xs text-danger hover:bg-bg-surface">
                    <PowerOff size={12} /> Force Stop
                  </button>
                </div>
              )}
            </div>
          </div>
        ))}
      </div>

      {/* Status bar */}
      <div className="border-t border-bg-border px-4 py-1.5 flex items-center justify-between text-xs text-text-muted">
        <span>{filtered.length} packages{search ? ` matching "${search}"` : ''}</span>
        {selected.size > 0 && <span>{selected.size} selected</span>}
      </div>
    </div>
  )
}
