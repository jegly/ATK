import { useState, useEffect, useCallback, useRef } from 'react'
import {
  FolderOpen, File, ArrowLeft, ArrowRight, ArrowUp, RefreshCw, Upload,
  Download, Trash2, FolderPlus, Edit3, Copy, FolderInput, Smartphone, Monitor,
  Image as ImageIcon, X, ChevronLeft, ChevronRight
} from 'lucide-react'
import {
  ListFiles, ListLocalFiles, HomeDir, PushWithProgress, PushPathsWithProgress,
  PullPathsWithProgress, DeleteMultipleFiles, CreateFolder, RenameFile,
  SelectFileForPush, CancelOperation
} from '../../lib/wails'
import { notify } from '../../lib/notify'
import { CodeView, detectLang } from '../../lib/syntax'
import type { FileEntry } from '../../lib/types'

// Wails runtime is injected on window['runtime'] (same access as ViewLogcat).
const rt = () => (window as any)['runtime']

type Source = 'device' | 'local'
interface Transfer { kind: string; label: string; percent: number }
interface Menu { x: number; y: number; entry: FileEntry }
interface Nav { stack: string[]; idx: number }

export default function ViewFiles() {
  const [source, setSource] = useState<Source>('device')
  const [nav, setNav] = useState<Nav>({ stack: ['/sdcard'], idx: 0 })
  const path = nav.stack[nav.idx]
  const [pathInput, setPathInput] = useState(path)
  const [files, setFiles] = useState<FileEntry[]>([])
  const [loading, setLoading] = useState(false)
  const [selected, setSelected] = useState<Set<string>>(new Set())
  const [renaming, setRenaming] = useState<string | null>(null)
  const [renameValue, setRenameValue] = useState('')
  const [newFolder, setNewFolder] = useState(false)
  const [newFolderName, setNewFolderName] = useState('')
  const [menu, setMenu] = useState<Menu | null>(null)
  const [moving, setMoving] = useState<FileEntry | null>(null)
  const [moveDest, setMoveDest] = useState('')
  const [pushStaged, setPushStaged] = useState<string[] | null>(null)
  const [transfer, setTransfer] = useState<Transfer | null>(null)
  const [eta, setEta] = useState('')
  const [viewer, setViewer] = useState<string | null>(null) // image filename being viewed
  const [imgLoading, setImgLoading] = useState(false)
  const [imgError, setImgError] = useState(false)
  const [textView, setTextView] = useState<{ name: string; content: string } | null>(null)
  const [textLoading, setTextLoading] = useState(false)
  const progRef = useRef<{ label: string; t0: number } | null>(null)
  // Remembered path per source + the last device dir (push destination default).
  const remembered = useRef<Record<Source, string>>({ device: '/sdcard', local: '' })

  const fullPath = useCallback(
    (name: string) => (path.endsWith('/') ? path + name : path + '/' + name),
    [path]
  )

  const loadFiles = useCallback(async (p: string, src: Source) => {
    setLoading(true)
    setSelected(new Set())
    try {
      const result = await (src === 'device' ? ListFiles(p) : ListLocalFiles(p))
      setFiles(result || [])
    } catch (e: any) {
      notify.error(e)
      setFiles([])
    } finally {
      setLoading(false)
    }
  }, [])

  useEffect(() => { loadFiles(path, source) }, [path, source, loadFiles])
  useEffect(() => { setPathInput(path) }, [path])

  // Live push/pull progress + ETA, computed from percent over elapsed time.
  useEffect(() => {
    const onProgress = (t: Transfer) => {
      const now = performance.now()
      if (!progRef.current || progRef.current.label !== t.label || t.percent === 0) {
        progRef.current = { label: t.label, t0: now }
      }
      const elapsed = now - progRef.current.t0
      if (t.percent > 0 && t.percent < 100) {
        const total = elapsed / (t.percent / 100)
        setEta(formatEta(Math.max(0, total - elapsed)))
      } else {
        setEta('')
      }
      setTransfer(t)
    }
    const onDone = () => { setTransfer(null); setEta(''); progRef.current = null }
    const off1 = rt()?.EventsOn?.('transfer:progress', onProgress)
    const off2 = rt()?.EventsOn?.('transfer:done', onDone)
    return () => { off1?.(); off2?.() }
  }, [])

  // Seed the Computer browser's starting path with the user's home directory.
  useEffect(() => {
    HomeDir().then((h: string) => { if (h) remembered.current.local = h }).catch(() => {})
  }, [])

  // Navigate to a new path (pushes onto history, truncating any forward entries).
  const go = (to: string) => {
    setNav(n => {
      if (n.stack[n.idx] === to) return n
      const stack = n.stack.slice(0, n.idx + 1)
      stack.push(to)
      return { stack, idx: stack.length - 1 }
    })
  }
  const back = () => setNav(n => (n.idx > 0 ? { ...n, idx: n.idx - 1 } : n))
  const forward = () => setNav(n => (n.idx < n.stack.length - 1 ? { ...n, idx: n.idx + 1 } : n))

  const switchSource = (s: Source) => {
    if (s === source) return
    remembered.current[source] = path
    const target = remembered.current[s] || (s === 'local' ? '/' : '/sdcard')
    setSource(s)
    setNav({ stack: [target], idx: 0 })
  }

  const navigate = (entry: FileEntry) => {
    if (entry.type === 'Directory' || entry.type === 'Symlink') go(fullPath(entry.name))
  }

  const goUp = () => {
    const parts = path.split('/').filter(Boolean)
    if (parts.length === 0) return
    parts.pop()
    go('/' + parts.join('/') || '/')
  }

  const navigatePath = () => go(pathInput)

  const toggleSelect = (name: string) => {
    setSelected(prev => {
      const next = new Set(prev)
      next.has(name) ? next.delete(name) : next.add(name)
      return next
    })
  }

  const selectAll = () => {
    if (selected.size === files.length) setSelected(new Set())
    else setSelected(new Set(files.map(f => f.name)))
  }

  // ── Device-mode actions ──
  const handlePush = async () => {
    const local = await SelectFileForPush()
    if (!local) return
    try {
      const out = await PushWithProgress(local, path)
      notify.success(out || 'File pushed')
      loadFiles(path, source)
    } catch (e: any) {
      notify.error(e)
    }
  }

  const pull = async (paths: string[]) => {
    if (paths.length === 0) { notify.error('Select files to pull'); return }
    try {
      const out = await PullPathsWithProgress(paths)
      notify.success(out)
    } catch (e: any) {
      notify.error(e)
    }
  }

  const del = async (paths: string[]) => {
    if (paths.length === 0) { notify.error('Select files to delete'); return }
    if (!confirm(`Delete ${paths.length} item(s)?`)) return
    const id = notify.loading('Deleting...')
    try {
      const out = await DeleteMultipleFiles(paths)
      notify.dismiss(id)
      notify.success(out)
      loadFiles(path, source)
    } catch (e: any) {
      notify.dismiss(id)
      notify.error(e)
    }
  }

  // ── Local→device push: stage the files, then flip to the Device browser so
  // the user picks the destination folder visually and clicks "Push here". ──
  const startPush = (localPaths: string[]) => {
    if (localPaths.length === 0) { notify.error('Select files to push'); return }
    setPushStaged(localPaths)
    remembered.current.local = path
    setSource('device')
    setNav({ stack: [remembered.current.device || '/sdcard'], idx: 0 })
  }
  const handlePushHere = async () => {
    if (!pushStaged) return
    const files = pushStaged
    setPushStaged(null)
    try {
      const out = await PushPathsWithProgress(files, path)
      notify.success(out)
      loadFiles(path, source)
    } catch (e: any) {
      notify.error(e)
    }
  }

  const handleCreateFolder = async () => {
    if (!newFolderName.trim()) return
    try {
      await CreateFolder(fullPath(newFolderName))
      notify.success('Folder created')
      setNewFolder(false)
      setNewFolderName('')
      loadFiles(path, source)
    } catch (e: any) {
      notify.error(e)
    }
  }

  const startRename = (name: string) => {
    setRenaming(name)
    setRenameValue(name)
  }

  const handleRename = async () => {
    if (!renaming || !renameValue.trim() || renameValue === renaming) {
      setRenaming(null)
      return
    }
    try {
      await RenameFile(fullPath(renaming), fullPath(renameValue))
      notify.success('Renamed')
      setRenaming(null)
      loadFiles(path, source)
    } catch (e: any) {
      notify.error(e)
    }
  }

  const handleMove = async () => {
    if (!moving) return
    const destDir = moveDest.trim().replace(/\/+$/, '')
    if (!destDir) { setMoving(null); return }
    try {
      await RenameFile(fullPath(moving.name), destDir + '/' + moving.name)
      notify.success(`Moved to ${destDir}`)
      setMoving(null)
      loadFiles(path, source)
    } catch (e: any) {
      notify.error(e)
    }
  }

  const copyPath = (entry: FileEntry) => {
    navigator.clipboard?.writeText(fullPath(entry.name))
    notify.success('Path copied')
  }

  // ── Image viewer — streams bytes via the /__file asset-server route (no
  // base64 size limits). The <img> loads the URL itself. ──
  const fileURL = useCallback(
    (name: string) => `/__file?src=${source}&p=${encodeURIComponent(fullPath(name))}`,
    [source, fullPath]
  )
  const openViewer = (name: string) => { setViewer(name); setImgLoading(true); setImgError(false) }

  // Text preview: fetch the file's bytes via the same /__file route the image
  // viewer uses (works for device and local), cap the size, and show highlighted.
  const openText = async (name: string) => {
    setTextView({ name, content: '' })
    setTextLoading(true)
    try {
      const res = await fetch(fileURL(name))
      let t = await res.text()
      if (t.length > 400000) t = t.slice(0, 400000) + '\n\n… (truncated at 400 KB)'
      setTextView({ name, content: t })
    } catch (e: any) {
      notify.error(e)
      setTextView(null)
    } finally {
      setTextLoading(false)
    }
  }

  // Esc closes the text viewer.
  useEffect(() => {
    if (!textView) return
    const onKey = (e: KeyboardEvent) => { if (e.key === 'Escape') setTextView(null) }
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  }, [textView])

  const stepViewer = useCallback((delta: number) => {
    setViewer(cur => {
      if (!cur) return cur
      const imgs = files.filter(f => isImage(f.name)).map(f => f.name)
      const i = imgs.indexOf(cur)
      if (i < 0) return cur
      setImgLoading(true)
      setImgError(false)
      return imgs[(i + delta + imgs.length) % imgs.length]
    })
  }, [files])

  // Esc to close, arrows to step through images while the viewer is open.
  useEffect(() => {
    if (!viewer) return
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') setViewer(null)
      if (e.key === 'ArrowRight') stepViewer(1)
      if (e.key === 'ArrowLeft') stepViewer(-1)
    }
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  }, [viewer, stepViewer])

  // Double-click / Open: directories navigate, images open the viewer.
  const open = (entry: FileEntry) => {
    if (entry.type === 'Directory' || entry.type === 'Symlink') navigate(entry)
    else if (isImage(entry.name)) openViewer(entry.name)
    else if (isText(entry.name)) openText(entry.name)
  }

  const formatSize = (size: string) => {
    const n = parseInt(size)
    if (isNaN(n)) return size
    if (n < 1024) return `${n} B`
    if (n < 1048576) return `${(n / 1024).toFixed(1)} KB`
    return `${(n / 1048576).toFixed(1)} MB`
  }

  const isDevice = source === 'device'

  return (
    <div className="flex flex-col h-full" onClick={() => menu && setMenu(null)}>
      {/* Toolbar */}
      <div className="border-b border-bg-border px-4 py-2 flex items-center gap-2 shrink-0">
        {/* Source toggle */}
        <div className="flex gap-1 bg-bg-raised rounded p-0.5 shrink-0">
          <button
            onClick={() => switchSource('device')}
            className={`px-2 py-0.5 rounded text-xs font-medium flex items-center gap-1 transition-colors ${
              isDevice ? 'bg-accent-green/20 text-accent-green' : 'text-text-muted hover:text-text-secondary'
            }`}
          >
            <Smartphone size={12} /> Device
          </button>
          <button
            onClick={() => switchSource('local')}
            className={`px-2 py-0.5 rounded text-xs font-medium flex items-center gap-1 transition-colors ${
              !isDevice ? 'bg-accent-green/20 text-accent-green' : 'text-text-muted hover:text-text-secondary'
            }`}
          >
            <Monitor size={12} /> Computer
          </button>
        </div>

        <button onClick={back} disabled={nav.idx === 0} className="btn-ghost p-1.5" title="Back">
          <ArrowLeft size={14} />
        </button>
        <button onClick={forward} disabled={nav.idx === nav.stack.length - 1} className="btn-ghost p-1.5" title="Forward">
          <ArrowRight size={14} />
        </button>
        <button onClick={goUp} disabled={path === '/'} className="btn-ghost p-1.5" title="Up">
          <ArrowUp size={14} />
        </button>
        <input
          className="input flex-1 text-xs mono"
          value={pathInput}
          onChange={e => setPathInput(e.target.value)}
          onKeyDown={e => e.key === 'Enter' && navigatePath()}
          placeholder={isDevice ? '/sdcard' : '/home'}
        />
        <button onClick={() => loadFiles(path, source)} disabled={loading} className="btn-ghost p-1.5">
          <RefreshCw size={14} className={loading ? 'animate-spin' : ''} />
        </button>

        <div className="w-px h-5 bg-bg-border mx-1" />

        {isDevice ? (
          <>
            <button onClick={handlePush} className="btn-ghost text-xs">
              <Upload size={13} /> Push
            </button>
            <button onClick={() => pull([...selected].map(fullPath))} disabled={selected.size === 0} className="btn-ghost text-xs">
              <Download size={13} /> Pull {selected.size > 0 ? `(${selected.size})` : ''}
            </button>
            <button onClick={() => setNewFolder(true)} className="btn-ghost text-xs">
              <FolderPlus size={13} /> New Folder
            </button>
            <button onClick={() => del([...selected].map(fullPath))} disabled={selected.size === 0} className="btn-danger text-xs">
              <Trash2 size={13} /> Delete {selected.size > 0 ? `(${selected.size})` : ''}
            </button>
          </>
        ) : (
          <button onClick={() => startPush([...selected].map(fullPath))} disabled={selected.size === 0} className="btn-ghost text-xs">
            <Upload size={13} /> Push to device {selected.size > 0 ? `(${selected.size})` : ''}
          </button>
        )}
      </div>

      {/* Transfer progress bar */}
      {transfer && (
        <div className="border-b border-bg-border px-4 py-2 bg-bg-raised flex items-center gap-3 shrink-0">
          {transfer.kind === 'pull' ? <Download size={13} className="text-accent-green shrink-0" /> : <Upload size={13} className="text-accent-green shrink-0" />}
          <span className="text-xs text-text-secondary truncate max-w-[200px]" title={transfer.label}>{transfer.label}</span>
          <div className="flex-1 h-1.5 rounded-full bg-bg-border overflow-hidden">
            <div className="h-full bg-accent-green transition-all duration-200" style={{ width: `${transfer.percent}%` }} />
          </div>
          <span className="text-xs text-text-muted mono w-10 text-right">{transfer.percent}%</span>
          {eta && <span className="text-xs text-text-muted w-20 text-right">~{eta} left</span>}
          <button onClick={() => CancelOperation()} className="btn-warn text-xs">Cancel</button>
        </div>
      )}

      {/* New folder input */}
      {newFolder && (
        <div className="border-b border-bg-border px-4 py-2 flex items-center gap-2 bg-bg-raised">
          <FolderPlus size={13} className="text-accent-green" />
          <input
            autoFocus
            className="input flex-1 text-xs"
            placeholder="Folder name"
            value={newFolderName}
            onChange={e => setNewFolderName(e.target.value)}
            onKeyDown={e => {
              if (e.key === 'Enter') handleCreateFolder()
              if (e.key === 'Escape') { setNewFolder(false); setNewFolderName('') }
            }}
          />
          <button onClick={handleCreateFolder} className="btn-primary text-xs">Create</button>
          <button onClick={() => { setNewFolder(false); setNewFolderName('') }} className="btn-ghost text-xs">Cancel</button>
        </div>
      )}

      {/* Move dialog (device) */}
      {moving && (
        <div className="border-b border-bg-border px-4 py-2 flex items-center gap-2 bg-bg-raised">
          <FolderInput size={13} className="text-accent-green" />
          <span className="text-xs text-text-muted shrink-0">Move <span className="text-text-secondary">{moving.name}</span> to:</span>
          <input
            autoFocus
            className="input flex-1 text-xs mono"
            placeholder="/sdcard/Destination"
            value={moveDest}
            onChange={e => setMoveDest(e.target.value)}
            onKeyDown={e => {
              if (e.key === 'Enter') handleMove()
              if (e.key === 'Escape') setMoving(null)
            }}
          />
          <button onClick={handleMove} className="btn-primary text-xs">Move</button>
          <button onClick={() => setMoving(null)} className="btn-ghost text-xs">Cancel</button>
        </div>
      )}

      {/* Push destination picker — shown after staging local files for push */}
      {pushStaged && isDevice && (
        <div className="border-b border-bg-border px-4 py-2 flex items-center gap-2 bg-accent-green/10">
          <Upload size={13} className="text-accent-green shrink-0" />
          <span className="text-xs text-text-secondary flex-1">
            Pushing {pushStaged.length} item(s) — browse to a destination folder, then push.
          </span>
          <span className="text-xs text-text-muted mono truncate max-w-[260px]">→ {path}</span>
          <button onClick={handlePushHere} className="btn-primary text-xs">Push here</button>
          <button onClick={() => setPushStaged(null)} className="btn-ghost text-xs">Cancel</button>
        </div>
      )}

      {/* File list header */}
      <div className="grid grid-cols-[24px_1fr_80px_100px_120px] gap-2 px-4 py-1.5 border-b border-bg-border text-text-muted text-xs">
        <input
          type="checkbox"
          checked={selected.size === files.length && files.length > 0}
          onChange={selectAll}
          className="accent-accent-green"
        />
        <span>Name</span>
        <span className="text-right">Size</span>
        <span>Permissions</span>
        <span>Modified</span>
      </div>

      {/* Files */}
      <div className="flex-1 overflow-auto">
        {loading && files.length === 0 && (
          <div className="flex items-center justify-center h-32">
            <div className="w-5 h-5 border-2 border-accent-green border-t-transparent rounded-full animate-spin" />
          </div>
        )}
        {!loading && files.length === 0 && (
          <div className="flex items-center justify-center h-32">
            <p className="text-text-muted text-sm">Empty directory</p>
          </div>
        )}
        {files.map(f => (
          <div
            key={f.name}
            onContextMenu={e => { e.preventDefault(); setMenu({ x: e.clientX, y: e.clientY, entry: f }) }}
            className={`
              grid grid-cols-[24px_1fr_80px_100px_120px] gap-2 px-4 py-1.5
              text-xs border-b border-bg-border/50 items-center
              hover:bg-bg-raised transition-colors group
              ${selected.has(f.name) ? 'bg-accent-green/5' : ''}
            `}
          >
            <input
              type="checkbox"
              checked={selected.has(f.name)}
              onChange={() => toggleSelect(f.name)}
              className="accent-accent-green"
            />

            {/* Name */}
            <div className="flex items-center gap-2 min-w-0">
              {f.type === 'Directory'
                ? <FolderOpen size={13} className="text-accent-green shrink-0" />
                : isImage(f.name)
                  ? <ImageIcon size={13} className="text-accent-green/70 shrink-0" />
                  : <File size={13} className="text-text-muted shrink-0" />
              }
              {renaming === f.name ? (
                <input
                  autoFocus
                  className="input py-0 px-1 text-xs flex-1"
                  value={renameValue}
                  onChange={e => setRenameValue(e.target.value)}
                  onBlur={handleRename}
                  onKeyDown={e => {
                    if (e.key === 'Enter') handleRename()
                    if (e.key === 'Escape') setRenaming(null)
                  }}
                />
              ) : (
                <span
                  className={`truncate cursor-pointer select-none hover:underline ${f.type === 'Directory' ? 'text-text-primary' : 'text-text-secondary'}`}
                  onClick={() => open(f)}
                  title={f.type === 'Directory' || f.type === 'Symlink' ? 'Open' : (isImage(f.name) ? 'Preview' : undefined)}
                >
                  {f.name}
                </span>
              )}
              {isDevice && (
                <button
                  onClick={() => startRename(f.name)}
                  className="opacity-0 group-hover:opacity-100 text-text-muted hover:text-text-secondary ml-auto shrink-0"
                  title="Rename"
                >
                  <Edit3 size={11} />
                </button>
              )}
            </div>

            <span className="text-right text-text-muted mono">
              {f.type === 'Directory' ? '—' : formatSize(f.size)}
            </span>
            <span className="mono text-text-muted">{f.permissions}</span>
            <span className="text-text-muted">{f.date} {f.time}</span>
          </div>
        ))}
      </div>

      {/* Right-click context menu */}
      {menu && (
        <div
          className="fixed z-50 min-w-[170px] py-1 rounded-md border border-bg-border bg-bg-surface shadow-lg text-xs"
          style={{ top: menu.y, left: menu.x }}
          onClick={e => e.stopPropagation()}
        >
          {(menu.entry.type === 'Directory' || menu.entry.type === 'Symlink') && (
            <MenuItem icon={<FolderOpen size={13} />} label="Open" onClick={() => { navigate(menu.entry); setMenu(null) }} />
          )}
          {isImage(menu.entry.name) && (
            <MenuItem icon={<ImageIcon size={13} />} label="Preview" onClick={() => { openViewer(menu.entry.name); setMenu(null) }} />
          )}
          {isDevice ? (
            <>
              <MenuItem icon={<Download size={13} />} label="Pull to folder…" onClick={() => { pull([fullPath(menu.entry.name)]); setMenu(null) }} />
              <MenuItem icon={<Edit3 size={13} />} label="Rename" onClick={() => { startRename(menu.entry.name); setMenu(null) }} />
              <MenuItem icon={<FolderInput size={13} />} label="Move to…" onClick={() => { setMoving(menu.entry); setMoveDest(path); setMenu(null) }} />
              <MenuItem icon={<Copy size={13} />} label="Copy path" onClick={() => { copyPath(menu.entry); setMenu(null) }} />
              <div className="my-1 h-px bg-bg-border" />
              <MenuItem icon={<Trash2 size={13} />} label="Delete" danger onClick={() => { del([fullPath(menu.entry.name)]); setMenu(null) }} />
            </>
          ) : (
            <>
              {menu.entry.type === 'File' && (
                <MenuItem icon={<Upload size={13} />} label="Push to device…" onClick={() => { startPush([fullPath(menu.entry.name)]); setMenu(null) }} />
              )}
              <MenuItem icon={<Copy size={13} />} label="Copy path" onClick={() => { copyPath(menu.entry); setMenu(null) }} />
            </>
          )}
        </div>
      )}

      {/* Image viewer — click anywhere (except the image or buttons) to close */}
      {viewer && (
        <div
          className="fixed inset-0 z-50 flex flex-col bg-black/85 backdrop-blur-sm"
          onClick={() => setViewer(null)}
        >
          <div className="flex items-center justify-between px-4 py-2 text-xs text-text-secondary shrink-0">
            <span className="mono truncate">{viewer}</span>
            <button onClick={e => { e.stopPropagation(); setViewer(null) }} className="btn-ghost p-1.5" title="Close (Esc)">
              <X size={16} />
            </button>
          </div>
          <div className="flex-1 flex items-center justify-center gap-3 overflow-hidden px-2 pb-4">
            <button onClick={e => { e.stopPropagation(); stepViewer(-1) }} className="btn-ghost p-2 shrink-0" title="Previous (←)">
              <ChevronLeft size={20} />
            </button>
            <div className="relative flex-1 h-full flex items-center justify-center overflow-hidden">
              {imgLoading && !imgError && (
                <div className="absolute w-6 h-6 border-2 border-accent-green border-t-transparent rounded-full animate-spin" />
              )}
              {imgError ? (
                <p className="text-text-muted text-sm">Couldn't load this image</p>
              ) : (
                <img
                  src={fileURL(viewer)}
                  alt={viewer}
                  onClick={e => e.stopPropagation()}
                  onLoad={() => setImgLoading(false)}
                  onError={() => { setImgLoading(false); setImgError(true) }}
                  className="max-h-full max-w-full object-contain rounded"
                />
              )}
            </div>
            <button onClick={e => { e.stopPropagation(); stepViewer(1) }} className="btn-ghost p-2 shrink-0" title="Next (→)">
              <ChevronRight size={20} />
            </button>
          </div>
        </div>
      )}

      {/* Text viewer — highlighted preview for text/code/config files */}
      {textView && (
        <div className="fixed inset-0 z-50 flex flex-col bg-black/85 backdrop-blur-sm" onClick={() => setTextView(null)}>
          <div className="flex items-center justify-between px-4 py-2 text-xs text-text-secondary shrink-0">
            <span className="mono truncate">{textView.name}</span>
            <button onClick={e => { e.stopPropagation(); setTextView(null) }} className="btn-ghost p-1.5" title="Close (Esc)">
              <X size={16} />
            </button>
          </div>
          <div className="flex-1 overflow-hidden px-4 pb-4" onClick={e => e.stopPropagation()}>
            <div className="h-full overflow-auto bg-bg-surface border border-bg-border rounded">
              {textLoading ? (
                <div className="flex items-center justify-center h-32">
                  <div className="w-5 h-5 border-2 border-accent-green border-t-transparent rounded-full animate-spin" />
                </div>
              ) : (
                <CodeView
                  code={textView.content}
                  lang={detectLang(textView.name, textView.content)}
                  className="mono text-xs text-text-secondary whitespace-pre-wrap break-words leading-relaxed p-3"
                />
              )}
            </div>
          </div>
        </div>
      )}

      {/* Status bar */}
      <div className="border-t border-bg-border px-4 py-1.5 flex items-center justify-between text-xs text-text-muted">
        <span className="mono flex items-center gap-1.5">
          {isDevice ? <Smartphone size={12} /> : <Monitor size={12} />}
          {path}
        </span>
        <span>{files.length} items{selected.size > 0 ? `, ${selected.size} selected` : ''}</span>
      </div>
    </div>
  )
}

function MenuItem({ icon, label, onClick, danger }: {
  icon: React.ReactNode; label: string; onClick: () => void; danger?: boolean
}) {
  return (
    <button
      onClick={onClick}
      className={`w-full flex items-center gap-2 px-3 py-1.5 text-left hover:bg-bg-raised ${
        danger ? 'text-danger' : 'text-text-secondary'
      }`}
    >
      {icon}{label}
    </button>
  )
}

function formatEta(ms: number): string {
  const s = Math.round(ms / 1000)
  if (s < 60) return `${s}s`
  return `${Math.floor(s / 60)}m ${String(s % 60).padStart(2, '0')}s`
}

function isImage(name: string): boolean {
  return /\.(png|jpe?g|gif|webp|bmp|ico)$/i.test(name)
}

function isText(name: string): boolean {
  return /\.(txt|xml|json|prop|conf|cfg|ini|env|log|sh|bash|rc|smali|java|kt|gradle|ya?ml|md|csv|html?|css|js|ts|toml|properties|list)$/i.test(name)
}
