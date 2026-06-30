import { useState, useRef, useEffect } from 'react'
import { Terminal, Trash2, ChevronRight, ChevronDown, Library, Search, Copy, Save } from 'lucide-react'
import { RunShellCommand, RunAdbHostCommand, SaveTextFile } from '../../lib/wails'
import { notify } from '../../lib/notify'
import { CATEGORIES, type Command } from './ViewUtilities'

interface HistoryEntry {
  cmd: string
  output: string
  error?: boolean
  mode: 'shell' | 'adb'
}

export default function ViewShell() {
  const [history, setHistory] = useState<HistoryEntry[]>([
    { cmd: '', output: 'Commands run via adb shell (no pipes/redirects — args are split directly, no shell injection)\nSwitch to "adb" mode to run adb host commands (e.g. adb devices, adb logcat)\nClick "Commands" to browse the command library and drop one into the prompt.', mode: 'shell' }
  ])
  const [input, setInput] = useState('')
  const [mode, setMode] = useState<'shell' | 'adb'>('shell')
  const [loading, setLoading] = useState(false)
  const [cmdHistory, setCmdHistory] = useState<string[]>([])
  const [historyIdx, setHistoryIdx] = useState(-1)
  const [showLib, setShowLib] = useState(false)
  const [libSearch, setLibSearch] = useState('')
  const [openCats, setOpenCats] = useState<Set<string>>(new Set())
  const bottomRef = useRef<HTMLDivElement>(null)
  const inputRef = useRef<HTMLInputElement>(null)

  useEffect(() => {
    bottomRef.current?.scrollIntoView({ behavior: 'smooth' })
  }, [history])

  const run = async () => {
    const cmd = input.trim()
    if (!cmd) return

    setCmdHistory(prev => [cmd, ...prev.slice(0, 99)])
    setHistoryIdx(-1)
    setInput('')
    setLoading(true)

    try {
      let output: string
      if (mode === 'shell') {
        output = await RunShellCommand(cmd)
      } else {
        output = await RunAdbHostCommand(cmd)
      }
      setHistory(prev => [...prev, { cmd, output: output || '(no output)', mode }])
    } catch (e: any) {
      setHistory(prev => [...prev, { cmd, output: String(e), error: true, mode }])
    } finally {
      setLoading(false)
    }
  }

  const onKeyDown = (e: React.KeyboardEvent) => {
    if (e.key === 'Enter') {
      run()
      return
    }
    if (e.key === 'ArrowUp') {
      e.preventDefault()
      const next = Math.min(historyIdx + 1, cmdHistory.length - 1)
      setHistoryIdx(next)
      setInput(cmdHistory[next] || '')
    }
    if (e.key === 'ArrowDown') {
      e.preventDefault()
      const next = Math.max(historyIdx - 1, -1)
      setHistoryIdx(next)
      setInput(next === -1 ? '' : cmdHistory[next])
    }
  }

  // Library commands are stored as adb host args (e.g. "shell getprop ..."),
  // so dropping one into the prompt = adb host mode + the full string. That way
  // the user never has to pick shell-vs-host; it's set for them.
  const pickCommand = (cmd: Command) => {
    setMode('adb')
    setInput(cmd.cmd)
    setHistoryIdx(-1)
    inputRef.current?.focus()
  }

  const toggleCat = (name: string) => {
    setOpenCats(prev => {
      const next = new Set(prev)
      next.has(name) ? next.delete(name) : next.add(name)
      return next
    })
  }

  // Whole-session transcript: each command and its output, blank-line separated.
  const transcript = () =>
    history.map(e => (e.cmd ? `[${e.mode}]$ ${e.cmd}\n` : '') + e.output).join('\n\n').trim()

  const hasSession = history.some(e => e.cmd)

  const copyAll = async () => {
    await navigator.clipboard?.writeText(transcript())
    notify.success('Session copied to clipboard')
  }

  const exportSession = async () => {
    try {
      const path = await SaveTextFile('atk-shell-session.txt', transcript())
      if (path) notify.success(`Saved to ${path}`)
    } catch (e: any) {
      notify.error(e)
    }
  }

  const q = libSearch.toLowerCase()
  const filteredCats = CATEGORIES.map(cat => ({
    ...cat,
    commands: q
      ? cat.commands.filter(c => c.label.toLowerCase().includes(q) || c.cmd.toLowerCase().includes(q))
      : cat.commands,
  })).filter(cat => cat.commands.length > 0)

  return (
    <div className="flex h-full overflow-hidden">
      {/* Command library panel */}
      {showLib && (
        <div className="w-72 shrink-0 border-r border-bg-border flex flex-col overflow-hidden">
          <div className="px-3 py-2 border-b border-bg-border shrink-0 space-y-2">
            <p className="section-title">Command Library</p>
            <p className="text-text-muted text-xs">Click to drop into the prompt (sets adb-host mode). Fill any <span className="badge-yellow text-xs">args</span> tokens, then Enter.</p>
            <div className="relative">
              <Search size={12} className="absolute left-2 top-1/2 -translate-y-1/2 text-text-muted" />
              <input
                className="input text-xs w-full pl-6"
                placeholder="Search commands..."
                value={libSearch}
                onChange={e => { setLibSearch(e.target.value); if (e.target.value) setOpenCats(new Set(CATEGORIES.map(c => c.name))) }}
              />
            </div>
          </div>
          <div className="flex-1 overflow-auto">
            {filteredCats.map(cat => (
              <div key={cat.name} className="border-b border-bg-border/40">
                <button
                  onClick={() => toggleCat(cat.name)}
                  className="w-full flex items-center justify-between px-3 py-2 hover:bg-bg-raised transition-colors"
                >
                  <div className="flex items-center gap-2">
                    {openCats.has(cat.name)
                      ? <ChevronDown size={12} className="text-accent-green shrink-0" />
                      : <ChevronRight size={12} className="text-text-muted shrink-0" />}
                    <span className="text-xs font-medium text-text-primary">{cat.name}</span>
                  </div>
                  <span className="text-xs text-text-muted">{cat.commands.length}</span>
                </button>
                {openCats.has(cat.name) && (
                  <div className="pb-1">
                    {cat.commands.map(cmd => (
                      <div
                        key={cmd.label}
                        onClick={() => pickCommand(cmd)}
                        className="flex items-start gap-1 mx-2 rounded px-2 py-1.5 hover:bg-bg-raised transition-colors cursor-pointer"
                      >
                        <div className="flex-1 min-w-0">
                          <div className="flex items-center gap-1.5">
                            <p className="text-xs text-text-secondary truncate">{cmd.label}</p>
                            {cmd.needsInput && <span className="badge-yellow shrink-0 text-xs">args</span>}
                          </div>
                          <p className="text-xs mono text-text-muted truncate leading-tight mt-0.5">{cmd.cmd}</p>
                        </div>
                      </div>
                    ))}
                  </div>
                )}
              </div>
            ))}
          </div>
        </div>
      )}

      {/* Terminal */}
      <div className="flex flex-col h-full flex-1 overflow-hidden">
        {/* Toolbar */}
        <div className="border-b border-bg-border px-4 py-2 flex items-center gap-3 shrink-0">
          <Terminal size={14} className="text-accent-green" />
          <span className="text-xs text-text-muted">Mode:</span>
          <div className="flex gap-1 bg-bg-raised rounded p-0.5">
            {(['shell', 'adb'] as const).map(m => (
              <button
                key={m}
                onClick={() => setMode(m)}
                className={`px-3 py-0.5 rounded text-xs font-medium transition-colors ${
                  mode === m ? 'bg-accent-green/20 text-accent-green' : 'text-text-muted hover:text-text-secondary'
                }`}
              >
                {m === 'shell' ? 'adb shell' : 'adb host'}
              </button>
            ))}
          </div>
          <div className="flex-1" />
          <button
            onClick={() => setShowLib(s => !s)}
            className={`btn-ghost text-xs ${showLib ? 'text-accent-green' : ''}`}
          >
            <Library size={12} /> Commands
          </button>
          <button onClick={copyAll} disabled={!hasSession} className="btn-ghost text-xs">
            <Copy size={12} /> Copy all
          </button>
          <button onClick={exportSession} disabled={!hasSession} className="btn-ghost text-xs">
            <Save size={12} /> Export
          </button>
          <button
            onClick={() => setHistory([{ cmd: '', output: 'Terminal cleared.', mode }])}
            className="btn-ghost text-xs"
          >
            <Trash2 size={12} /> Clear
          </button>
        </div>

        {/* Output */}
        <div
          className="flex-1 overflow-auto p-4 font-mono text-xs space-y-3 bg-bg-base cursor-text"
          // Only refocus the prompt on a bare click — if the user has selected
          // output text, stealing focus would collapse the highlight (and leave
          // the right-click menu with nothing to copy).
          onClick={() => { if (!window.getSelection()?.toString()) inputRef.current?.focus() }}
        >
          {history.map((entry, i) => (
            <div key={i}>
              {entry.cmd && (
                <div className="flex items-center gap-2 text-accent-green mb-1">
                  <span className="text-text-muted">[{entry.mode}]$</span>
                  <span>{entry.cmd}</span>
                </div>
              )}
              <pre
                className={`whitespace-pre-wrap break-words leading-relaxed ${
                  entry.error ? 'text-danger' : 'text-text-secondary'
                }`}
              >
                {entry.output}
              </pre>
            </div>
          ))}
          {loading && (
            <div className="flex items-center gap-2 text-text-muted">
              <span className="animate-pulse">▌</span>
              <span>Running...</span>
            </div>
          )}
          <div ref={bottomRef} />
        </div>

        {/* Input */}
        <div className="border-t border-bg-border px-4 py-2 flex items-center gap-2 bg-bg-surface shrink-0">
          <span className="text-accent-green font-mono text-xs shrink-0">[{mode}]$</span>
          <ChevronRight size={12} className="text-text-muted shrink-0" />
          <input
            ref={inputRef}
            autoFocus
            className="flex-1 bg-transparent text-text-primary font-mono text-xs focus:outline-none placeholder:text-text-muted"
            placeholder={mode === 'shell' ? 'ls /sdcard' : 'devices'}
            value={input}
            onChange={e => setInput(e.target.value)}
            onKeyDown={onKeyDown}
            disabled={loading}
          />
          {loading && (
            <div className="w-3 h-3 border border-accent-green border-t-transparent rounded-full animate-spin shrink-0" />
          )}
        </div>
      </div>
    </div>
  )
}
