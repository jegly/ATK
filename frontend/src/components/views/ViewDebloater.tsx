import { useState, useEffect, useMemo } from 'react'
import { Shield, RefreshCw, Search, Trash2, PowerOff, AlertTriangle, Check, X, ChevronDown, ChevronRight } from 'lucide-react'
import { ListPackages, DisableMultiplePackages, UninstallMultiplePackages } from '../../lib/wails'
import { notify } from '../../lib/notify'
import { DEBLOAT_CATEGORIES } from '../../lib/debloat_db'
import type { Safety } from '../../lib/debloat_db'
import type { PackageInfo } from '../../lib/types'

const SAFETY_CONFIG: Record<Safety, { label: string; cls: string; icon: React.ReactNode }> = {
  safe:    { label: 'Safe',    cls: 'badge-green',  icon: <Check size={10} /> },
  caution: { label: 'Caution', cls: 'badge-yellow', icon: <AlertTriangle size={10} /> },
  keep:    { label: 'Keep',    cls: 'badge-red',    icon: <X size={10} /> },
}

export default function ViewDebloater() {
  const [installed, setInstalled]   = useState<Set<string>>(new Set())
  const [loading, setLoading]       = useState(false)
  const [selected, setSelected]     = useState<Set<string>>(new Set())
  const [search, setSearch]         = useState('')
  const [safetyFilter, setSafety]   = useState<Safety | 'all'>('all')
  const [mfrFilter, setMfrFilter]   = useState('all')
  const [openCats, setOpenCats]     = useState<Set<string>>(new Set())
  const [operating, setOperating]   = useState(false)
  const [showNotInstalled, setShowNotInstalled] = useState(false)

  const loadInstalled = async () => {
    setLoading(true)
    setInstalled(new Set())
    setSelected(new Set())
    try {
      const pkgs = await ListPackages('all')
      const names = new Set<string>((pkgs || []).map((p: PackageInfo) => p.packageName))
      setInstalled(names)
      // Auto-open categories that have installed packages
      const withInstalled = new Set<string>()
      DEBLOAT_CATEGORIES.forEach(cat => {
        if (cat.packages.some(p => names.has(p.pkg))) withInstalled.add(cat.name)
      })
      setOpenCats(withInstalled)
    } catch (e: any) {
      notify.error(e)
    } finally {
      setLoading(false)
    }
  }

  useEffect(() => { loadInstalled() }, [])

  const manufacturers = useMemo(() => ['all', ...DEBLOAT_CATEGORIES.map(c => c.name)], [])

  const visibleCategories = useMemo(() => {
    return DEBLOAT_CATEGORIES
      .filter(cat => mfrFilter === 'all' || cat.name === mfrFilter)
      .map(cat => ({
        ...cat,
        packages: cat.packages.filter(p => {
          if (safetyFilter !== 'all' && p.safety !== safetyFilter) return false
          if (!showNotInstalled && !installed.has(p.pkg)) return false
          if (search) {
            const q = search.toLowerCase()
            return p.pkg.toLowerCase().includes(q) || p.label.toLowerCase().includes(q) || p.description.toLowerCase().includes(q)
          }
          return true
        })
      }))
      .filter(cat => cat.packages.length > 0)
  }, [search, safetyFilter, mfrFilter, installed, showNotInstalled])

  const totalInstalled = useMemo(() =>
    DEBLOAT_CATEGORIES.reduce((n, cat) => n + cat.packages.filter(p => installed.has(p.pkg)).length, 0),
    [installed]
  )

  const toggleCat = (name: string) => setOpenCats(prev => {
    const next = new Set(prev)
    next.has(name) ? next.delete(name) : next.add(name)
    return next
  })

  const toggleSelect = (pkg: string) => setSelected(prev => {
    const next = new Set(prev)
    next.has(pkg) ? next.delete(pkg) : next.add(pkg)
    return next
  })

  const selectAllVisible = () => {
    const selectable = visibleCategories
      .flatMap(c => c.packages)
      .filter(p => installed.has(p.pkg) && p.safety !== 'keep')
      .map(p => p.pkg)
    if (selected.size === selectable.length) {
      setSelected(new Set())
    } else {
      setSelected(new Set(selectable))
    }
  }

  const batchOp = async (label: string, op: (pkgs: string[]) => Promise<string>, confirm_msg: string) => {
    if (selected.size === 0) { notify.error('Select packages first'); return }
    if (!confirm(confirm_msg)) return
    setOperating(true)
    const id = notify.loading(`${label} ${selected.size} package(s)...`)
    try {
      const out = await op([...selected])
      notify.dismiss(id)
      notify.success(out)
      setSelected(new Set())
      loadInstalled()
    } catch (e: any) {
      notify.dismiss(id)
      notify.error(e)
    } finally {
      setOperating(false)
    }
  }

  return (
    <div className="flex flex-col h-full">
      {/* Toolbar */}
      <div className="border-b border-bg-border px-4 py-2 flex items-center gap-2 flex-wrap shrink-0 bg-bg-surface">
        <Shield size={14} className="text-accent-green shrink-0" />
        <span className="text-xs text-text-secondary">
          {loading ? 'Scanning device...' : `${totalInstalled} of ${DEBLOAT_CATEGORIES.reduce((n,c)=>n+c.packages.length,0)} packages found on device`}
        </span>
        <div className="flex-1" />

        {/* Manufacturer filter */}
        <select
          className="input text-xs w-36 py-1"
          value={mfrFilter}
          onChange={e => setMfrFilter(e.target.value)}
        >
          {manufacturers.map(m => (
            <option key={m} value={m}>{m === 'all' ? 'All manufacturers' : m}</option>
          ))}
        </select>

        {/* Safety filter */}
        <div className="flex gap-0.5 bg-bg-raised rounded p-0.5">
          {(['all', 'safe', 'caution', 'keep'] as const).map(f => (
            <button
              key={f}
              onClick={() => setSafety(f)}
              className={`px-2 py-0.5 rounded text-xs font-medium transition-colors ${
                safetyFilter === f ? 'bg-accent-green/20 text-accent-green' : 'text-text-muted hover:text-text-secondary'
              }`}
            >
              {f.charAt(0).toUpperCase() + f.slice(1)}
            </button>
          ))}
        </div>

        <label className="flex items-center gap-1.5 text-xs text-text-muted cursor-pointer">
          <input
            type="checkbox"
            checked={showNotInstalled}
            onChange={e => setShowNotInstalled(e.target.checked)}
            className="accent-accent-green"
          />
          Show not installed
        </label>

        <div className="relative">
          <Search size={12} className="absolute left-2.5 top-1/2 -translate-y-1/2 text-text-muted" />
          <input
            className="input pl-7 text-xs w-44"
            placeholder="Search packages..."
            value={search}
            onChange={e => setSearch(e.target.value)}
          />
        </div>

        <button onClick={loadInstalled} disabled={loading} className="btn-ghost text-xs">
          <RefreshCw size={12} className={loading ? 'animate-spin' : ''} />
          Scan
        </button>
      </div>

      {/* Warning */}
      <div className="flex items-start gap-2 bg-warn/5 border-b border-warn/20 px-4 py-2 shrink-0">
        <AlertTriangle size={13} className="text-warn shrink-0 mt-0.5" />
        <p className="text-xs text-warn/80">
          <span className="font-medium">Always prefer Disable over Uninstall.</span> Never remove packages marked <span className="text-danger font-medium">Keep</span> — they will break your device. Source: Universal Android Debloater (UAD-ng), 2157 packages.
        </p>
      </div>

      {/* Action bar */}
      {selected.size > 0 && (
        <div className="flex items-center gap-2 px-4 py-2 bg-accent-green/5 border-b border-accent-green/20 shrink-0">
          <span className="text-xs text-accent-green font-medium">{selected.size} selected</span>
          <div className="flex-1" />
          <button
            onClick={() => batchOp('Disabling', DisableMultiplePackages,
              `Disable ${selected.size} package(s)?\n\nThis is reversible — you can re-enable later.`)}
            disabled={operating}
            className="btn-warn text-xs"
          >
            <PowerOff size={12} /> Disable ({selected.size})
          </button>
          <button
            onClick={() => batchOp('Uninstalling', UninstallMultiplePackages,
              `Uninstall ${selected.size} package(s) for current user?\n\nUses pm uninstall -k --user 0. Package stays on system but is removed for your user.\nReversible via re-enable or factory reset.`)}
            disabled={operating}
            className="btn-danger text-xs"
          >
            <Trash2 size={12} /> Uninstall for user ({selected.size})
          </button>
          <button onClick={() => setSelected(new Set())} className="btn-ghost text-xs">
            Clear
          </button>
        </div>
      )}

      {/* Package list */}
      <div className="flex-1 overflow-auto">
        {loading && (
          <div className="flex items-center justify-center h-32">
            <div className="w-5 h-5 border-2 border-accent-green border-t-transparent rounded-full animate-spin" />
          </div>
        )}
        {!loading && visibleCategories.length === 0 && (
          <div className="flex flex-col items-center justify-center h-32 gap-2 text-text-muted">
            <Shield size={24} className="opacity-30" />
            <p className="text-sm">No packages match current filters</p>
            {!showNotInstalled && totalInstalled === 0 && (
              <p className="text-xs">Try clicking "Scan" to detect installed packages</p>
            )}
          </div>
        )}

        {!loading && visibleCategories.map(cat => {
          const installedCount = cat.packages.filter(p => installed.has(p.pkg)).length
          const isOpen = openCats.has(cat.name)

          return (
            <div key={cat.name} className="border-b border-bg-border/50">
              {/* Category header */}
              <button
                onClick={() => toggleCat(cat.name)}
                className="w-full flex items-center gap-3 px-4 py-2.5 hover:bg-bg-raised transition-colors text-left"
              >
                {isOpen
                  ? <ChevronDown size={13} className="text-accent-green shrink-0" />
                  : <ChevronRight size={13} className="text-text-muted shrink-0" />
                }
                <span className="text-xs font-medium text-text-primary">{cat.name}</span>
                <span className="text-xs text-text-muted">
                  {installedCount} on device / {cat.packages.length} shown
                </span>
                <div className="flex-1" />
                {installedCount > 0 && (
                  <span className="badge-green">{installedCount} installed</span>
                )}
              </button>

              {/* Packages */}
              {isOpen && cat.packages.map(p => {
                const isInst    = installed.has(p.pkg)
                const isSel     = selected.has(p.pkg)
                const safety    = SAFETY_CONFIG[p.safety]

                return (
                  <div
                    key={p.pkg}
                    className={`
                      flex items-start gap-3 px-4 py-2 border-t border-bg-border/30 transition-colors
                      ${isInst ? 'hover:bg-bg-raised cursor-pointer' : 'opacity-40'}
                      ${isSel ? 'bg-accent-green/5' : ''}
                    `}
                    onClick={() => isInst && p.safety !== 'keep' && toggleSelect(p.pkg)}
                  >
                    <input
                      type="checkbox"
                      checked={isSel}
                      disabled={!isInst || p.safety === 'keep'}
                      onChange={() => toggleSelect(p.pkg)}
                      className="accent-accent-green mt-0.5 shrink-0"
                      onClick={e => e.stopPropagation()}
                    />
                    <div className="flex-1 min-w-0">
                      <div className="flex items-center gap-2 flex-wrap">
                        <span className="text-xs font-medium text-text-primary">{p.label}</span>
                        <span className={`${safety.cls} flex items-center gap-1 text-xs`}>
                          {safety.icon} {safety.label}
                        </span>
                        {!isInst && <span className="badge-gray text-xs">not on device</span>}
                        {p.deps && p.deps.length > 0 && (
                          <span className="badge-gray text-xs" title={`Depends on: ${p.deps.join(', ')}`}>has deps</span>
                        )}
                        {p.neededBy && p.neededBy.length > 0 && (
                          <span className="badge-yellow text-xs" title={`Needed by: ${p.neededBy.join(', ')}`}>needed by others</span>
                        )}
                      </div>
                      <p className="mono text-xs text-text-muted mt-0.5">{p.pkg}</p>
                      <p className="text-xs text-text-muted mt-0.5 leading-relaxed">{p.description}</p>
                    </div>
                  </div>
                )
              })}
            </div>
          )
        })}
      </div>

      {/* Status bar */}
      <div className="border-t border-bg-border px-4 py-1.5 flex items-center justify-between text-xs text-text-muted shrink-0">
        <span>{totalInstalled} debloat candidates on device · {DEBLOAT_CATEGORIES.reduce((n,c)=>n+c.packages.length,0)} total in database</span>
        <button onClick={selectAllVisible} className="hover:text-text-secondary transition-colors">
          {selected.size > 0 ? 'Deselect all' : 'Select all safe+caution'}
        </button>
      </div>
    </div>
  )
}
