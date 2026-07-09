import { useState, useEffect, useMemo, useCallback } from 'react'
import {
  PackagePlus, FolderOpen, FilePlus, Trash2, Search, Download,
  CheckCircle2, XCircle, Loader2, X, Ban
} from 'lucide-react'
import {
  SelectApkFolder, SelectMultipleApkFiles, ListApksInFolder, StatApkFiles,
  InstallApksWithProgress, CancelOperation
} from '../../lib/wails'
import { notify } from '../../lib/notify'
import type { ApkFileInfo } from '../../lib/types'

const rt = () => (window as any)['runtime']

type RowStatus = 'idle' | 'pending' | 'installing' | 'success' | 'failed'
interface Progress { status: RowStatus; message?: string }

function formatSize(bytes: number): string {
  if (bytes >= 1048576) return `${(bytes / 1048576).toFixed(1)} MB`
  if (bytes >= 1024) return `${(bytes / 1024).toFixed(0)} KB`
  return `${bytes} B`
}

export default function ViewApkInstaller() {
  const [apks, setApks] = useState<ApkFileInfo[]>([])
  const [selected, setSelected] = useState<Set<string>>(new Set())
  const [progress, setProgress] = useState<Record<string, Progress>>({})
  const [installing, setInstalling] = useState(false)
  const [search, setSearch] = useState('')

  // Live per-file install status, driven by backend apkinstall:* events.
  useEffect(() => {
    const onProgress = (p: { current: number; total: number; path: string; status: RowStatus; message?: string }) => {
      setProgress(prev => ({ ...prev, [p.path]: { status: p.status, message: p.message } }))
    }
    const onDone = () => setInstalling(false)
    const off1 = rt()?.EventsOn?.('apkinstall:progress', onProgress)
    const off2 = rt()?.EventsOn?.('apkinstall:done', onDone)
    return () => { off1?.(); off2?.() }
  }, [])

  const mergeApks = useCallback((incoming: ApkFileInfo[]) => {
    if (incoming.length === 0) return
    setApks(prev => {
      const byPath = new Map(prev.map(a => [a.path, a]))
      for (const a of incoming) byPath.set(a.path, a)
      return [...byPath.values()].sort((a, b) => a.name.localeCompare(b.name))
    })
    setSelected(prev => {
      const next = new Set(prev)
      for (const a of incoming) next.add(a.path)
      return next
    })
  }, [])

  const addFolder = async () => {
    try {
      const folder = await SelectApkFolder()
      if (!folder) return
      const found = await ListApksInFolder(folder)
      if (!found || found.length === 0) { notify.error('No APKs found in that folder'); return }
      mergeApks(found)
    } catch (e: any) {
      notify.error(e)
    }
  }

  const addFiles = async () => {
    try {
      const paths = await SelectMultipleApkFiles()
      if (!paths || paths.length === 0) return
      const found = await StatApkFiles(paths)
      mergeApks(found || [])
    } catch (e: any) {
      notify.error(e)
    }
  }

  const removeOne = (path: string) => {
    setApks(prev => prev.filter(a => a.path !== path))
    setSelected(prev => { const next = new Set(prev); next.delete(path); return next })
    setProgress(prev => { const { [path]: _drop, ...rest } = prev; return rest })
  }

  const clearAll = () => { setApks([]); setSelected(new Set()); setProgress({}) }

  const filtered = useMemo(() =>
    apks.filter(a => a.name.toLowerCase().includes(search.toLowerCase())),
    [apks, search]
  )

  const toggleSelect = (path: string) => setSelected(prev => {
    const next = new Set(prev)
    next.has(path) ? next.delete(path) : next.add(path)
    return next
  })

  const selectAll = () => {
    if (selected.size === filtered.length) {
      setSelected(new Set())
    } else {
      setSelected(new Set(filtered.map(a => a.path)))
    }
  }

  const install = async () => {
    if (selected.size === 0) { notify.error('Select at least one APK'); return }
    const targets = apks.filter(a => selected.has(a.path))
    setInstalling(true)
    const reset: Record<string, Progress> = {}
    for (const t of targets) reset[t.path] = { status: 'pending' }
    setProgress(prev => ({ ...prev, ...reset }))
    try {
      const summary = await InstallApksWithProgress(targets.map(t => t.path))
      notify.success(summary)
    } catch (e: any) {
      notify.error(e)
    } finally {
      setInstalling(false)
    }
  }

  const cancel = async () => {
    try { await CancelOperation() } catch { /* best effort */ }
  }

  const statusIcon = (status: RowStatus | undefined) => {
    switch (status) {
      case 'installing': return <Loader2 size={13} className="animate-spin text-accent-green" />
      case 'success':    return <CheckCircle2 size={13} className="text-accent-green" />
      case 'failed':     return <XCircle size={13} className="text-danger" />
      case 'pending':    return <span className="w-[13px] h-[13px] rounded-full border border-text-muted inline-block" />
      default:           return null
    }
  }

  return (
    <div className="flex flex-col h-full">
      {/* Toolbar */}
      <div className="border-b border-bg-border px-4 py-2 flex items-center gap-2 shrink-0 flex-wrap">
        <PackagePlus size={14} className="text-accent-green shrink-0" />
        <span className="text-xs text-text-secondary">APK Installer</span>

        <button onClick={addFolder} disabled={installing} className="btn-ghost text-xs">
          <FolderOpen size={13} /> Add Folder
        </button>
        <button onClick={addFiles} disabled={installing} className="btn-ghost text-xs">
          <FilePlus size={13} /> Add APKs
        </button>
        {apks.length > 0 && (
          <button onClick={clearAll} disabled={installing} className="btn-ghost text-xs">
            <Trash2 size={13} /> Clear
          </button>
        )}

        <div className="relative flex-1 min-w-[160px]">
          <Search size={13} className="absolute left-3 top-1/2 -translate-y-1/2 text-text-muted" />
          <input
            className="input pl-8 text-xs"
            placeholder="Filter list..."
            value={search}
            onChange={e => setSearch(e.target.value)}
          />
        </div>

        <div className="w-px h-5 bg-bg-border" />

        {installing ? (
          <button onClick={cancel} className="btn-danger text-xs">
            <Ban size={13} /> Cancel
          </button>
        ) : (
          <button onClick={install} disabled={selected.size === 0} className="btn-primary text-xs">
            <Download size={13} /> Install Selected ({selected.size})
          </button>
        )}
      </div>

      {/* List header */}
      {apks.length > 0 && (
        <div className="grid grid-cols-[24px_20px_1fr_80px_60px] gap-2 px-4 py-1.5 border-b border-bg-border text-text-muted text-xs shrink-0">
          <input
            type="checkbox"
            checked={filtered.length > 0 && selected.size === filtered.length}
            onChange={selectAll}
            disabled={installing}
            className="accent-accent-green"
          />
          <span />
          <span>APK</span>
          <span>Size</span>
          <span></span>
        </div>
      )}

      {/* List */}
      <div className="flex-1 overflow-auto">
        {apks.length === 0 && (
          <div className="flex flex-col items-center justify-center h-full gap-3 text-text-muted">
            <PackagePlus size={28} className="opacity-30" />
            <p className="text-sm">Add a folder of APKs, or pick files individually</p>
          </div>
        )}
        {filtered.map(a => {
          const prog = progress[a.path]
          return (
            <div
              key={a.path}
              className={`
                grid grid-cols-[24px_20px_1fr_80px_60px] gap-2 px-4 py-2
                border-b border-bg-border/50 items-center text-xs
                hover:bg-bg-raised transition-colors
                ${selected.has(a.path) ? 'bg-accent-green/5' : ''}
              `}
            >
              <input
                type="checkbox"
                checked={selected.has(a.path)}
                onChange={() => toggleSelect(a.path)}
                disabled={installing}
                className="accent-accent-green"
              />
              <span title={prog?.message}>{statusIcon(prog?.status)}</span>
              <div className="min-w-0">
                <p className="mono text-text-secondary truncate">{a.name}</p>
                {prog?.status === 'failed' && prog.message && (
                  <p className="text-danger text-[11px] truncate" title={prog.message}>{prog.message}</p>
                )}
              </div>
              <span className="text-text-muted">{formatSize(a.size)}</span>
              <button
                onClick={() => removeOne(a.path)}
                disabled={installing}
                className="btn-ghost text-xs py-0.5 px-1.5 justify-self-start"
                title="Remove from list"
              >
                <X size={12} />
              </button>
            </div>
          )
        })}
      </div>

      {/* Status bar */}
      <div className="border-t border-bg-border px-4 py-1.5 flex items-center justify-between text-xs text-text-muted shrink-0">
        <span>{filtered.length} APK(s){search ? ` matching "${search}"` : ''}</span>
        {selected.size > 0 && <span>{selected.size} selected</span>}
      </div>
    </div>
  )
}
