import { useState, useEffect, useCallback } from 'react'
import {
  FolderOpen, File, ArrowLeft, RefreshCw, Upload,
  Download, Trash2, FolderPlus, Edit3, Copy
} from 'lucide-react'
import {
  ListFiles, PushFile, PullMultipleFiles, DeleteMultipleFiles,
  CreateFolder, RenameFile, CopyFile, SelectFileForPush, CancelOperation
} from '../../lib/wails'
import { notify } from '../../lib/notify'
import type { FileEntry } from '../../lib/types'

export default function ViewFiles() {
  const [path, setPath] = useState('/sdcard')
  const [pathInput, setPathInput] = useState('/sdcard')
  const [files, setFiles] = useState<FileEntry[]>([])
  const [loading, setLoading] = useState(false)
  const [selected, setSelected] = useState<Set<string>>(new Set())
  const [renaming, setRenaming] = useState<string | null>(null)
  const [renameValue, setRenameValue] = useState('')
  const [newFolder, setNewFolder] = useState(false)
  const [newFolderName, setNewFolderName] = useState('')

  const loadFiles = useCallback(async (p: string) => {
    setLoading(true)
    setSelected(new Set())
    try {
      const result = await ListFiles(p)
      setFiles(result || [])
    } catch (e: any) {
      notify.error(e)
      setFiles([])
    } finally {
      setLoading(false)
    }
  }, [])

  useEffect(() => { loadFiles(path) }, [path, loadFiles])

  const navigate = (entry: FileEntry) => {
    if (entry.type === 'Directory') {
      const next = path.endsWith('/') ? path + entry.name : path + '/' + entry.name
      setPath(next)
      setPathInput(next)
    }
  }

  const goUp = () => {
    const parts = path.split('/').filter(Boolean)
    if (parts.length === 0) return
    parts.pop()
    const next = '/' + parts.join('/')
    setPath(next || '/')
    setPathInput(next || '/')
  }

  const navigatePath = () => {
    setPath(pathInput)
    loadFiles(pathInput)
  }

  const toggleSelect = (name: string) => {
    setSelected(prev => {
      const next = new Set(prev)
      next.has(name) ? next.delete(name) : next.add(name)
      return next
    })
  }

  const selectAll = () => {
    if (selected.size === files.length) {
      setSelected(new Set())
    } else {
      setSelected(new Set(files.map(f => f.name)))
    }
  }

  const handlePush = async () => {
    const local = await SelectFileForPush()
    if (!local) return
    const id = notify.loading('Pushing file...')
    try {
      const out = await PushFile(local, path)
      notify.dismiss(id)
      notify.success(out || 'File pushed')
      loadFiles(path)
    } catch (e: any) {
      notify.dismiss(id)
      notify.error(e)
    }
  }

  const handlePull = async () => {
    if (selected.size === 0) { notify.error('Select files to pull'); return }
    const paths = [...selected].map(name =>
      path.endsWith('/') ? path + name : path + '/' + name
    )
    const id = notify.loading(`Pulling ${paths.length} item(s)...`)
    try {
      const out = await PullMultipleFiles(paths)
      notify.dismiss(id)
      notify.success(out)
    } catch (e: any) {
      notify.dismiss(id)
      notify.error(e)
    }
  }

  const handleDelete = async () => {
    if (selected.size === 0) { notify.error('Select files to delete'); return }
    const paths = [...selected].map(name =>
      path.endsWith('/') ? path + name : path + '/' + name
    )
    if (!confirm(`Delete ${paths.length} item(s)?`)) return
    const id = notify.loading('Deleting...')
    try {
      const out = await DeleteMultipleFiles(paths)
      notify.dismiss(id)
      notify.success(out)
      loadFiles(path)
    } catch (e: any) {
      notify.dismiss(id)
      notify.error(e)
    }
  }

  const handleCreateFolder = async () => {
    if (!newFolderName.trim()) return
    const fullPath = path.endsWith('/') ? path + newFolderName : path + '/' + newFolderName
    try {
      await CreateFolder(fullPath)
      notify.success('Folder created')
      setNewFolder(false)
      setNewFolderName('')
      loadFiles(path)
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
    const oldPath = path.endsWith('/') ? path + renaming : path + '/' + renaming
    const newPath = path.endsWith('/') ? path + renameValue : path + '/' + renameValue
    try {
      await RenameFile(oldPath, newPath)
      notify.success('Renamed')
      setRenaming(null)
      loadFiles(path)
    } catch (e: any) {
      notify.error(e)
    }
  }

  const formatSize = (size: string) => {
    const n = parseInt(size)
    if (isNaN(n)) return size
    if (n < 1024) return `${n} B`
    if (n < 1048576) return `${(n / 1024).toFixed(1)} KB`
    return `${(n / 1048576).toFixed(1)} MB`
  }

  return (
    <div className="flex flex-col h-full">
      {/* Toolbar */}
      <div className="border-b border-bg-border px-4 py-2 flex items-center gap-2 shrink-0">
        <button onClick={goUp} className="btn-ghost p-1.5" title="Go up">
          <ArrowLeft size={14} />
        </button>
        <input
          className="input flex-1 text-xs mono"
          value={pathInput}
          onChange={e => setPathInput(e.target.value)}
          onKeyDown={e => e.key === 'Enter' && navigatePath()}
          placeholder="/sdcard"
        />
        <button onClick={() => loadFiles(path)} disabled={loading} className="btn-ghost p-1.5">
          <RefreshCw size={14} className={loading ? 'animate-spin' : ''} />
        </button>

        <div className="w-px h-5 bg-bg-border mx-1" />

        <button onClick={handlePush} className="btn-ghost text-xs">
          <Upload size={13} /> Push
        </button>
        <button onClick={handlePull} disabled={selected.size === 0} className="btn-ghost text-xs">
          <Download size={13} /> Pull {selected.size > 0 ? `(${selected.size})` : ''}
        </button>
        <button onClick={() => setNewFolder(true)} className="btn-ghost text-xs">
          <FolderPlus size={13} /> New Folder
        </button>
        <button onClick={handleDelete} disabled={selected.size === 0} className="btn-danger text-xs">
          <Trash2 size={13} /> Delete {selected.size > 0 ? `(${selected.size})` : ''}
        </button>
        {loading && (
          <button onClick={() => CancelOperation()} className="btn-warn text-xs">Cancel</button>
        )}
      </div>

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
                  className={`truncate cursor-pointer ${f.type === 'Directory' ? 'text-text-primary' : 'text-text-secondary'}`}
                  onDoubleClick={() => navigate(f)}
                >
                  {f.name}
                </span>
              )}
              <button
                onClick={() => startRename(f.name)}
                className="opacity-0 group-hover:opacity-100 text-text-muted hover:text-text-secondary ml-auto shrink-0"
                title="Rename"
              >
                <Edit3 size={11} />
              </button>
            </div>

            <span className="text-right text-text-muted mono">
              {f.type === 'Directory' ? '—' : formatSize(f.size)}
            </span>
            <span className="mono text-text-muted">{f.permissions}</span>
            <span className="text-text-muted">{f.date} {f.time}</span>
          </div>
        ))}
      </div>

      {/* Status bar */}
      <div className="border-t border-bg-border px-4 py-1.5 flex items-center justify-between text-xs text-text-muted">
        <span className="mono">{path}</span>
        <span>{files.length} items{selected.size > 0 ? `, ${selected.size} selected` : ''}</span>
      </div>
    </div>
  )
}
