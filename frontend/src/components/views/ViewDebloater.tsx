import { useState, useEffect, useMemo } from 'react'
import { Shield, RefreshCw, Search, Trash2, PowerOff, Zap, RotateCcw, AlertTriangle, Check, X, HelpCircle, ChevronDown, ChevronRight } from 'lucide-react'
import { ListPackages, DisableMultiplePackages, UninstallMultiplePackages, UninstallAndDisableMultiplePackages, RestoreMultiplePackages } from '../../lib/wails'
import { ensureDangerUnlocked } from '../../lib/applock'
import { notify } from '../../lib/notify'
import DismissibleBanner from '../DismissibleBanner'
import { DEBLOAT_CATEGORIES } from '../../lib/debloat_db'
import type { Safety } from '../../lib/debloat_db'
import type { PackageInfo } from '../../lib/types'

// Display safety includes 'unknown' for device packages not in the UAD database.
type RowSafety = Safety | 'unknown'

const UNCATEGORIZED = 'Uncategorized'

const SAFETY_CONFIG: Record<RowSafety, { label: string; cls: string; icon: React.ReactNode }> = {
  safe:    { label: 'Safe',    cls: 'badge-green',  icon: <Check size={10} /> },
  caution: { label: 'Caution', cls: 'badge-yellow', icon: <AlertTriangle size={10} /> },
  keep:    { label: 'Keep',    cls: 'badge-red',    icon: <X size={10} /> },
  unknown: { label: 'Unknown', cls: 'badge-gray',   icon: <HelpCircle size={10} /> },
}

// A single package row shown in the list. Device packages are enriched from the
// UAD database where a match exists; unmatched device packages fall into
// 'Uncategorized' with 'unknown' safety.
interface Row {
  pkg: string
  label: string
  description: string
  safety: RowSafety
  category: string
  deps?: string[]
  neededBy?: string[]
  isInstalled: boolean
  isDisabled: boolean
}

// Order categories appear in: the UAD categories in their defined order, then
// the catch-all Uncategorized group last.
const CATEGORY_ORDER = [...DEBLOAT_CATEGORIES.map(c => c.name), UNCATEGORIZED]

// Derive a readable label from a bare package name for uncategorized packages,
// e.g. "com.sec.android.app.launcher" -> "Launcher".
function shortLabel(pkg: string): string {
  const seg = pkg.split('.').filter(Boolean).pop() || pkg
  return seg.charAt(0).toUpperCase() + seg.slice(1)
}

