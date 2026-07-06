import { useState, useEffect, useRef, useCallback, useMemo } from 'react'
import { Play, Square, Trash2, Download, Filter, ChevronDown, List, Share2, Highlighter, Plus, X } from 'lucide-react'
import { StartLogcat, StopLogcat, ClearLogcat, SaveTextFile } from '../../lib/wails'
import { notify } from '../../lib/notify'
import LogcatMap from './LogcatMap'
import type { LogcatLine } from '../../lib/types'
import {
  loadHighlightRules, saveHighlightRules, compileRules, scrubSensitive,
  HI_SWATCH, type HighlightRule, type HiColor,
} from '../../lib/logcat_tools'

const HI_COLORS: HiColor[] = ['red', 'amber', 'green', 'blue', 'purple', 'pink']

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

const BUFFERS = ['main', 'system', 'radio', 'events', 'crash', 'default', 'all']
const REFRESH_OPTS: [number, string][] = [[0, 'Live'], [250, '250ms'], [500, '500ms'], [1000, '1s'], [2000, '2s']]
const MAX_LINE_OPTS = [1000, 5000, 20000, 100000]

export default function ViewLogcat() {
  const [lines, setLines]           = useState<LogcatLine[]>([])
  const [running, setRunning]       = useState(false)
  const [filter, setFilter]         = useState('')
  const [tagFilter, setTagFilter]   = useState('')
  const [levelFilter, setLevelFilter] = useState<string[]>([])
  const [buffer, setBuffer]         = useState('main')
  const [refreshMs, setRefreshMs]   = useState(0)
  const [maxLines, setMaxLines]     = useState(5000)
  const pendingRef                  = useRef<LogcatLine[]>([])
  const [autoScroll, setAutoScroll] = useState(true)
  const [search, setSearch]         = useState('')
  const [showFilters, setShowFilters] = useState(false)
  const [viewMode, setViewMode]     = useState<'text' | 'map'>('text')
  const [showHighlights, setShowHighlights] = useState(false)
  const [hiRules, setHiRules]       = useState<HighlightRule[]>(() => loadHighlightRules())
  const [newPattern, setNewPattern] = useState('')
  const [newMode, setNewMode]       = useState<'contains' | 'regex'>('contains')
  const [newColor, setNewColor]     = useState<HiColor>('red')
  const [scrubExport, setScrubExport] = useState(true)
  const mapSinkRef                  = useRef<((l: LogcatLine) => void) | null>(null)
  const bottomRef                   = useRef<HTMLDivElement>(null)
  const containerRef                = useRef<HTMLDivElement>(null)

  // The map subscribes to the same stream via this sink (registered on mount).
  const registerMapSink = useCallback((fn: ((l: LogcatLine) => void) | null) => { mapSinkRef.current = fn }, [])
  const inspectEntity = useCallback((e: { kind: 'pid' | 'tag'; value: string; label: string }) => {
    if (e.kind === 'tag') { setTagFilter(e.value); setSearch('') }
    else { setSearch(e.value); setTagFilter('') }
    setViewMode('text'); setShowFilters(true)
  }, [])

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
    mapSinkRef.current?.(line) // always feed the visual map at full rate
    if (refreshMs > 0) { pendingRef.current.push(line); return } // batched flush below
    setLines(prev => {
      const next = [...prev, line]
      return next.length > maxLines ? next.slice(next.length - maxLines) : next
    })
  }, [refreshMs, maxLines])

  // Batched render: flush queued lines on the chosen interval instead of per-line.
  useEffect(() => {
    if (refreshMs <= 0) return
    const id = setInterval(() => {
      if (pendingRef.current.length === 0) return
      const batch = pendingRef.current
      pendingRef.current = []
      setLines(prev => {
        const next = prev.concat(batch)
        return next.length > maxLines ? next.slice(next.length - maxLines) : next
      })
    }, refreshMs)
    return () => clearInterval(id)
  }, [refreshMs, maxLines])

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

  const saveLog = async () => {
    // Export the currently-visible (filtered) lines, optionally scrubbing
    // sensitive identifiers (IMEIs, phone numbers, SIM serials, MACs, emails).
    let text = filteredLines.map(l => l.raw).join('\n')
    if (scrubExport) text = scrubSensitive(text)
    const stamp = new Date().toISOString().slice(0, 19).replace(/[:T]/g, '-')
    const name = `logcat_${stamp}${scrubExport ? '_scrubbed' : ''}.txt`
    try {
      const saved = await SaveTextFile(name, text)
      if (saved) notify.success(`Saved ${scrubExport ? '(scrubbed) ' : ''}to ${saved}`)
    } catch (e: any) {
      notify.error(e)
    }
  }

  // Compiled highlight matchers (recompiled only when rules change).
  const compiled = useMemo(() => compileRules(hiRules), [hiRules])
  const highlightFor = useCallback((raw: string): string => {
    for (const c of compiled) if (c.test(raw)) return c.style
    return ''
  }, [compiled])

  const addRule = () => {
    if (!newPattern.trim()) return
    const rule: HighlightRule = {
      id: `${Date.now()}-${Math.round(Math.random() * 1e6)}`,
      pattern: newPattern.trim(), mode: newMode, color: newColor,
    }
    const next = [...hiRules, rule]
    setHiRules(next); saveHighlightRules(next); setNewPattern('')
  }
  const removeRule = (id: string) => {
    const next = hiRules.filter(r => r.id !== id)
    setHiRules(next); saveHighlightRules(next)
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
            title="Log buffer"
          >
            {BUFFERS.map(b => <option key={b} value={b}>{b}</option>)}
          </select>
        </div>

        {/* Refresh rate (UI flush interval) */}
        <select
          className="input text-xs w-20 py-1"
          value={refreshMs}
          onChange={e => setRefreshMs(Number(e.target.value))}
          title="Refresh rate — how often the view updates"
        >
          {REFRESH_OPTS.map(([v, l]) => <option key={v} value={v}>{l}</option>)}
        </select>

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

        <button onClick={saveLog} disabled={filteredLines.length === 0} className="btn-ghost text-xs" title={scrubExport ? 'Save visible lines to .txt (sensitive IDs scrubbed)' : 'Save visible lines to .txt'}>
          <Download size={12} /> Save .txt
        </button>
        <label className="flex items-center gap-1 text-xs text-text-muted cursor-pointer" title="Redact IMEIs, phone numbers, SIM serials, MACs and emails from the exported file">
          <input type="checkbox" checked={scrubExport} onChange={e => setScrubExport(e.target.checked)} className="accent-accent-green" />
          Scrub
        </label>

        {/* Text / Map view toggle */}
        <div className="flex rounded overflow-hidden border border-bg-border ml-1">
          <button
            onClick={() => setViewMode('text')}
            className={`px-2 py-1 text-xs flex items-center gap-1 ${viewMode === 'text' ? 'bg-accent-green/20 text-accent-green' : 'text-text-muted hover:bg-bg-raised'}`}
            title="Text log"
          >
            <List size={12} /> Text
          </button>
          <button
            onClick={() => setViewMode('map')}
            className={`px-2 py-1 text-xs flex items-center gap-1 ${viewMode === 'map' ? 'bg-accent-green/20 text-accent-green' : 'text-text-muted hover:bg-bg-raised'}`}
            title="Live visual map"
          >
            <Share2 size={12} /> Map
          </button>
        </div>

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

        <button
          onClick={() => setShowHighlights(v => !v)}
          className={`btn-ghost text-xs ${showHighlights ? 'text-accent-green' : ''}`}
          title="Highlight rules — colour lines that match a pattern"
        >
          <Highlighter size={12} /> Highlight{hiRules.length > 0 ? ` (${hiRules.length})` : ''}
          <ChevronDown size={10} className={showHighlights ? 'rotate-180' : ''} />
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
            <span className="text-xs text-text-muted cursor-help" title="Android log severity: V=Verbose, D=Debug, I=Info, W=Warning, E=Error, F=Fatal. Click letters to filter.">Level:</span>
            {([['V', 'Verbose'], ['D', 'Debug'], ['I', 'Info'], ['W', 'Warning'], ['E', 'Error'], ['F', 'Fatal']] as const).map(([level, name]) => (
              <button
                key={level}
                onClick={() => toggleLevel(level)}
                title={`${name}${levelFilter.includes(level) ? ' (filtering)' : ''} — click to ${levelFilter.includes(level) ? 'remove' : 'show only'} this level`}
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

          {/* Max lines kept in memory */}
          <div className="flex items-center gap-2">
            <span className="text-xs text-text-muted">Max lines:</span>
            <select className="input text-xs w-24" value={maxLines} onChange={e => setMaxLines(Number(e.target.value))}>
              {MAX_LINE_OPTS.map(n => <option key={n} value={n}>{n.toLocaleString()}</option>)}
            </select>
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

      {/* Highlight rules panel */}
      {showHighlights && (
        <div className="border-b border-bg-border px-4 py-2 bg-bg-raised shrink-0 space-y-2">
          <div className="flex items-center gap-2 flex-wrap">
            <span className="text-xs text-text-muted">Add rule:</span>
            <input
              className="input text-xs w-56"
              placeholder="Text or /regex/ to match, e.g. FATAL"
              value={newPattern}
              onChange={e => setNewPattern(e.target.value)}
              onKeyDown={e => e.key === 'Enter' && addRule()}
            />
            <select className="input text-xs w-24 py-1" value={newMode} onChange={e => setNewMode(e.target.value as 'contains' | 'regex')}>
              <option value="contains">contains</option>
              <option value="regex">regex</option>
            </select>
            <div className="flex items-center gap-1">
              {HI_COLORS.map(c => (
                <button
                  key={c}
                  onClick={() => setNewColor(c)}
                  title={c}
                  className={`w-5 h-5 rounded-full border-2 transition-transform ${newColor === c ? 'border-text-primary scale-110' : 'border-transparent'}`}
                  style={{ backgroundColor: HI_SWATCH[c] }}
                />
              ))}
            </div>
            <button onClick={addRule} disabled={!newPattern.trim()} className="btn-ghost text-xs">
              <Plus size={12} /> Add
            </button>
          </div>

          {hiRules.length === 0 ? (
            <p className="text-xs text-text-muted">
              No highlight rules. Add one to colour matching lines (e.g. "FATAL" → red). Rules are saved and applied live.
            </p>
          ) : (
            <div className="flex flex-wrap gap-2">
              {hiRules.map(r => (
                <div key={r.id} className="flex items-center gap-1.5 rounded border border-bg-border px-2 py-1" style={{ backgroundColor: `${HI_SWATCH[r.color]}22` }}>
                  <span className="w-3 h-3 rounded-full shrink-0" style={{ backgroundColor: HI_SWATCH[r.color] }} />
                  <span className="mono text-xs text-text-primary">{r.pattern}</span>
                  <span className="text-[10px] text-text-muted">{r.mode}</span>
                  <button onClick={() => removeRule(r.id)} className="text-text-muted hover:text-danger" title="Remove rule">
                    <X size={11} />
                  </button>
                </div>
              ))}
            </div>
          )}
        </div>
      )}

      {/* Visual map — kept mounted so it keeps ingesting the stream; hidden in text mode */}
      <LogcatMap running={running} registerSink={registerMapSink} onInspectEntity={inspectEntity} hidden={viewMode !== 'map'} search={search} />

      {/* Log output */}
      <div
        ref={containerRef}
        onScroll={handleScroll}
        className={`flex-1 overflow-auto bg-bg-base p-2 font-mono text-xs ${viewMode === 'map' ? 'hidden' : ''}`}
      >
        {filteredLines.length === 0 && (
          <div className="flex items-center justify-center h-32 text-text-muted">
            {running ? 'Waiting for log output...' : 'Press Start to begin streaming logcat'}
          </div>
        )}
        {filteredLines.map((line, i) => {
          const hi = highlightFor(line.raw)
          return (
            <div
              key={i}
              className={`flex gap-2 px-1 py-0.5 rounded leading-relaxed hover:bg-bg-raised ${hi || LEVEL_BG[line.level] || ''}`}
            >
              <span className="text-text-muted shrink-0 w-20 truncate">{line.time}</span>
              <span className="text-text-muted shrink-0 w-10 truncate">{line.pid}</span>
              <span className={`shrink-0 w-4 font-bold ${LEVEL_COLORS[line.level] || 'text-text-muted'}`}>
                {line.level}
              </span>
              <span className="text-warn shrink-0 w-32 truncate">{line.tag}</span>
              <span className={`flex-1 break-all ${hi ? '' : LEVEL_COLORS[line.level] || 'text-text-secondary'}`}>
                {line.message || line.raw}
              </span>
            </div>
          )
        })}
        <div ref={bottomRef} />
      </div>
    </div>
  )
}
