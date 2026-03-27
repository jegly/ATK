import { useState, useRef, useEffect } from 'react'
import { Terminal, Trash2, ChevronRight } from 'lucide-react'
import { RunShellCommand, RunAdbHostCommand } from '../../lib/wails'

interface HistoryEntry {
  cmd: string
  output: string
  error?: boolean
  mode: 'shell' | 'adb'
}

export default function ViewShell() {
  const [history, setHistory] = useState<HistoryEntry[]>([
    { cmd: '', output: 'ADBKit Shell — commands run via adb shell (no pipes/redirects — args are split directly, no shell injection)\nSwitch to "adb" mode to run adb host commands (e.g. adb devices, adb logcat)', mode: 'shell' }
  ])
  const [input, setInput] = useState('')
  const [mode, setMode] = useState<'shell' | 'adb'>('shell')
  const [loading, setLoading] = useState(false)
  const [cmdHistory, setCmdHistory] = useState<string[]>([])
  const [historyIdx, setHistoryIdx] = useState(-1)
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

  return (
    <div className="flex flex-col h-full">
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
          onClick={() => setHistory([{ cmd: '', output: 'Terminal cleared.', mode }])}
          className="btn-ghost text-xs"
        >
          <Trash2 size={12} /> Clear
        </button>
      </div>

      {/* Output */}
      <div
        className="flex-1 overflow-auto p-4 font-mono text-xs space-y-3 bg-bg-base cursor-text"
        onClick={() => inputRef.current?.focus()}
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
  )
}
