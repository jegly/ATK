import { useState, useMemo } from 'react'
import {
  ScanSearch, FileUp, Package, Shield, AlertTriangle, FileCode,
  Lock, FolderTree, Search, ChevronRight, Activity, Radar,
  Download, X,
} from 'lucide-react'
import {
  SelectAPKForAudit, AuditAPK, AuditInstalledApp, ListPackages,
  ReadAPKEntry, ExportAudit,
} from '../../lib/wails'
import { notify } from '../../lib/notify'
import type { APKAudit, APKAuditFinding, APKEntryContent, PackageInfo } from '../../lib/types'

type Tab = 'overview' | 'findings' | 'manifest' | 'components' | 'cert' | 'explorer'
type Severity = 'critical' | 'high' | 'medium' | 'low' | 'info'

const SEV_ORDER: Severity[] = ['critical', 'high', 'medium', 'low', 'info']

function sevText(s: string): string {
  switch (s) {
    case 'critical': return 'text-danger'
    case 'high':     return 'text-danger'
    case 'medium':   return 'text-warn'
    case 'low':      return 'text-text-secondary'
    default:         return 'text-text-muted'
  }
}

function sevBadge(s: string): string {
  switch (s) {
    case 'critical': return 'bg-danger/20 text-danger border border-danger/30'
    case 'high':     return 'bg-danger/10 text-danger border border-danger/20'
    case 'medium':   return 'bg-warn/15 text-warn border border-warn/25'
    case 'low':      return 'bg-bg-raised text-text-secondary border border-bg-border'
    default:         return 'bg-bg-raised text-text-muted border border-bg-border'
  }
}

function scoreColor(score: number): string {
  if (score >= 75) return 'text-accent-green'
  if (score >= 40) return 'text-warn'
  return 'text-danger'
}

function formatBytes(n: number): string {
  if (!n) return '0 B'
  const u = ['B', 'KB', 'MB', 'GB']
  const i = Math.floor(Math.log(n) / Math.log(1024))
  return `${(n / Math.pow(1024, i)).toFixed(i ? 1 : 0)} ${u[i]}`
}

