import { useState, useEffect } from 'react'
import { MonitorSmartphone, Play, Square, Check, AlertTriangle, Camera } from 'lucide-react'
import { ScrcpyAvailable, ScrcpyRunning, StartScrcpy, StopScrcpy, CaptureScreenshot } from '../../lib/wails'
import { notify } from '../../lib/notify'

// Wails runtime is injected on window['runtime'] (same access as ViewLogcat).
const rt = () => (window as any)['runtime']

interface Options {
  maxSize: number
  bitRateMbps: number
  maxFps: number
  stayAwake: boolean
  turnScreenOff: boolean
  showTouches: boolean
  alwaysOnTop: boolean
  fullscreen: boolean
  borderless: boolean
  record: boolean
  detached: boolean
  noAudio: boolean
  viewOnly: boolean
  videoCodec: string
  orientation: string
}

const DEFAULTS: Options = {
  maxSize: 0, bitRateMbps: 8, maxFps: 60,
  stayAwake: true, turnScreenOff: false, showTouches: false,
  alwaysOnTop: false, fullscreen: false, borderless: false, record: false, detached: false,
  noAudio: false, viewOnly: false, videoCodec: '', orientation: '',
}

export default function ViewScreenMirror() {
  const [available, setAvailable] = useState<string | null>(null)
  const [missing, setMissing] = useState('')
  const [running, setRunning] = useState(false)
  const [starting, setStarting] = useState(false)
  const [opts, setOpts] = useState<Options>(DEFAULTS)

  useEffect(() => {
    ScrcpyAvailable().then(setAvailable).catch((e: any) => setMissing(String(e)))
    ScrcpyRunning().then(setRunning).catch(() => {})
    const off = rt()?.EventsOn?.('scrcpy:stopped', () => setRunning(false))
    return () => off?.()
  }, [])

  const set = <K extends keyof Options>(k: K, v: Options[K]) => setOpts(o => ({ ...o, [k]: v }))

  const start = async () => {
    setStarting(true)
    try {
      await StartScrcpy(opts)
      setRunning(true)
      notify.success('Mirror started — the window opens separately and can be moved anywhere')
    } catch (e: any) {
      notify.error(e)
    } finally {
      setStarting(false)
    }
  }

  const stop = async () => {
    try {
      await StopScrcpy()
      setRunning(false)
    } catch (e: any) {
      notify.error(e)
    }
  }

  const screenshot = async () => {
    try {
      const path = await CaptureScreenshot()
      if (path) notify.success(`Saved ${path}`)
    } catch (e: any) {
      notify.error(e)
    }
  }

  return (
    <div className="p-4 space-y-4 h-full overflow-auto max-w-2xl">
      <div className="flex items-center gap-2">
        <MonitorSmartphone size={18} className="text-accent-green" />
        <h1 className="text-base font-medium text-text-primary">Screen Mirror</h1>
      </div>

      <p className="text-xs text-text-muted leading-relaxed">
        Mirror and control your phone on your computer. The mirror opens in its own
        window you can move, resize, and snap anywhere — drive the phone with your
        mouse and keyboard. Powered by scrcpy.
      </p>

      {/* Availability */}
      {available && (
        <div className="card p-3 flex items-center gap-2 text-xs">
          <Check size={14} className="text-accent-green shrink-0" />
          <span className="text-text-secondary">{available} detected</span>
        </div>
      )}
      {missing && (
        <div className="card p-3 flex items-start gap-2 text-xs border-warn/30">
          <AlertTriangle size={14} className="text-warn shrink-0 mt-0.5" />
          <div>
            <p className="text-text-secondary">scrcpy isn't installed.</p>
            <p className="text-text-muted mt-1">Install it with <span className="mono">sudo apt install scrcpy</span>, then reopen this view.</p>
          </div>
        </div>
      )}

      {/* Options */}
      <div className="card p-4 space-y-3">
        <p className="section-title">Options</p>

        <div className="grid grid-cols-3 gap-3">
          <Select label="Max resolution" value={opts.maxSize} onChange={v => set('maxSize', v)}
            options={[[0, 'Original'], [1920, '1920'], [1280, '1280'], [1024, '1024'], [800, '800']]} />
          <Select label="Bitrate (Mbps)" value={opts.bitRateMbps} onChange={v => set('bitRateMbps', v)}
            options={[[2, '2'], [4, '4'], [8, '8'], [16, '16'], [32, '32']]} />
          <Select label="Max FPS" value={opts.maxFps} onChange={v => set('maxFps', v)}
            options={[[0, 'Unlimited'], [30, '30'], [60, '60'], [120, '120']]} />
          <label className="block">
            <span className="text-xs text-text-muted">Video codec</span>
            <select className="input text-xs w-full mt-1" value={opts.videoCodec} onChange={e => set('videoCodec', e.target.value)}>
              {[['', 'Auto'], ['h264', 'H.264'], ['h265', 'H.265'], ['av1', 'AV1']].map(([v, l]) => <option key={v} value={v}>{l}</option>)}
            </select>
          </label>
          <label className="block">
            <span className="text-xs text-text-muted">Orientation</span>
            <select className="input text-xs w-full mt-1" value={opts.orientation} onChange={e => set('orientation', e.target.value)}>
              {[['', 'Auto'], ['0', '0°'], ['90', '90°'], ['180', '180°'], ['270', '270°']].map(([v, l]) => <option key={v} value={v}>{l}</option>)}
            </select>
          </label>
        </div>

        <div className="grid grid-cols-2 gap-x-4 gap-y-2 pt-1">
          <Toggle label="Keep phone awake"        on={opts.stayAwake}     onChange={v => set('stayAwake', v)} />
          <Toggle label="Turn phone screen off"   on={opts.turnScreenOff} onChange={v => set('turnScreenOff', v)} />
          <Toggle label="Show touches on phone"   on={opts.showTouches}   onChange={v => set('showTouches', v)} />
          <Toggle label="Always on top"           on={opts.alwaysOnTop}   onChange={v => set('alwaysOnTop', v)} />
          <Toggle label="Borderless (no title bar)" on={opts.borderless}  onChange={v => set('borderless', v)} />
          <Toggle label="Start fullscreen"        on={opts.fullscreen}    onChange={v => set('fullscreen', v)} />
          <Toggle label="Mute audio"              on={opts.noAudio}       onChange={v => set('noAudio', v)} />
          <Toggle label="View only (no control)"  on={opts.viewOnly}      onChange={v => set('viewOnly', v)} />
          <Toggle label="Record to file"          on={opts.record}        onChange={v => set('record', v)} />
        </div>

        <div className="pt-2 mt-1 border-t border-bg-border flex items-center justify-between gap-3">
          <div>
            <p className="text-xs text-text-secondary">Keep running after ATK closes</p>
            <p className="text-[11px] text-text-muted mt-0.5">Detaches the mirror — quitting ATK won't close it. It'll show up here again next time you open ATK.</p>
          </div>
          <button
            onClick={() => set('detached', !opts.detached)}
            role="switch"
            aria-checked={opts.detached}
            className={`relative h-5 w-9 rounded-full transition-colors shrink-0 ${opts.detached ? 'bg-accent-green' : 'bg-bg-border'}`}
          >
            <span className={`absolute top-0.5 h-4 w-4 rounded-full bg-bg-surface shadow transition-all ${opts.detached ? 'left-[18px]' : 'left-0.5'}`} />
          </button>
        </div>
      </div>

      {/* Capture */}
      <div className="card p-4 space-y-3">
        <p className="section-title">Capture</p>
        <div className="flex items-center gap-3">
          <button onClick={screenshot} className="btn-ghost text-sm shrink-0">
            <Camera size={14} /> Screenshot
          </button>
          <span className="text-xs text-text-muted">Saves the phone's current screen as a PNG. Works anytime a device is connected — no mirror needed.</span>
        </div>
        <p className="text-[11px] text-text-muted leading-relaxed border-t border-bg-border pt-2">
          <span className="text-text-secondary">Screen recording:</span> enable “Record to file” above, then Start — a save dialog asks <span className="text-text-secondary">where to save the .mp4</span> (pick any folder/name). It records the whole session and finalizes the file when you Stop the mirror (or close its window). Perfect for repro clips.
        </p>
      </div>

      {/* Controls */}
      <div className="flex items-center gap-2">
        {running ? (
          <button onClick={stop} className="btn-danger text-sm">
            <Square size={14} /> Stop mirror
          </button>
        ) : (
          <button onClick={start} disabled={starting || !!missing} className="btn-primary text-sm">
            <Play size={14} /> {starting ? 'Starting…' : 'Start mirror'}
          </button>
        )}
        {running && <span className="text-xs text-accent-green">● Mirroring — check the separate scrcpy window</span>}
      </div>

      <p className="text-[11px] text-text-muted leading-relaxed">
        Borderless hides the window's title bar for a clean look. Move it with
        <span className="text-text-secondary"> Super + drag</span>, and close it with
        <span className="text-text-secondary"> Stop mirror</span> above (the phone's own
        title bar can't be themed by ATK — it's drawn by your window manager).
      </p>

      {/* Shortcut cheat-sheet */}
      <div className="card p-4 space-y-3">
        <p className="section-title">Controls &amp; shortcuts</p>
        <p className="text-xs text-text-muted">
          <span className="text-text-secondary">MOD</span> = <Kbd>Left&nbsp;Alt</Kbd> or <Kbd>Super</Kbd> (⊞ / ⌘ key) — use these when a laptop has no middle-click.
        </p>
        <div className="grid grid-cols-2 gap-x-6 gap-y-1.5">
          {SHORTCUTS.map(s => (
            <div key={s.action} className="flex items-center justify-between gap-2">
              <span className="text-xs text-text-secondary">{s.action}</span>
              <span className="flex items-center gap-1 shrink-0">
                <Kbd>{s.keys}</Kbd>
                {s.alt && <><span className="text-text-muted text-[10px]">or</span><Kbd>{s.alt}</Kbd></>}
              </span>
            </div>
          ))}
        </div>
      </div>
    </div>
  )
}

