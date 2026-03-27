import { useState, useEffect, useRef, useCallback } from 'react'
import { Play, Square, Trash2, Download, Filter, ChevronDown } from 'lucide-react'
import { StartLogcat, StopLogcat, ClearLogcat } from '../../lib/wails'
import { notify } from '../../lib/notify'
import type { LogcatLine } from '../../lib/types'

// @ts-ignore
const { EventsOn, EventsOff } = window['runtime'] || {}

const LEVEL_COLORS: Record<string, string> = {
  V: 'text-text-muted',
  D: 'text-blue-400',
  I: 'text-accent-green',
  W: 'text-warn',
  E: 'text-danger',
  F: 'text-red-300',
  S: 'text-text-muted',
}

const LEVEL_BG: Record<string, string> = {
  E: 'bg-danger/5',
  F: 'bg-red-900/20',
  W: 'bg-warn/5',
}

const BUFFERS = ['main', 'radio', 'events', 'crash', 'all']
const MAX_LINES = 5000

export default function ViewLogcat() {
  const [lines, setLines]           = useState<LogcatLine[]>([])
  const [running, setRunning]       = useState(false)
  const [filter, setFilter]         = useState('')
  const [tagFilter, setTagFilter]   = useState('')
  const [levelFilter, setLevelFilter] = useState<string[]>([])
  const [buffer, setBuffer]         = useState('main')
  const [autoScroll, setAutoScroll] = useState(true)
  const [search, setSearch]         = useState('')
  const [showFilters, setShowFilters] = useState(false)
  const bottomRef                   = useRef<HTMLDivElement>(null)
  const containerRef                = useRef<HTMLDivElement>(null)

  // Wails runtime event bridge
  const useWailsEvent = (event: string, handler: (data: any) => void) => {
    useEffect(() => {
      // @ts-ignore
      const cleanup = window['runtime']?.EventsOn?.(event, handler)
      return () => {
        // @ts-ignore
        window['runtime']?.EventsOff?.(event)
        cleanup?.()
      }
    }, [event, handler])
  }

  const handleLine = useCallback((line: LogcatLine) => {
    setLines(prev => {
      const next = [...prev, line]
      return next.length > MAX_LINES ? next.slice(next.length - MAX_LINES) : next
    })
  }, [])

  const handleStopped = useCallback(() => {
    setRunning(false)
  }, [])

  useEffect(() => {
    // @ts-ignore
    window['runtime']?.EventsOn?.('logcat:line', handleLine)
    // @ts-ignore
    window['runtime']?.EventsOn?.('logcat:stopped', handleStopped)
    return () => {
      // @ts-ignore
      window['runtime']?.EventsOff?.('logcat:line')
      // @ts-ignore
      window['runtime']?.EventsOff?.('logcat:stopped')
    }
  }, [handleLine, handleStopped])

  useEffect(() => {
    if (autoScroll && bottomRef.current) {
      bottomRef.current.scrollIntoView({ behavior: 'smooth' })
    }
  }, [lines, autoScroll])

  const handleScroll = () => {
    if (!containerRef.current) return
    const { scrollTop, scrollHeight, clientHeight } = containerRef.current
    const atBottom = scrollHeight - scrollTop - clientHeight < 100
    setAutoScroll(atBottom)
  }

  const start = async () => {
    try {
      setLines([])
      await StartLogcat(filter, buffer)
      setRunning(true)
    } catch (e: any) {
      notify.error(e)
    }
  }

  const stop = () => {
    StopLogcat()
    setRunning(false)
  }

  const clear = async () => {
    try {
      await ClearLogcat()
      setLines([])
      notify.success('Logcat cleared')
    } catch (e: any) {
      notify.error(e)
    }
  }

  const saveLog = () => {
    const text = lines.map(l => l.raw).join('\n')
    const blob = new Blob([text], { type: 'text/plain' })
    const url = URL.createObjectURL(blob)
    const a = document.createElement('a')
    a.href = url
    a.download = `logcat_${Date.now()}.txt`
    a.click()
    URL.revokeObjectURL(url)
  }

  const filteredLines = lines.filter(line => {
    if (levelFilter.length > 0 && !levelFilter.includes(line.level)) return false
    if (tagFilter && !line.tag.toLowerCase().includes(tagFilter.toLowerCase())) return false
    if (search && !line.raw.toLowerCase().includes(search.toLowerCase())) return false
    return true
  })

  const toggleLevel = (level: string) => {
    setLevelFilter(prev =>
      prev.includes(level) ? prev.filter(l => l !== level) : [...prev, level]
    )
  }

  return (
    <div className="flex flex-col h-full overflow-hidden">
      {/* Toolbar */}
      <div className="border-b border-bg-border px-4 py-2 flex items-center gap-2 shrink-0 flex-wrap">
        {/* Buffer selector */}
        <div className="relative">
          <select
            className="input text-xs w-24 py-1"
            value={buffer}
            onChange={e => setBuffer(e.target.value)}
            disabled={running}
          >
            {BUFFERS.map(b => <option key={b} value={b}>{b}</option>)}
          </select>
        </div>

        {/* Start/Stop */}
        {!running ? (
          <button onClick={start} className="btn-primary text-xs">
            <Play size={12} /> Start
          </button>
        ) : (
          <button onClick={stop} className="btn-danger text-xs">
            <Square size={12} /> Stop
          </button>
        )}

        <button onClick={clear} className="btn-ghost text-xs">
          <Trash2 size={12} /> Clear
        </button>

        <button onClick={saveLog} disabled={lines.length === 0} className="btn-ghost text-xs">
          <Download size={12} /> Save
        </button>

        <div className="w-px h-5 bg-bg-border" />

        {/* Search */}
        <input
          className="input text-xs w-48"
          placeholder="Search output..."
          value={search}
          onChange={e => setSearch(e.target.value)}
        />

        <button
          onClick={() => setShowFilters(v => !v)}
          className={`btn-ghost text-xs ${showFilters ? 'text-accent-green' : ''}`}
        >
          <Filter size={12} /> Filters
          <ChevronDown size={10} className={showFilters ? 'rotate-180' : ''} />
        </button>

        <div className="flex-1" />

        {/* Status */}
        <div className="flex items-center gap-2 text-xs text-text-muted">
          {running && <span className="status-dot status-dot-green" />}
          <span>{filteredLines.length} lines{search || tagFilter || levelFilter.length > 0 ? ' (filtered)' : ''}</span>
          <label className="flex items-center gap-1 cursor-pointer">
            <input type="checkbox" checked={autoScroll} onChange={e => setAutoScroll(e.target.checked)} className="accent-accent-green" />
            Auto-scroll
          </label>
        </div>
      </div>

      {/* Filter panel */}
      {showFilters && (
        <div className="border-b border-bg-border px-4 py-2 flex items-center gap-4 bg-bg-raised shrink-0 flex-wrap">
          {/* Level filter */}
          <div className="flex items-center gap-1">
            <span className="text-xs text-text-muted">Level:</span>
            {['V', 'D', 'I', 'W', 'E', 'F'].map(level => (
              <button
                key={level}
                onClick={() => toggleLevel(level)}
                className={`w-6 h-6 rounded text-xs font-mono font-bold transition-colors ${
                  levelFilter.includes(level)
                    ? 'bg-accent-green/20 text-accent-green'
                    : `${LEVEL_COLORS[level]} hover:bg-bg-raised`
                }`}
              >
                {level}
              </button>
            ))}
          </div>

          {/* Tag filter */}
          <div className="flex items-center gap-2">
            <span className="text-xs text-text-muted">Tag:</span>
            <input
              className="input text-xs w-40"
              placeholder="Filter by tag..."
              value={tagFilter}
              onChange={e => setTagFilter(e.target.value)}
            />
          </div>

          {/* ADB filter string */}
          <div className="flex items-center gap-2">
            <span className="text-xs text-text-muted">ADB filter:</span>
            <input
              className="input text-xs w-48"
              placeholder="e.g. ActivityManager:I *:S"
              value={filter}
              onChange={e => setFilter(e.target.value)}
              disabled={running}
            />
          </div>

          {(levelFilter.length > 0 || tagFilter || search) && (
            <button
              onClick={() => { setLevelFilter([]); setTagFilter(''); setSearch('') }}
              className="btn-ghost text-xs"
            >
              Clear filters
            </button>
          )}
        </div>
      )}

      {/* Log output */}
      <div
        ref={containerRef}
        onScroll={handleScroll}
        className="flex-1 overflow-auto bg-bg-base p-2 font-mono text-xs"
      >
        {filteredLines.length === 0 && (
          <div className="flex items-center justify-center h-32 text-text-muted">
            {running ? 'Waiting for log output...' : 'Press Start to begin streaming logcat'}
          </div>
        )}
        {filteredLines.map((line, i) => (
          <div
            key={i}
            className={`flex gap-2 px-1 py-0.5 rounded leading-relaxed hover:bg-bg-raised ${LEVEL_BG[line.level] || ''}`}
          >
            <span className="text-text-muted shrink-0 w-20 truncate">{line.time}</span>
            <span className="text-text-muted shrink-0 w-10 truncate">{line.pid}</span>
            <span className={`shrink-0 w-4 font-bold ${LEVEL_COLORS[line.level] || 'text-text-muted'}`}>
              {line.level}
            </span>
            <span className="text-warn shrink-0 w-32 truncate">{line.tag}</span>
            <span className={`flex-1 break-all ${LEVEL_COLORS[line.level] || 'text-text-secondary'}`}>
              {line.message || line.raw}
            </span>
          </div>
        ))}
        <div ref={bottomRef} />
      </div>
    </div>
  )
}