export default function ViewApkAudit() {
  const [result, setResult]       = useState<APKAudit | null>(null)
  const [loading, setLoading]     = useState(false)
  const [tab, setTab]             = useState<Tab>('overview')

  // package picker
  const [search, setSearch]       = useState('')
  const [packages, setPackages]   = useState<PackageInfo[]>([])
  const [pkgsLoaded, setPkgsLoaded] = useState(false)
  const [showPicker, setShowPicker] = useState(false)

  // findings controls
  const [findFilter, setFindFilter] = useState<Severity | 'all'>('all')
  const [findSearch, setFindSearch] = useState('')
  const [openFinding, setOpenFinding] = useState<string | null>(null)

  // explorer
  const [fileSearch, setFileSearch] = useState('')
  const [entry, setEntry]           = useState<APKEntryContent | null>(null)
  const [entryPath, setEntryPath]   = useState('')
  const [entryLoading, setEntryLoading] = useState(false)

  // export
  const [showExport, setShowExport] = useState(false)
  const [exporting, setExporting]   = useState(false)

  const loadPackages = async () => {
    if (pkgsLoaded) return
    try {
      const pkgs = await ListPackages('all')
      setPackages(pkgs || [])
      setPkgsLoaded(true)
    } catch { /* device may be offline; ignore */ }
  }

  const run = async (fn: () => Promise<APKAudit>) => {
    setLoading(true); setResult(null); setTab('overview'); setShowPicker(false)
    setFindFilter('all'); setFindSearch(''); setOpenFinding(null)
    setEntry(null); setEntryPath(''); setFileSearch(''); setShowExport(false)
    try {
      setResult(await fn())
    } catch (e: any) {
      notify.error(e)
    } finally {
      setLoading(false)
    }
  }

  const auditFile = async () => {
    const path = await SelectAPKForAudit()
    if (path) run(() => AuditAPK(path))
  }

  const openEntry = async (path: string) => {
    if (!result) return
    setEntryPath(path); setEntry(null); setEntryLoading(true)
    try {
      setEntry(await ReadAPKEntry(result.localPath, path))
    } catch (e: any) {
      notify.error(e); setEntryPath('')
    } finally {
      setEntryLoading(false)
    }
  }

  const doExport = async (format: 'json' | 'csv' | 'sarif') => {
    if (!result) return
    setShowExport(false); setExporting(true)
    try {
      const path = await ExportAudit(result, format)
      if (path) notify.success(`Exported to ${path}`)
    } catch (e: any) {
      notify.error(e)
    } finally {
      setExporting(false)
    }
  }

  const filteredPkgs = packages
    .filter(p => p.packageName.toLowerCase().includes(search.toLowerCase()))

  const findings = result?.findings ?? []
  const visibleFindings = useMemo(() => findings.filter(f => {
    if (findFilter !== 'all' && f.severity !== findFilter) return false
    if (findSearch) {
      const q = findSearch.toLowerCase()
      return (f.title + f.category + f.cwe + f.masvs).toLowerCase().includes(q)
    }
    return true
  }), [findings, findFilter, findSearch])

  const visibleFiles = useMemo(() => (result?.files ?? []).filter(f =>
    !fileSearch || f.path.toLowerCase().includes(fileSearch.toLowerCase())
  ).slice(0, 2000), [result, fileSearch])

  const dangerousPerms = (result?.permissions ?? []).filter(p => p.dangerous)

  const tabs: { id: Tab; label: string; icon: React.ReactNode }[] = [
    { id: 'overview',   label: 'Overview',   icon: <Package size={12} /> },
    { id: 'findings',   label: `Findings (${findings.length})`, icon: <AlertTriangle size={12} /> },
    { id: 'manifest',   label: 'Manifest',   icon: <FileCode size={12} /> },
    { id: 'components', label: `Components (${result?.components?.length || 0})`, icon: <Activity size={12} /> },
    { id: 'cert',       label: 'Cert',       icon: <Lock size={12} /> },
    { id: 'explorer',   label: `Explorer (${result?.files?.length || 0})`, icon: <FolderTree size={12} /> },
  ]

  return (
    <div className="flex flex-col h-full overflow-hidden">
      {/* Source bar */}
      <div className="border-b border-bg-border px-4 py-3 flex items-center gap-3 shrink-0">
        <div className="flex items-center gap-2">
          <ScanSearch size={16} className="text-accent-green" />
          <span className="section-title">APK Audit</span>
        </div>
        <div className="flex items-center gap-2 ml-2">
          <button onClick={auditFile} disabled={loading} className="btn-primary text-xs">
            <FileUp size={12} /> Browse APK…
          </button>
          <div className="relative">
            <button
              onClick={() => { setShowPicker(v => !v); loadPackages() }}
              disabled={loading}
              className="btn-ghost text-xs"
            >
              <Package size={12} /> Installed app…
            </button>
            {showPicker && (
              <div className="absolute z-20 mt-1 w-72 bg-bg-surface border border-bg-border rounded shadow-lg">
                <div className="p-2 border-b border-bg-border">
                  <div className="relative">
                    <Search size={12} className="absolute left-2.5 top-1/2 -translate-y-1/2 text-text-muted" />
                    <input
                      autoFocus
                      className="input pl-7 text-xs w-full"
                      placeholder="Filter packages…"
                      value={search}
                      onChange={e => setSearch(e.target.value)}
                    />
                  </div>
                </div>
                <div className="max-h-64 overflow-auto">
                  {!pkgsLoaded && <p className="text-text-muted text-xs p-3 text-center">Loading… (device must be connected)</p>}
                  {pkgsLoaded && filteredPkgs.length === 0 && (
                    <p className="text-text-muted text-xs p-3 text-center">No matching packages</p>
                  )}
                  {filteredPkgs.map(p => (
                    <button
                      key={p.packageName}
                      onClick={() => run(() => AuditInstalledApp(p.packageName))}
                      className="w-full text-left px-3 py-1.5 text-xs text-text-secondary hover:bg-bg-raised hover:text-text-primary border-b border-bg-border/30 truncate mono"
                    >
                      {p.packageName}
                    </button>
                  ))}
                </div>
              </div>
            )}
          </div>
        </div>
      </div>

      {/* Empty / loading */}
      {!result && !loading && (
        <div className="flex flex-col items-center justify-center h-full gap-3 text-text-muted">
          <ScanSearch size={36} className="opacity-20" />
          <p className="text-sm">Browse for an APK file or pick an installed app to audit</p>
          <p className="text-xs opacity-70">Static analysis: manifest, signing, permissions, components, secrets & trackers</p>
        </div>
      )}
      {loading && (
        <div className="flex flex-col items-center justify-center h-full gap-3">
          <div className="w-6 h-6 border-2 border-accent-green border-t-transparent rounded-full animate-spin" />
          <p className="text-text-muted text-xs">Auditing… (pulling & parsing DEX, this can take a few seconds)</p>
        </div>
      )}

      {result && (
        <>
          {/* Header */}
          <div className="border-b border-bg-border px-4 py-3 flex items-center gap-4 shrink-0">
            <div className={`text-3xl font-bold ${scoreColor(result.score)}`}>{result.grade}</div>
            <div className="min-w-0">
              <p className="text-sm text-text-primary truncate">
                {result.appLabel || result.fileName} <span className="text-text-muted mono text-xs">({result.packageName})</span>
              </p>
              <p className="text-xs text-text-muted mt-0.5">
                v{result.versionName} (code {result.versionCode}) · SDK {result.minSdk}–{result.targetSdk} · {formatBytes(result.fileSize)} · score {result.score}/100
              </p>
            </div>
            <div className="ml-auto flex items-center gap-3">
              <div className="flex gap-1.5 flex-wrap justify-end">
                {SEV_ORDER.map(s => (result.counts?.[s] ? (
                  <span key={s} className={`px-1.5 py-0.5 rounded text-[10px] font-medium ${sevBadge(s)}`}>
                    {result.counts[s]} {s}
                  </span>
                ) : null))}
              </div>
              <div className="relative shrink-0">
                <button onClick={() => setShowExport(v => !v)} disabled={exporting} className="btn-ghost text-xs">
                  <Download size={12} /> {exporting ? 'Exporting…' : 'Export'}
                </button>
                {showExport && (
                  <div className="absolute right-0 z-20 mt-1 w-32 bg-bg-surface border border-bg-border rounded shadow-lg">
                    {(['json', 'csv', 'sarif'] as const).map(f => (
                      <button
                        key={f}
                        onClick={() => doExport(f)}
                        className="w-full text-left px-3 py-1.5 text-xs text-text-secondary hover:bg-bg-raised hover:text-text-primary uppercase mono border-b border-bg-border/30 last:border-0"
                      >
                        {f}
                      </button>
                    ))}
                  </div>
                )}
              </div>
            </div>
          </div>

          {/* Tabs */}
          <div className="border-b border-bg-border flex shrink-0 overflow-x-auto">
            {tabs.map(t => (
              <button
                key={t.id}
                onClick={() => setTab(t.id)}
                className={`flex items-center gap-1.5 px-3 py-2 text-xs whitespace-nowrap border-b-2 transition-colors ${
                  tab === t.id ? 'border-accent-green text-accent-green'
                               : 'border-transparent text-text-muted hover:text-text-secondary'
                }`}
              >
                {t.icon} {t.label}
              </button>
            ))}
          </div>

          <div className="flex-1 overflow-auto p-4">
            {/* OVERVIEW */}
            {tab === 'overview' && (
              <div className="space-y-5">
                <div className="grid grid-cols-2 gap-x-8 gap-y-2">
                  {[
                    { label: 'Package',    value: result.packageName },
                    { label: 'Version',    value: `${result.versionName} (${result.versionCode})` },
                    { label: 'SDK',        value: `min ${result.minSdk} · target ${result.targetSdk} · compile ${result.compileSdk}` },
                    { label: 'Source',     value: result.source === 'device' ? 'Installed app' : result.path },
                    { label: 'SHA-256',    value: result.sha256 },
                    { label: 'Size',       value: formatBytes(result.fileSize) },
                  ].map(({ label, value }) => (
                    <div key={label} className="flex gap-2 min-w-0">
                      <span className="text-text-muted text-xs w-24 shrink-0">{label}</span>
                      <span className="text-xs text-text-primary mono truncate" title={value}>{value || 'N/A'}</span>
                    </div>
                  ))}
                </div>

                {/* manifest flags */}
                <div className="flex gap-1.5 flex-wrap">
                  {result.debuggable && <span className="badge-red">debuggable</span>}
                  {result.allowBackup && <span className="badge-yellow">allowBackup</span>}
                  {result.usesCleartext && <span className="badge-yellow">cleartext traffic</span>}
                  {result.hasNetworkSecurityConfig && <span className="badge-green">network-security-config</span>}
                  {result.cert.verified
                    ? <span className="badge-green">signature verified</span>
                    : <span className="badge-red">unsigned / unverified</span>}
                  {result.cert.v3 && <span className="badge-gray">v3 sig</span>}
                  {result.cert.v2 && <span className="badge-gray">v2 sig</span>}
                  {result.cert.v1 && <span className="badge-gray">v1 sig</span>}
                </div>

                {/* dangerous perms */}
                <div>
                  <p className="section-title mb-2">Dangerous permissions ({dangerousPerms.length})</p>
                  {dangerousPerms.length === 0 && <p className="text-text-muted text-xs">None of the runtime-dangerous permissions are requested.</p>}
                  <div className="flex flex-wrap gap-1.5">
                    {dangerousPerms.map(p => (
                      <span key={p.name} className="px-1.5 py-0.5 rounded text-[10px] bg-warn/10 text-warn border border-warn/20 mono">
                        {p.name.replace('android.permission.', '')}
                      </span>
                    ))}
                  </div>
                </div>

                {/* trackers */}
                <div>
                  <p className="section-title mb-2 flex items-center gap-1.5"><Radar size={12} /> Trackers / SDKs ({result.trackers?.length || 0})</p>
                  {(!result.trackers || result.trackers.length === 0) && <p className="text-text-muted text-xs">No known tracker SDK signatures detected.</p>}
                  <div className="space-y-1">
                    {result.trackers?.map(tr => (
                      <div key={tr.name} className="flex items-center gap-2 text-xs py-0.5">
                        <span className="text-text-primary w-44 truncate">{tr.name}</span>
                        <span className="text-text-muted w-32">{tr.category}</span>
                        <span className="text-text-muted">×{tr.matches}</span>
                      </div>
                    ))}
                  </div>
                </div>
              </div>
            )}

            {/* FINDINGS */}
            {tab === 'findings' && (
              <div className="space-y-3">
                <div className="flex items-center gap-2 flex-wrap">
                  {(['all', ...SEV_ORDER] as const).map(s => (
                    <button
                      key={s}
                      onClick={() => setFindFilter(s)}
                      className={`px-2 py-0.5 rounded text-[10px] capitalize ${
                        findFilter === s ? 'bg-accent-green/15 text-accent-green border border-accent-green/30'
                                         : 'bg-bg-raised text-text-muted border border-bg-border'
                      }`}
                    >
                      {s}{s !== 'all' && result.counts?.[s] ? ` ${result.counts[s]}` : ''}
                    </button>
                  ))}
                  <div className="relative ml-auto">
                    <Search size={12} className="absolute left-2.5 top-1/2 -translate-y-1/2 text-text-muted" />
                    <input
                      className="input pl-7 text-xs w-48"
                      placeholder="Search findings…"
                      value={findSearch}
                      onChange={e => setFindSearch(e.target.value)}
                    />
                  </div>
                </div>

                {visibleFindings.length === 0 && (
                  <p className="text-text-muted text-xs py-6 text-center">No findings match.</p>
                )}
                {visibleFindings.map(f => (
                  <FindingRow
                    key={f.id}
                    f={f}
                    open={openFinding === f.id}
                    onToggle={() => setOpenFinding(openFinding === f.id ? null : f.id)}
                  />
                ))}
              </div>
            )}

            {/* MANIFEST */}
            {tab === 'manifest' && (
              <div className="space-y-4">
                <div>
                  <p className="section-title mb-2">Permissions ({result.permissions?.length || 0})</p>
                  <div className="space-y-0.5">
                    {result.permissions?.map(p => (
                      <div key={p.name} className="flex items-center gap-2 py-0.5 border-b border-bg-border/30">
                        <Shield size={11} className={p.dangerous ? 'text-warn shrink-0' : 'text-text-muted shrink-0'} />
                        <span className="mono text-xs text-text-secondary">{p.name}</span>
                        {p.dangerous && <span className="badge-yellow ml-auto">dangerous</span>}
                      </div>
                    ))}
                  </div>
                </div>
                <div>
                  <p className="section-title mb-2">Decoded AndroidManifest.xml</p>
                  <pre className="mono text-xs text-text-secondary whitespace-pre-wrap break-words leading-relaxed bg-bg-raised rounded p-3 border border-bg-border max-h-[55vh] overflow-auto">
                    {result.manifestXml || 'Not available'}
                  </pre>
                </div>
              </div>
            )}

            {/* COMPONENTS */}
            {tab === 'components' && (
              <div className="space-y-4">
                {['activity', 'service', 'receiver', 'provider'].map(type => {
                  const items = result.components.filter(c => c.type === type)
                  return (
                    <div key={type}>
                      <p className="section-title mb-2 capitalize">{type} ({items.length})</p>
                      {items.length === 0 && <p className="text-text-muted text-xs">None</p>}
                      {items.map((c, i) => (
                        <div key={c.name + i} className="py-1 border-b border-bg-border/30">
                          <div className="flex items-center gap-2">
                            <span className="mono text-xs text-text-secondary truncate">{c.name}</span>
                            {c.exported && <span className="badge-red shrink-0">exported</span>}
                            {!c.exported && c.exportedImplicit && <span className="badge-yellow shrink-0">implicit export</span>}
                            {c.permission && <span className="badge-gray shrink-0" title={c.permission}>protected</span>}
                          </div>
                          {c.intentFilters?.filter(Boolean).length > 0 && (
                            <p className="text-[10px] text-text-muted mt-0.5 pl-1">↳ {c.intentFilters.filter(Boolean).join('  ·  ')}</p>
                          )}
                        </div>
                      ))}
                    </div>
                  )
                })}
              </div>
            )}

            {/* CERT */}
            {tab === 'cert' && (
              <div className="space-y-3">
                <div className="flex gap-1.5 flex-wrap">
                  {result.cert.verified ? <span className="badge-green">verified</span> : <span className="badge-red">does not verify</span>}
                  {result.cert.v1 && <span className="badge-gray">v1 scheme</span>}
                  {result.cert.v2 && <span className="badge-gray">v2 scheme</span>}
                  {result.cert.v3 && <span className="badge-gray">v3 scheme</span>}
                  {result.cert.isDebug && <span className="badge-red">debug cert</span>}
                  {result.cert.expired && <span className="badge-yellow">expired</span>}
                  {result.cert.weakAlgo && <span className="badge-red">weak algorithm</span>}
                </div>
                {result.cert.error && (
                  <p className="text-xs text-danger bg-danger/10 border border-danger/20 rounded px-3 py-1.5">{result.cert.error}</p>
                )}
                {[
                  { label: 'Subject',   value: result.cert.subject },
                  { label: 'Issuer',    value: result.cert.issuer },
                  { label: 'Algorithm', value: result.cert.sigAlgo },
                  { label: 'Serial',    value: result.cert.serial },
                  { label: 'Valid from', value: result.cert.validFrom },
                  { label: 'Valid to',   value: result.cert.validTo },
                  { label: 'SHA-256',   value: result.cert.sha256 },
                  { label: 'SHA-1',     value: result.cert.sha1 },
                ].map(({ label, value }) => (
                  <div key={label}>
                    <p className="text-xs text-text-muted mb-0.5">{label}</p>
                    <p className="mono text-xs text-text-primary bg-bg-raised rounded px-3 py-1.5 break-all">{value || 'N/A'}</p>
                  </div>
                ))}
              </div>
            )}

            {/* EXPLORER */}
            {tab === 'explorer' && (
              <div className="flex gap-3 h-full min-h-0">
                {/* file list */}
                <div className="w-72 shrink-0 flex flex-col min-h-0">
                  <div className="relative mb-2">
                    <Search size={12} className="absolute left-2.5 top-1/2 -translate-y-1/2 text-text-muted" />
                    <input
                      className="input pl-7 text-xs w-full"
                      placeholder="Filter files…"
                      value={fileSearch}
                      onChange={e => setFileSearch(e.target.value)}
                    />
                  </div>
                  <div className="border border-bg-border rounded overflow-auto flex-1">
                    {visibleFiles.map(f => (
                      <button
                        key={f.path}
                        onClick={() => openEntry(f.path)}
                        className={`w-full flex items-center gap-2 px-2.5 py-1 text-xs border-b border-bg-border/30 text-left ${
                          entryPath === f.path ? 'bg-accent-green/10' : 'hover:bg-bg-raised'
                        }`}
                      >
                        <FileCode size={11} className="text-text-muted shrink-0" />
                        <span className="mono text-text-secondary truncate flex-1">{f.path}</span>
                        <span className="text-text-muted shrink-0">{formatBytes(f.size)}</span>
                      </button>
                    ))}
                    {(result.files?.length || 0) > visibleFiles.length && (
                      <p className="text-text-muted text-[10px] p-2 text-center">Showing {visibleFiles.length} of {result.files.length} — refine the filter.</p>
                    )}
                  </div>
                </div>

                {/* viewer */}
                <div className="flex-1 min-w-0 flex flex-col border border-bg-border rounded overflow-hidden">
                  {!entryPath && (
                    <div className="flex items-center justify-center h-full text-text-muted text-xs">Select a file to view its contents</div>
                  )}
                  {entryPath && (
                    <>
                      <div className="flex items-center gap-2 px-3 py-1.5 border-b border-bg-border bg-bg-surface shrink-0">
                        <span className="mono text-xs text-text-primary truncate flex-1">{entryPath}</span>
                        {entry && <span className="text-[10px] text-text-muted shrink-0">{entry.kind} · {formatBytes(entry.size)}{entry.truncated ? ' · truncated' : ''}</span>}
                        <button onClick={() => { setEntry(null); setEntryPath('') }} className="text-text-muted hover:text-text-primary shrink-0"><X size={13} /></button>
                      </div>
                      <div className="flex-1 overflow-auto">
                        {entryLoading && (
                          <div className="flex items-center justify-center h-full">
                            <div className="w-5 h-5 border-2 border-accent-green border-t-transparent rounded-full animate-spin" />
                          </div>
                        )}
                        {entry?.kind === 'image' && (
                          <div className="p-4 flex items-center justify-center bg-bg-base">
                            <img src={`data:${entry.mime};base64,${entry.base64}`} alt={entry.name} className="max-w-full max-h-[55vh] object-contain" />
                          </div>
                        )}
                        {entry?.kind === 'text' && (
                          <pre className="mono text-[11px] text-text-secondary whitespace-pre-wrap break-words leading-relaxed p-3">{entry.text}</pre>
                        )}
                        {entry?.kind === 'binary' && (
                          <pre className="mono text-[11px] text-text-secondary whitespace-pre p-3 leading-snug">{entry.hex}</pre>
                        )}
                      </div>
                    </>
                  )}
                </div>
              </div>
            )}
          </div>
        </>
      )}
    </div>
  )
}