const SHORTCUTS: { action: string; keys: string; alt?: string }[] = [
  { action: 'Home',            keys: 'MOD+H', alt: 'Middle-click' },
  { action: 'Back',            keys: 'MOD+B', alt: 'Right-click' },
  { action: 'Tap',             keys: 'Left-click' },
  { action: 'Long-press / select', keys: 'Click + hold' },
  { action: 'Recent apps',     keys: 'MOD+S' },
  { action: 'App menu',        keys: 'MOD+M' },
  { action: 'Notifications',   keys: 'MOD+N' },
  { action: 'Power',           keys: 'MOD+P' },
  { action: 'Volume up',       keys: 'MOD+↑' },
  { action: 'Volume down',     keys: 'MOD+↓' },
  { action: 'Rotate screen',   keys: 'MOD+← / →' },
  { action: 'Fullscreen',      keys: 'MOD+F' },
  { action: 'Phone screen off', keys: 'MOD+O' },
  { action: 'Phone screen on',  keys: 'MOD+⇧+O' },
  { action: 'Copy to computer', keys: 'MOD+C' },
  { action: 'Paste to phone',   keys: 'MOD+V' },
  { action: 'Swipe / gesture',  keys: 'Click + drag' },
  { action: 'Pinch to zoom',    keys: 'Ctrl + drag' },
]

