import { useState, useEffect, useMemo } from 'react'
import { RefreshCw, Search, Edit3, Check, X, ChevronDown, ChevronRight } from 'lucide-react'
import { GetAllProps, SetProp } from '../../lib/wails'
import { notify } from '../../lib/notify'
import type { PropEntry } from '../../lib/types'

export default function ViewProps() {
  const [props, setProps]           = useState<PropEntry[]>([])
  const [loading, setLoading]       = useState(false)
  const [search, setSearch]         = useState('')
  const [catFilter, setCatFilter]   = useState('All')
  const [editing, setEditing]       = useState<string | null>(null)
  const [editValue, setEditValue]   = useState('')
  const [openCats, setOpenCats]     = useState<Set<string>>(new Set(['Build', 'Product', 'Boot']))

  const load = async () => {
    setLoading(true)
    try {
      const data = await GetAllProps()
      setProps(data || [])
    } catch (e: any) {
      notify.error(e)
    } finally {
      setLoading(false)
    }
  }

  useEffect(() => { load() }, [])

  const categories = useMemo(() => {
    const cats = [...new Set(props.map(p => p.category))].sort()
    return ['All', ...cats]
  }, [props])

  const filtered = useMemo(() =>
    props.filter(p => {
      if (catFilter !== 'All' && p.category !== catFilter) return false
      if (search) {
        const q = search.toLowerCase()
        return p.key.toLowerCase().includes(q) || p.value.toLowerCase().includes(q)
      }
      return true
    }),
    [props, search, catFilter]
  )

  const grouped = useMemo(() => {
    const groups: Record<string, PropEntry[]> = {}
    for (const p of filtered) {
      if (!groups[p.category]) groups[p.category] = []
      groups[p.category].push(p)
    }
    return groups
  }, [filtered])

  const toggleCat = (cat: string) => setOpenCats(prev => {
    const next = new Set(prev)
    next.has(cat) ? next.delete(cat) : next.add(cat)
    return next
  })

  const startEdit = (prop: PropEntry) => {
    setEditing(prop.key)
    setEditValue(prop.value)
  }

  const saveEdit = async (key: string) => {
    if (!editing) return
    const id = notify.loading(`Setting ${key}...`)
    try {
      const out = await SetProp(key, editValue)
      notify.dismiss(id)
      notify.success(out)
      setEditing(null)
      // Update local state immediately
      setProps(prev => prev.map(p => p.key === key ? { ...p, value: editValue } : p))
    } catch (e: any) {
      notify.dismiss(id)
      notify.error(e)
    }
  }

  const cancelEdit = () => {
    setEditing(null)
    setEditValue('')
  }

  return (
    <div className="flex flex-col h-full overflow-hidden">
      {/* Toolbar */}
      <div className="border-b border-bg-border px-4 py-2 flex items-center gap-2 shrink-0 flex-wrap">
        <div className="relative flex-1 min-w-0">
          <Search size={12} className="absolute left-2.5 top-1/2 -translate-y-1/2 text-text-muted" />
          <input
            className="input pl-7 text-xs w-full"
            placeholder="Search properties..."
            value={search}
            onChange={e => setSearch(e.target.value)}
          />
        </div>

        <select
          className="input text-xs w-36 py-1 shrink-0"
          value={catFilter}
          onChange={e => setCatFilter(e.target.value)}
        >
          {categories.map(c => <option key={c} value={c}>{c}</option>)}
        </select>

        <button onClick={load} disabled={loading} className="btn-ghost text-xs shrink-0">
          <RefreshCw size={12} className={loading ? 'animate-spin' : ''} />
          {loading ? 'Loading...' : 'Refresh'}
        </button>

        <span className="text-xs text-text-muted shrink-0">
          {filtered.length} / {props.length} props
        </span>
      </div>

      {/* Props list */}
      <div className="flex-1 overflow-auto">
        {loading && props.length === 0 && (
          <div className="flex items-center justify-center h-32">
            <div className="w-5 h-5 border-2 border-accent-green border-t-transparent rounded-full animate-spin" />
          </div>
        )}

        {!loading && props.length === 0 && (
          <div className="flex items-center justify-center h-32 text-text-muted text-sm">
            Connect a device and click Refresh
          </div>
        )}

        {catFilter === 'All'
          ? Object.entries(grouped).map(([cat, catProps]) => (
              <div key={cat} className="border-b border-bg-border/50">
                <button
                  onClick={() => toggleCat(cat)}
                  className="w-full flex items-center gap-2 px-4 py-2 hover:bg-bg-raised transition-colors"
                >
                  {openCats.has(cat)
                    ? <ChevronDown size={12} className="text-accent-green shrink-0" />
                    : <ChevronRight size={12} className="text-text-muted shrink-0" />
                  }
                  <span className="text-xs font-medium text-text-primary">{cat}</span>
                  <span className="text-xs text-text-muted">{catProps.length}</span>
                </button>

                {openCats.has(cat) && catProps.map(p => (
                  <PropRow
                    key={p.key}
                    prop={p}
                    editing={editing === p.key}
                    editValue={editValue}
                    onEdit={startEdit}
                    onSave={saveEdit}
                    onCancel={cancelEdit}
                    onEditValueChange={setEditValue}
                  />
                ))}
              </div>
            ))
          : filtered.map(p => (
              <PropRow
                key={p.key}
                prop={p}
                editing={editing === p.key}
                editValue={editValue}
                onEdit={startEdit}
                onSave={saveEdit}
                onCancel={cancelEdit}
                onEditValueChange={setEditValue}
              />
            ))
        }
      </div>
    </div>
  )
}

interface PropRowProps {
  prop: PropEntry
  editing: boolean
  editValue: string
  onEdit: (p: PropEntry) => void
  onSave: (key: string) => void
  onCancel: () => void
  onEditValueChange: (v: string) => void
}

function PropRow({ prop, editing, editValue, onEdit, onSave, onCancel, onEditValueChange }: PropRowProps) {
  const isReadOnly = prop.key.startsWith('ro.')

  return (
    <div className={`flex items-center gap-3 px-4 py-1.5 border-t border-bg-border/30 group hover:bg-bg-raised transition-colors ${editing ? 'bg-accent-green/5' : ''}`}>
      <div className="flex-1 min-w-0 grid grid-cols-2 gap-4">
        <span className="mono text-xs text-text-secondary truncate" title={prop.key}>
          {prop.key}
        </span>
        {editing ? (
          <input
            autoFocus
            className="input text-xs py-0.5"
            value={editValue}
            onChange={e => onEditValueChange(e.target.value)}
            onKeyDown={e => {
              if (e.key === 'Enter') onSave(prop.key)
              if (e.key === 'Escape') onCancel()
            }}
          />
        ) : (
          <span className="mono text-xs text-text-primary truncate" title={prop.value}>
            {prop.value || '(empty)'}
          </span>
        )}
      </div>

      <div className="shrink-0 flex items-center gap-1">
        {isReadOnly && <span className="badge-gray text-xs">ro</span>}
        {editing ? (
          <>
            <button onClick={() => onSave(prop.key)} className="text-accent-green hover:text-accent-dim">
              <Check size={13} />
            </button>
            <button onClick={onCancel} className="text-text-muted hover:text-danger">
              <X size={13} />
            </button>
          </>
        ) : (
          <button
            onClick={() => onEdit(prop)}
            className="opacity-0 group-hover:opacity-100 text-text-muted hover:text-text-secondary transition-opacity"
            title={isReadOnly ? 'Read-only (may require root)' : 'Edit value'}
          >
            <Edit3 size={11} />
          </button>
        )}
      </div>
    </div>
  )
}