function FindingRow({ f, open, onToggle }: { f: APKAuditFinding; open: boolean; onToggle: () => void }) {
  return (
    <div className="border border-bg-border rounded overflow-hidden">
      <button onClick={onToggle} className="w-full flex items-center gap-2 px-3 py-2 text-left hover:bg-bg-raised">
        <ChevronRight size={13} className={`text-text-muted shrink-0 transition-transform ${open ? 'rotate-90' : ''}`} />
        <span className={`px-1.5 py-0.5 rounded text-[10px] font-medium uppercase shrink-0 ${sevBadge(f.severity)}`}>{f.severity}</span>
        <span className="text-xs text-text-primary flex-1">{f.title}</span>
        {f.matches?.length > 0 && <span className="text-[10px] text-text-muted shrink-0">{f.matches.length} match{f.matches.length > 1 ? 'es' : ''}</span>}
      </button>
      {open && (
        <div className="px-3 pb-3 pt-1 space-y-2 bg-bg-base/50">
          <p className="text-xs text-text-secondary">{f.description}</p>
          <div className="flex gap-2 flex-wrap">
            {f.cwe && <span className="badge-gray">{f.cwe}</span>}
            {f.masvs && <span className="badge-gray">{f.masvs}</span>}
            <span className="badge-gray">{f.category}</span>
            <span className="badge-gray">confidence {f.confidence}%</span>
          </div>
          {f.matches?.length > 0 && (
            <div className="space-y-0.5 mt-1">
              {f.matches.map((m, i) => (
                <div key={i} className="flex gap-2 text-[11px] mono bg-bg-raised rounded px-2 py-1">
                  {m.file && <span className="text-text-muted shrink-0">{m.file}</span>}
                  <span className="text-text-secondary break-all">{m.value}</span>
                </div>
              ))}
            </div>
          )}
        </div>
      )}
    </div>
  )
}