function Kbd({ children }: { children: React.ReactNode }) {
  return (
    <kbd className="px-1.5 py-0.5 rounded bg-bg-raised border border-bg-border mono text-[10px] text-text-secondary whitespace-nowrap">
      {children}
    </kbd>
  )
}

function Select({ label, value, onChange, options }: {
  label: string; value: number; onChange: (v: number) => void; options: [number, string][]
}) {
  return (
    <label className="block">
      <span className="text-xs text-text-muted">{label}</span>
      <select
        className="input text-xs w-full mt-1"
        value={value}
        onChange={e => onChange(Number(e.target.value))}
      >
        {options.map(([v, l]) => <option key={v} value={v}>{l}</option>)}
      </select>
    </label>
  )
}

function Toggle({ label, on, onChange }: { label: string; on: boolean; onChange: (v: boolean) => void }) {
  return (
    <div className="flex items-center justify-between gap-2">
      <span className="text-xs text-text-secondary">{label}</span>
      <button
        onClick={() => onChange(!on)}
        role="switch"
        aria-checked={on}
        className={`relative h-5 w-9 rounded-full transition-colors shrink-0 ${on ? 'bg-accent-green' : 'bg-bg-border'}`}
      >
        <span className={`absolute top-0.5 h-4 w-4 rounded-full bg-bg-surface shadow transition-all ${on ? 'left-[18px]' : 'left-0.5'}`} />
      </button>
    </div>
  )
}