export default function ViewDebloater() {
  const [installed, setInstalled]   = useState<Set<string>>(new Set())
  const [disabled, setDisabled]     = useState<Set<string>>(new Set())
  const [loading, setLoading]       = useState(false)
  const [selected, setSelected]     = useState<Set<string>>(new Set())
  const [search, setSearch]         = useState('')
  const [safetyFilter, setSafety]   = useState<RowSafety | 'all'>('all')
  const [mfrFilter, setMfrFilter]   = useState('all')
  const [openCats, setOpenCats]     = useState<Set<string>>(new Set())
  const [operating, setOperating]   = useState(false)
  const [stateFilter, setStateFilter] = useState<'installed' | 'enabled' | 'disabled' | 'notinstalled' | 'all'>('installed')

  // pkg -> UAD database entry (with its category). Built once; first match wins.
  const dbIndex = useMemo(() => {
    const m = new Map<string, Row>()
    for (const cat of DEBLOAT_CATEGORIES) {
      for (const p of cat.packages) {
        if (!m.has(p.pkg)) {
          m.set(p.pkg, {
            pkg: p.pkg, label: p.label, description: p.description, safety: p.safety,
            category: cat.name, deps: p.deps, neededBy: p.neededBy,
            isInstalled: false, isDisabled: false,
          })
        }
      }
    }
    return m
  }, [])

  const loadInstalled = async () => {
    setLoading(true)
    setInstalled(new Set())
    setDisabled(new Set())
    setSelected(new Set())
    try {
      const pkgs = await ListPackages('all')
      const names = new Set<string>((pkgs || []).map((p: PackageInfo) => p.packageName))
      setInstalled(names)
      setDisabled(new Set<string>((pkgs || []).filter((p: PackageInfo) => !p.isEnabled).map((p: PackageInfo) => p.packageName)))
      // Auto-open every category that has at least one package on the device.
      const withInstalled = new Set<string>()
      names.forEach(name => withInstalled.add(dbIndex.get(name)?.category ?? UNCATEGORIZED))
      setOpenCats(withInstalled)
    } catch (e: any) {
      notify.error(e)
    } finally {
      setLoading(false)
    }
  }

  useEffect(() => { loadInstalled() }, [])

  const manufacturers = useMemo(() => ['all', ...CATEGORY_ORDER], [])

  // The unified row set: every device package (enriched or uncategorized), plus
  // database-only packages so the "Not installed" / "All" filters can browse the
  // full UAD catalogue.
  const allRows = useMemo(() => {
    const rows: Row[] = []
    installed.forEach(name => {
      const e = dbIndex.get(name)
      if (e) {
        rows.push({ ...e, isInstalled: true, isDisabled: disabled.has(name) })
      } else {
        rows.push({
          pkg: name, label: shortLabel(name),
          description: 'Not in the debloat database — likely an OEM, carrier, or region-specific package. Safety unknown; research before removing.',
          safety: 'unknown', category: UNCATEGORIZED,
          isInstalled: true, isDisabled: disabled.has(name),
        })
      }
    })
    dbIndex.forEach((e, pkg) => {
      if (!installed.has(pkg)) rows.push({ ...e, isInstalled: false, isDisabled: false })
    })
    return rows
  }, [installed, disabled, dbIndex])

  const visibleCategories = useMemo(() => {
    const q = search.toLowerCase()
    const byCat = new Map<string, Row[]>()
    for (const r of allRows) {
      if (mfrFilter !== 'all' && r.category !== mfrFilter) continue
      if (safetyFilter !== 'all' && r.safety !== safetyFilter) continue
      switch (stateFilter) {
        case 'installed':    if (!r.isInstalled) continue; break
        case 'enabled':      if (!r.isInstalled || r.isDisabled) continue; break
        case 'disabled':     if (!r.isDisabled) continue; break
        case 'notinstalled': if (r.isInstalled) continue; break
        // 'all' → no state restriction
      }
      if (q && !(r.pkg.toLowerCase().includes(q) || r.label.toLowerCase().includes(q) || r.description.toLowerCase().includes(q))) continue
      if (!byCat.has(r.category)) byCat.set(r.category, [])
      byCat.get(r.category)!.push(r)
    }
    return CATEGORY_ORDER
      .filter(name => byCat.has(name))
      .map(name => ({ name, packages: byCat.get(name)!.sort((a, b) => a.pkg.localeCompare(b.pkg)) }))
  }, [allRows, search, safetyFilter, mfrFilter, stateFilter])

  // Device counts — mirror the Packages tab (deviceCount) and explain the gap.
  const deviceCount = installed.size
  const cataloguedCount = useMemo(() => {
    let n = 0
    installed.forEach(name => { if (dbIndex.has(name)) n++ })
    return n
  }, [installed, dbIndex])
  const uncategorizedCount = deviceCount - cataloguedCount

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
    const selectable = visibleCategories.flatMap(c => c.packages).map(p => p.pkg)
    if (selected.size > 0 && selected.size >= selectable.length) {
      setSelected(new Set())
    } else {
      setSelected(new Set(selectable))
    }
  }

  const batchOp = async (label: string, op: (pkgs: string[]) => Promise<string>, confirm_msg: string) => {
    if (selected.size === 0) { notify.error('Select packages first'); return }
    if (!confirm(confirm_msg)) return
    if (!(await ensureDangerUnlocked())) return
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
          {loading
            ? 'Scanning device...'
            : `${deviceCount} on device · ${cataloguedCount} catalogued · ${uncategorizedCount} uncategorized`}
        </span>
        <div className="flex-1" />

        {/* Manufacturer / category filter */}
        <select
          className="input text-xs w-36 py-1"
          value={mfrFilter}
          onChange={e => setMfrFilter(e.target.value)}
        >
          {manufacturers.map(m => (
            <option key={m} value={m}>{m === 'all' ? 'All categories' : m}</option>
          ))}
        </select>

        {/* Safety filter */}
        <div className="flex gap-0.5 bg-bg-raised rounded p-0.5">
          {(['all', 'safe', 'caution', 'keep', 'unknown'] as const).map(f => (
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

        <select
          className="input text-xs"
          value={stateFilter}
          onChange={e => setStateFilter(e.target.value as typeof stateFilter)}
          title="Filter by device state"
        >
          <option value="installed">On device</option>
          <option value="enabled">Enabled</option>
          <option value="disabled">Disabled</option>
          <option value="notinstalled">Not installed</option>
          <option value="all">All</option>
        </select>

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
      <DismissibleBanner id="warn-debloater" className="bg-warn/5 border-b border-warn/20 px-4 py-2 shrink-0 text-warn">
        <AlertTriangle size={13} className="text-warn shrink-0 mt-0.5" />
        <p className="text-xs text-warn/80">
          <span className="font-medium">Always prefer Disable over Uninstall.</span> Packages marked <span className="text-danger font-medium">Keep</span> are device-critical — removing them can break your device. <span className="font-medium">Uncategorized</span> packages aren't in the debloat database; research before removing. Safety data: Universal Android Debloater (UAD-ng).
        </p>
      </DismissibleBanner>

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
              `Uninstall ${selected.size} package(s) for current user?\n\nUses pm uninstall --user 0 (protected system apps fall back to a privileged on-device helper).\nReversible via re-enable or factory reset.`)}
            disabled={operating}
            className="btn-danger text-xs"
          >
            <Trash2 size={12} /> Uninstall for user ({selected.size})
          </button>
          <button
            onClick={() => batchOp('Disabling + uninstalling', UninstallAndDisableMultiplePackages,
              `Disable AND uninstall ${selected.size} package(s)?\n\nForce-stops + disables each app (pm disable-user --user 0), then uninstalls it (privileged fallback for protected system apps).\nIf an app can't be removed it is left disabled.\nReversible via re-enable or factory reset.`)}
            disabled={operating}
            className="btn-danger text-xs"
          >
            <Zap size={12} /> Disable + Uninstall ({selected.size})
          </button>
          <button
            onClick={() => batchOp('Restoring', RestoreMultiplePackages,
              `Restore ${selected.size} package(s)?\n\nReinstalls for your user (cmd package install-existing --user 0) and re-enables (pm enable --user 0).\nBrings back apps that were disabled or uninstalled-for-user.`)}
            disabled={operating}
            className="btn-ghost text-xs text-accent-green"
          >
            <RotateCcw size={12} /> Restore ({selected.size})
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
            {stateFilter !== 'notinstalled' && deviceCount === 0 && (
              <p className="text-xs">Try clicking "Scan" to detect installed packages</p>
            )}
          </div>
        )}

        {!loading && visibleCategories.map(cat => {
          const installedCount = cat.packages.filter(p => p.isInstalled).length
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
                const isInst    = p.isInstalled
                const isDisabled = p.isDisabled
                const isSel     = selected.has(p.pkg)
                const safety    = SAFETY_CONFIG[p.safety]

                return (
                  <div
                    key={p.pkg}
                    className={`
                      flex items-start gap-3 px-4 py-2 border-t border-bg-border/30 transition-colors
                      hover:bg-bg-raised cursor-pointer
                      ${!isInst ? 'opacity-60' : ''}
                      ${isSel ? 'bg-accent-green/5' : ''}
                    `}
                    onClick={() => toggleSelect(p.pkg)}
                  >
                    <input
                      type="checkbox"
                      checked={isSel}
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
                        {isInst && isDisabled && <span className="badge-yellow text-xs">disabled</span>}
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
        <span>{deviceCount} on device · {cataloguedCount} catalogued · {uncategorizedCount} uncategorized · {DEBLOAT_CATEGORIES.reduce((n,c)=>n+c.packages.length,0)} in database</span>
        <button onClick={selectAllVisible} className="hover:text-text-secondary transition-colors">
          {selected.size > 0 ? 'Deselect all' : 'Select all visible'}
        </button>
      </div>
    </div>
  )
}
