import { useEffect, useRef, useState, useCallback } from 'react'
import {
  Settings2, Snowflake, Trash2, Crosshair, X, ArrowRight, ArrowLeft, Activity, Zap,
  Square, Sparkles, Pause, Play, ZoomIn, ZoomOut, Maximize, Gauge, LayoutGrid, Waves,
  Spline, Focus, Clock, Expand, Shrink, Shapes, Box, Scaling, Info, Keyboard, Hexagon, Circle,
  AlertTriangle, Filter, Star, Table, Copy, Maximize2, Minimize2, Flag, Frame,
} from 'lucide-react'
import { Application, Container, Graphics, Sprite, Texture, Text, BlurFilter } from 'pixi.js'
import * as THREE from 'three'
import { LogGraph, DEFAULT_CONFIG, PRESETS, LEVELS, levelNum, nodeRadius, type GraphConfig, type GNode, type GEdge, type BoxRect, type GeometryShape } from '../../lib/logcatgraph'
import { LogcatProcessNames } from '../../lib/wails'
import type { LogcatLine } from '../../lib/types'

type RenderStyle = 'canvas' | 'pixi' | 'three'

// ---- persistence (settings + custom presets survive across sessions) -----
const LS_CFG = 'atk.map.cfg', LS_STYLE = 'atk.map.style', LS_PRESETS = 'atk.map.presets'
function loadCfg(): GraphConfig {
  try { const s = localStorage.getItem(LS_CFG); if (s) return { ...DEFAULT_CONFIG, ...JSON.parse(s) } } catch { /* */ }
  return { ...DEFAULT_CONFIG }
}
function loadStyle(): RenderStyle {
  try { const s = localStorage.getItem(LS_STYLE); if (s === 'pixi' || s === 'canvas' || s === 'three') return s } catch { /* */ }
  return 'canvas'
}
type UserPreset = Partial<GraphConfig> & { _style?: RenderStyle }
function loadUserPresets(): Record<string, UserPreset> {
  try { const s = localStorage.getItem(LS_PRESETS); if (s) return JSON.parse(s) } catch { /* */ }
  return {}
}

// ---- cyberpunk palette ----------------------------------------------------
const LEVEL_COLOR = ['#6b7280', '#38bdf8', '#34d399', '#fbbf24', '#f43f5e', '#ff3b3b']
const KIND_COLOR: Record<string, string> = {
  cooccur: '#3b82f6', activity: '#22d3ee', spawn: '#34d399', death: '#fb7185',
  crash: '#e879f9', anr: '#fb923c', signal: '#f87171', gfx: '#a78bfa', mention: '#64748b',
}
const KIND_LABEL: Record<string, string> = {
  cooccur: 'active together', activity: 'launch', spawn: 'start', death: 'death/kill',
  crash: 'crash', anr: 'ANR', signal: 'signal', gfx: 'surface', mention: 'mention',
}

function shortLabel(s: string): string {
  if (s.length <= 22) return s
  const parts = s.split('.')
  if (parts.length > 2) return '…' + parts.slice(-2).join('.')
  return s.slice(0, 21) + '…'
}

// the live map as a plain-text table (nodes ranked by activity + connections) —
// for the toggleable Data view (readable / greppable / copyable)
function mapDataText(eng: LogGraph): string {
  const deg = new Map<string, number>()
  for (const e of eng.edges.values()) { deg.set(e.a, (deg.get(e.a) || 0) + 1); deg.set(e.b, (deg.get(e.b) || 0) + 1) }
  const nodes = [...eng.nodes.values()].sort((a, b) => b.count - a.count)
  const lines = [`# ${eng.nodes.size} nodes · ${eng.edges.size} edges · ${eng.alerts.length} alerts · ${eng.totalLines} lines`, '', 'EVENTS  LVL  KIND       CONNS  NODE']
  for (const n of nodes) {
    const lv = LEVELS[Math.min(5, Math.round(n.worst))]
    lines.push(`${String(n.count).padStart(6)}  ${lv.padEnd(3)}  ${n.kind.padEnd(9)}  ${String(deg.get(n.id) || 0).padStart(4)}   ${n.label}`)
  }
  lines.push('', 'CONNECTIONS  (source → target · kind · count)')
  for (const e of [...eng.edges.values()].sort((a, b) => b.weight - a.weight).slice(0, 250)) {
    const a = eng.nodes.get(e.a)?.label || e.a.slice(2), b = eng.nodes.get(e.b)?.label || e.b.slice(2)
    lines.push(`${a} → ${b}  [${e.kind}] ×${e.count}`)
  }
  return lines.join('\n')
}

// semantic relationships keep their meaningful color even in per-source mode —
// a crash should always read red, a kill pink, regardless of which hub emitted it.
const SEMANTIC_KINDS = new Set(['crash', 'anr', 'death', 'signal', 'activity', 'spawn', 'gfx'])
function hueFromId(id: string): string {
  let h = 0
  for (let i = 0; i < id.length; i++) h = (h * 31 + id.charCodeAt(i)) >>> 0
  return hslToHex(h % 360, 42, 58)   // muted, not neon
}
function hslToHex(h: number, s: number, l: number): string {
  s /= 100; l /= 100
  const a = s * Math.min(l, 1 - l)
  const f = (n: number) => {
    const k = (n + h / 30) % 12
    const c = l - a * Math.max(-1, Math.min(k - 3, Math.min(9 - k, 1)))
    return Math.round(255 * c).toString(16).padStart(2, '0')
  }
  return '#' + f(0) + f(8) + f(4)
}
// edge color: by relationship kind, source-hub hue (ambient edges only), or severity.
function edgeColor(e: GEdge, mode: 'kind' | 'source' | 'severity'): string {
  if (mode === 'severity') return LEVEL_COLOR[Math.min(5, Math.round(e.worst))]
  if (mode === 'source' && !SEMANTIC_KINDS.has(e.kind)) return hueFromId(e.a)
  return KIND_COLOR[e.kind] || '#3b82f6'
}
// node color: 'auto' = severity when warn+ else kind; or force kind / severity / hub hue.
function nodeColor(n: GNode, mode: 'auto' | 'kind' | 'severity' | 'hub'): string {
  const sev = Math.min(5, Math.round(n.worst))
  if (mode === 'kind') return kindBase(n.kind)
  if (mode === 'severity') return LEVEL_COLOR[sev]
  if (mode === 'hub') return hueFromId(n.id)
  return sev >= 3 ? LEVEL_COLOR[sev] : kindBase(n.kind)
}

interface Props {
  running: boolean
  registerSink: (fn: ((l: LogcatLine) => void) | null) => void
  onInspectEntity?: (e: { kind: 'pid' | 'tag'; value: string; label: string }) => void
  hidden?: boolean
  search?: string
}

export default function LogcatMap({ running, registerSink, onInspectEntity, hidden, search }: Props) {
  const canvasRef = useRef<HTMLCanvasElement>(null)
  const pixiCanvasRef = useRef<HTMLCanvasElement>(null)
  const wrapRef = useRef<HTMLDivElement>(null)
  const engineRef = useRef(new LogGraph())
  const sizeRef = useRef({ w: 800, h: 600 })
  const camRef = useRef({ scale: 1, ox: 0, oy: 0 })
  const dragRef = useRef<{ kind: 'node' | 'pan'; id?: string; group?: string[]; lastX: number; lastY: number; moved: number } | null>(null)
  const selRef = useRef<string | null>(null)
  const hovRef = useRef<string | null>(null)
  const pausedRef = useRef(false)
  const pulseRef = useRef<{ id: string; until: number } | null>(null)
  const cfgRef = useRef<GraphConfig>(loadCfg())
  const styleRef = useRef<RenderStyle>(loadStyle())
  const pixiRef = useRef<PixiScene | null>(null)
  const pixiInitRef = useRef(false)   // guards the one-time async Pixi init
  const threeCanvasRef = useRef<HTMLCanvasElement>(null)
  const threeLabelsRef = useRef<HTMLDivElement>(null)
  const threeRef = useRef<ThreeScene | null>(null)
  const threeInitRef = useRef(false)
  const orbitRef = useRef({ az: 0.6, el: 0.35, dist: 1500 })  // 3D orbit camera

  const [renderStyle, setRenderStyle] = useState<RenderStyle>(loadStyle)
  const [pixiErr, setPixiErr] = useState<string | null>(null)
  const [paused, setPaused] = useState(false)
  const [cfg, setCfg] = useState<GraphConfig>(loadCfg)
  const [userPresets, setUserPresets] = useState<Record<string, UserPreset>>(loadUserPresets)
  const [showSettings, setShowSettings] = useState(false)
  const [showFeed, setShowFeed] = useState(false)             // live packet feed
  const [showTimeline, setShowTimeline] = useState(false)     // bottom severity timeline
  const [feedWindow, setFeedWindow] = useState<{ start: number; end: number; label: string } | null>(null)
  const [showLegend, setShowLegend] = useState(false)
  const [showHelp, setShowHelp] = useState(false)
  const [recording, setRecording] = useState(false)              // capture packets to a buffer
  const [feedSource, setFeedSource] = useState<'live' | 'captured'>('live')
  const [showAlerts, setShowAlerts] = useState(false)             // critical-events panel
  const [alertSeen, setAlertSeen] = useState(0)                   // alerts count already seen (for the badge)
  const lastAlertLenRef = useRef(0)
  const [watch, setWatch] = useState<string[]>([])                // watchlist of node ids
  const [showWatch, setShowWatch] = useState(false)
  const watchRef = useRef<Set<string>>(new Set())
  const [alertRules, setAlertRules] = useState<string[]>(() => { try { return JSON.parse(localStorage.getItem('atk.map.alertrules') || '[]') } catch { return [] } })
  const [ruleInput, setRuleInput] = useState('')
  const [bigPanel, setBigPanel] = useState<null | 'feed' | 'inspector' | 'data'>(null)  // fullscreen/expanded panel
  const [showData, setShowData] = useState(false)             // map data as a text table
  const [mapFull, setMapFull] = useState(false)               // detach: map fills the whole window
  const pendingFitRef = useRef(false)                         // request: stretch layout to fill the screen
  const [hiddenKinds, setHiddenKinds] = useState<string[]>(() => { try { return JSON.parse(localStorage.getItem('atk.map.hidekinds') || '[]') } catch { return [] } })
  const hiddenKindsRef = useRef<Set<string>>(new Set())
  const [matchIdx, setMatchIdx] = useState(0)                  // search-result cursor
  const [baselineOn, setBaselineOn] = useState(false)          // diff-since-baseline mode
  const [showEdges, setShowEdges] = useState(() => { try { return localStorage.getItem('atk.map.edges') !== '0' } catch { return true } })
  const [isolate, setIsolate] = useState(false)               // show only selected node + neighbours
  const [feedSize, setFeedSize] = useState(() => {            // resizable packet feed
    try { const v = JSON.parse(localStorage.getItem('atk.map.feed') || ''); if (v?.w && v?.h) return v } catch { /* */ }
    return { w: 400, h: 256 }
  })
  const showEdgesRef = useRef(showEdges)
  const isolateRef = useRef(isolate)
  const searchRef = useRef('')
  const [inspectorW, setInspectorW] = useState(() => {        // resizable inspector width (px)
    try { const v = Number(localStorage.getItem('atk.map.iw')); if (v >= 260 && v <= 760) return v } catch { /* */ }
    return 320
  })
  useEffect(() => { try { localStorage.setItem('atk.map.iw', String(inspectorW)) } catch { /* */ } }, [inspectorW])
  useEffect(() => { showEdgesRef.current = showEdges; try { localStorage.setItem('atk.map.edges', showEdges ? '1' : '0') } catch { /* */ } }, [showEdges])
  useEffect(() => { isolateRef.current = isolate }, [isolate])
  useEffect(() => { searchRef.current = (search || '').trim().toLowerCase() }, [search])
  useEffect(() => { engineRef.current.capturing = recording }, [recording])
  // keep the watchlist set in sync (also tells the engine never to evict these)
  useEffect(() => { const s = new Set(watch); watchRef.current = s; engineRef.current.watchedIds = s }, [watch])
  const toggleWatch = useCallback((id: string) => setWatch(w => w.includes(id) ? w.filter(x => x !== id) : [...w, id]), [])
  // keyword/tag alert rules → ping when matching text/tag streams in
  useEffect(() => { engineRef.current.alertRules = alertRules.map(r => r.toLowerCase()); try { localStorage.setItem('atk.map.alertrules', JSON.stringify(alertRules)) } catch { /* */ } }, [alertRules])
  const addRule = () => { const r = ruleInput.trim(); if (r && !alertRules.includes(r)) setAlertRules(a => [...a, r]); setRuleInput('') }
  // by-kind visibility filter
  useEffect(() => { hiddenKindsRef.current = new Set(hiddenKinds); try { localStorage.setItem('atk.map.hidekinds', JSON.stringify(hiddenKinds)) } catch { /* */ } }, [hiddenKinds])
  const toggleKind = (k: string) => setHiddenKinds(h => h.includes(k) ? h.filter(x => x !== k) : [...h, k])
  // step through search matches (stable order by activity), jumping the camera to each
  const searchMatches = (): GNode[] => {
    const q = (search || '').trim().toLowerCase()
    if (!q) return []
    return [...engineRef.current.nodes.values()].filter(n => n.label.toLowerCase().includes(q) || n.id.toLowerCase().includes(q)).sort((a, b) => b.count - a.count)
  }
  const stepMatch = (dir: number) => {
    const m = searchMatches(); if (!m.length) return
    const idx = ((matchIdx + dir) % m.length + m.length) % m.length
    setMatchIdx(idx); focusNode(m[idx].id)
  }
  useEffect(() => { setMatchIdx(0) }, [search])
  // copy the captured packets (with resolved node names) to the clipboard as JSON
  const exportCaptured = () => {
    const eng = engineRef.current
    const rows = eng.captured.map(f => ({
      from: eng.nodes.get(f.a)?.label || f.a, to: eng.nodes.get(f.b)?.label || f.b,
      kind: f.kind, level: LEVELS[Math.min(5, Math.round(f.level))], tag: f.tag, msg: f.msg,
    }))
    try { navigator.clipboard?.writeText(JSON.stringify(rows, null, 2)) } catch { /* */ }
  }
  useEffect(() => { try { localStorage.setItem('atk.map.feed', JSON.stringify(feedSize)) } catch { /* */ } }, [feedSize])
  const [selected, setSelected] = useState<string | null>(null)
  const [hover, setHover] = useState<{ id: string; x: number; y: number } | null>(null)
  const [pktHover, setPktHover] = useState<{ x: number; y: number; line: LogcatLine } | null>(null)
  const [, setTick] = useState(0)            // forces inspector/HUD refresh
  const [stats, setStats] = useState({ nodes: 0, edges: 0, particles: 0, lines: 0 })

  // keep engine config in sync
  useEffect(() => { engineRef.current.setConfig(cfg); cfgRef.current = cfg }, [cfg])
  useEffect(() => { styleRef.current = renderStyle }, [renderStyle])
  useEffect(() => { pausedRef.current = paused }, [paused])
  // persist across sessions
  useEffect(() => { try { localStorage.setItem(LS_CFG, JSON.stringify(cfg)) } catch { /* */ } }, [cfg])
  useEffect(() => { try { localStorage.setItem(LS_STYLE, renderStyle) } catch { /* */ } }, [renderStyle])
  useEffect(() => { try { localStorage.setItem(LS_PRESETS, JSON.stringify(userPresets)) } catch { /* */ } }, [userPresets])
  const patch = (p: Partial<GraphConfig>) => setCfg(c => ({ ...c, ...p }))
  const applyPreset = (name: string) => {
    const p = (PRESETS[name] || userPresets[name]) as UserPreset | undefined
    if (!p) return
    if (p._style) setRenderStyle(p._style)
    const { _style, ...rest } = p
    camRef.current = { scale: 1, ox: 0, oy: 0 }   // restored layout may differ → reframe
    setCfg(c => ({ ...c, ...rest }))
  }
  // save the FULL current state as a named preset — layout mode, geometry, scale,
  // colour coding, glow, fades AND the render style (so it restores exactly).
  const saveUserPreset = (name: string) => {
    const n = name.trim(); if (!n) return
    setUserPresets(p => ({ ...p, [n]: { ...cfgRef.current, _style: styleRef.current } }))
  }
  const deleteUserPreset = (name: string) => setUserPresets(p => { const c = { ...p }; delete c[name]; return c })

  // feed the engine from the shared logcat stream
  useEffect(() => {
    const eng = engineRef.current
    registerSink((line) => { if (!pausedRef.current) eng.ingest(line, sizeRef.current.w, sizeRef.current.h) })
    return () => registerSink(null)
  }, [registerSink])

  // resolve PID -> package names periodically while running
  useEffect(() => {
    let stop = false
    const pull = () => LogcatProcessNames().then(m => { if (!stop) engineRef.current.setProcessNames(m) }).catch(() => {})
    pull()
    const id = setInterval(() => { if (running) pull() }, 4000)
    return () => { stop = true; clearInterval(id) }
  }, [running])

  const selectNode = useCallback((id: string | null) => { selRef.current = id; setSelected(id) }, [])

  // Esc clears the selection; Space pauses/resumes (so you can click a frozen
  // particle). Space is ignored while typing in any input so it never breaks
  // the search/filter boxes, and only when the map is actually visible.
  useEffect(() => {
    const isTyping = (el: EventTarget | null) => {
      const t = el as HTMLElement | null
      return !!t && (t.tagName === 'INPUT' || t.tagName === 'TEXTAREA' || t.isContentEditable)
    }
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') { selectNode(null); setMapFull(false) }
      else if ((e.key === ' ' || e.code === 'Space') && !hidden && !isTyping(e.target)) {
        e.preventDefault()
        setPaused(p => !p)
      }
    }
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  }, [selectNode, hidden])

  // auto-dismiss the WebGL-fallback note so it can't get stuck on screen
  useEffect(() => {
    if (!pixiErr) return
    const id = setTimeout(() => setPixiErr(null), 9000)
    return () => clearTimeout(id)
  }, [pixiErr])

  // select a node AND pan it to centre + pulse it — so "trace"/connection hops
  // visibly take you there instead of silently selecting something off-screen.
  const focusNode = useCallback((id: string | null) => {
    selectNode(id)
    if (!id) return
    const n = engineRef.current.nodes.get(id)
    if (!n) return
    const { w, h } = sizeRef.current
    const cam = camRef.current
    cam.ox = w / 2 - n.x * cam.scale
    cam.oy = h / 2 - n.y * cam.scale
    pulseRef.current = { id, until: performance.now() + 1300 }
  }, [selectNode])

  // ---- main render loop --------------------------------------------------
  useEffect(() => {
    const canvas = canvasRef.current!
    const ctx = canvas.getContext('2d')!
    const eng = engineRef.current
    let raf = 0
    let prev = performance.now()
    let uiAcc = 0

    const resize = () => {
      const r = wrapRef.current!.getBoundingClientRect()
      const dpr = Math.min(window.devicePixelRatio || 1, 2)
      sizeRef.current = { w: r.width, h: r.height }
      canvas.width = Math.floor(r.width * dpr)
      canvas.height = Math.floor(r.height * dpr)
      canvas.style.width = r.width + 'px'
      canvas.style.height = r.height + 'px'
      ctx.setTransform(dpr, 0, 0, dpr, 0, 0)
      if (pixiRef.current && r.width > 0) pixiRef.current.app.renderer.resize(r.width, r.height)
      if (threeRef.current && r.width > 0) {
        threeRef.current.renderer.setSize(r.width, r.height, false)
        threeRef.current.camera.aspect = r.width / r.height
        threeRef.current.camera.updateProjectionMatrix()
      }
    }
    resize()
    const ro = new ResizeObserver(resize)
    ro.observe(wrapRef.current!)

    const frame = (t: number) => {
      const dt = t - prev; prev = t
      const { w, h } = sizeRef.current
      const cam = camRef.current

      // stretch the current arrangement to fill the viewport (one-shot, any mode)
      if (pendingFitRef.current) {
        pendingFitRef.current = false
        const arr = [...eng.nodes.values()]
        if (arr.length) {
          let mnX = Infinity, mnY = Infinity, mxX = -Infinity, mxY = -Infinity
          for (const n of arr) { if (n.x < mnX) mnX = n.x; if (n.y < mnY) mnY = n.y; if (n.x > mxX) mxX = n.x; if (n.y > mxY) mxY = n.y }
          const pad = 70, bw = Math.max(1, mxX - mnX), bh = Math.max(1, mxY - mnY)
          const sx = (w - pad * 2) / bw, sy = (h - pad * 2) / bh
          const bcx = (mnX + mxX) / 2, bcy = (mnY + mxY) / 2
          for (const n of arr) { n.x = w / 2 + (n.x - bcx) * sx; n.y = h / 2 + (n.y - bcy) * sy; n.vx = 0; n.vy = 0 }
          camRef.current.scale = 1; camRef.current.ox = 0; camRef.current.oy = 0
        }
      }

      const ts = cfgRef.current.timeScale
      if (!pausedRef.current) {
        eng.decay(ts)
        eng.stepForces(w, h, dt * ts)
        eng.advanceParticles(dt * ts)
      }

      // ---- draw ----
      if (styleRef.current === 'canvas') {
      ctx.save()
      // background
      ctx.fillStyle = '#0a0c12'
      ctx.fillRect(0, 0, w, h)
      ctx.translate(cam.ox, cam.oy); ctx.scale(cam.scale, cam.scale)

      drawGrid(ctx, w, h, cam, cfg.showGrid)
      if (cfgRef.current.boxLayout) drawBoxesCanvas(ctx, eng.boxes, cam)

      // focus = whatever the user is looking at (hover) or has pinned (click).
      // Hovering instantly lights up that node's connections — the key to
      // reading "what talks to what".
      const sel = selRef.current
      const focus = sel || hovRef.current
      const neighborIds = new Set<string>()
      if (focus) for (const n of eng.neighbors(focus)) neighborIds.add(n.node.id)
      // isolate: when on + a node selected, only that node + its neighbours show
      const iso = (isolateRef.current && sel) ? sel : null
      const isoVisible = (id: string) => !iso || id === iso || neighborIds.has(id)
      const q = searchRef.current
      const matchNode = (n: GNode) => !q || n.label.toLowerCase().includes(q) || n.id.toLowerCase().includes(q)
      const hk = hiddenKindsRef.current
      const kindHidden = (id: string) => { const nn = eng.nodes.get(id); return !!nn && hk.has(nn.kind) }

      // edges (overlay toggle hides them so the moving particles read cleanly)
      if (showEdgesRef.current) {
      ctx.lineCap = 'round'
      for (const e of eng.edges.values()) {
        if (iso && e.a !== iso && e.b !== iso) continue
        if (hk.size && (kindHidden(e.a) || kindHidden(e.b))) continue
        const a = eng.nodes.get(e.a), b = eng.nodes.get(e.b)
        if (!a || !b) continue
        const rel = e.a === focus || e.b === focus
        let alpha: number, width: number
        if (!focus)      { alpha = Math.min(0.55, e.weight * 0.06 + 0.16); width = Math.min(3, 0.9 + e.weight * 0.18) / cam.scale + 0.25 }
        else if (rel)    { alpha = Math.min(0.95, 0.5 + e.weight * 0.06); width = Math.min(5, 1.6 + e.weight * 0.26) / cam.scale + 0.35 }
        else             { alpha = 0.04; width = 0.5 / cam.scale }
        const col = edgeColor(e, cfgRef.current.edgeColorMode)
        ctx.strokeStyle = hexA(col, alpha); ctx.lineWidth = width
        ctx.beginPath(); ctx.moveTo(a.x, a.y); ctx.lineTo(b.x, b.y); ctx.stroke()
        if (focus && rel) drawArrowCanvas(ctx, a, b, col, cam.scale)
      }
      }

      // particles (additive)
      ctx.globalCompositeOperation = 'lighter'
      for (const p of eng.particles) {
        if (iso && p.a !== iso && p.b !== iso) continue
        if (hk.size && (kindHidden(p.a) || kindHidden(p.b))) continue
        const a = eng.nodes.get(p.a), b = eng.nodes.get(p.b)
        if (!a || !b) continue
        const x = a.x + (b.x - a.x) * p.t, y = a.y + (b.y - a.y) * p.t
        const tt = Math.max(0, p.t - 0.16)
        const tx = a.x + (b.x - a.x) * tt, ty = a.y + (b.y - a.y) * tt
        const col = p.level >= 3 ? LEVEL_COLOR[Math.min(5, Math.round(p.level))] : (KIND_COLOR[p.kind] || '#22d3ee')
        // brightness NOT tied to the glow slider — particles stay readable
        ctx.strokeStyle = hexA(col, (1 - p.t) * 0.9)
        ctx.lineWidth = (p.level >= 4 ? 3 : 2) / cam.scale + 0.4
        ctx.beginPath(); ctx.moveTo(tx, ty); ctx.lineTo(x, y); ctx.stroke()
        ctx.fillStyle = hexA(col, 0.98)
        ctx.beginPath(); ctx.arc(x, y, (p.level >= 4 ? 2.8 : 2.1) / cam.scale + 0.5, 0, 7); ctx.fill()
      }
      ctx.globalCompositeOperation = 'source-over'

      // nodes
      for (const n of eng.nodes.values()) {
        if (iso && !isoVisible(n.id)) continue
        if (hk.has(n.kind)) continue
        const r = nodeRadius(n)
        const col = nodeColor(n, cfgRef.current.nodeColorMode)
        const dim = (focus && n.id !== focus && !neighborIds.has(n.id)) || !matchNode(n)
        if (cfgRef.current.wireframe) {
          // schematic: hollow ring, no halo/fill
          ctx.strokeStyle = hexA(col, dim ? 0.3 : 0.95); ctx.lineWidth = 1.5 / cam.scale
          ctx.beginPath(); ctx.arc(n.x, n.y, r, 0, 7); ctx.stroke()
        } else {
          const aGlow = (dim ? 0.08 : 0.26) * (0.5 + Math.min(1, n.heat / 4)) * cfg.glow
          // halo
          const g = ctx.createRadialGradient(n.x, n.y, 0, n.x, n.y, r * 2.2)
          g.addColorStop(0, hexA(col, aGlow)); g.addColorStop(1, hexA(col, 0))
          ctx.fillStyle = g
          ctx.beginPath(); ctx.arc(n.x, n.y, r * 2.2, 0, 7); ctx.fill()
          // core
          ctx.fillStyle = dim ? hexA(col, 0.35) : col
          ctx.beginPath(); ctx.arc(n.x, n.y, r, 0, 7); ctx.fill()
        }
        // ring for selection / hover (or a green ring for a search match)
        if (n.id === sel || n.id === hovRef.current) {
          ctx.strokeStyle = '#ffffff'; ctx.lineWidth = 1.5 / cam.scale
          ctx.beginPath(); ctx.arc(n.x, n.y, r + 3 / cam.scale, 0, 7); ctx.stroke()
        } else if (q && matchNode(n)) {
          ctx.strokeStyle = 'rgba(52,211,153,0.95)'; ctx.lineWidth = 2 / cam.scale
          ctx.beginPath(); ctx.arc(n.x, n.y, r + 3 / cam.scale, 0, 7); ctx.stroke()
        }
        if (watchRef.current.has(n.id)) {   // watchlist marker
          ctx.strokeStyle = 'rgba(250,204,21,0.9)'; ctx.lineWidth = 2 / cam.scale
          ctx.beginPath(); ctx.arc(n.x, n.y, r + 6 / cam.scale, 0, 7); ctx.stroke()
        }
        if (eng.baselineActive && !n.baseline) {   // appeared since baseline
          ctx.strokeStyle = 'rgba(34,211,238,0.95)'; ctx.lineWidth = 2.5 / cam.scale
          ctx.beginPath(); ctx.arc(n.x, n.y, r + 9 / cam.scale, 0, 7); ctx.stroke()
        }
        // label
        const big = n.heat > 1.2 || n.id === sel || n.id === hovRef.current || neighborIds.has(n.id)
        if (big && cam.scale > 0.5) {
          ctx.font = `${11 / cam.scale}px 'JetBrains Mono', monospace`
          ctx.fillStyle = dim ? 'rgba(200,210,230,0.3)' : 'rgba(220,228,245,0.92)'
          ctx.textAlign = 'center'
          ctx.fillText(shortLabel(n.label), n.x, n.y + r + 12 / cam.scale)
        }
      }
      // trace pulse — expanding ring on a just-focused node
      const pulse = pulseRef.current
      if (pulse && performance.now() < pulse.until) {
        const pn = eng.nodes.get(pulse.id)
        if (pn) {
          const k = 1 - (pulse.until - performance.now()) / 1300
          ctx.strokeStyle = hexA('#ffffff', (1 - k) * 0.85)
          ctx.lineWidth = 2 / cam.scale
          ctx.beginPath(); ctx.arc(pn.x, pn.y, nodeRadius(pn) + k * 44 / cam.scale, 0, 7); ctx.stroke()
        }
      } else if (pulse) pulseRef.current = null
      if (cfgRef.current.boxLayout) drawTetractysCanvas(ctx, eng.boxes, cam.scale)
      ctx.restore()
      } else if (styleRef.current === 'pixi') {
        if (pixiRef.current) renderPixi(pixiRef.current, eng, cam, cfgRef.current, selRef.current, hovRef.current, pulseRef.current, dt * ts, pausedRef.current, showEdgesRef.current, isolateRef.current, searchRef.current, watchRef.current, hiddenKindsRef.current)
      } else if (threeRef.current) {
        renderThree(threeRef.current, eng, orbitRef.current, sizeRef.current, selRef.current, hovRef.current, showEdgesRef.current, isolateRef.current, searchRef.current, threeLabelsRef.current, watchRef.current, hiddenKindsRef.current, dt * ts, pausedRef.current)
      }

      // periodic UI refresh (inspector + HUD)
      uiAcc += dt
      if (uiAcc > 350) {
        uiAcc = 0
        const flowCount = styleRef.current === 'pixi' && pixiRef.current ? pixiRef.current.flows.length
          : styleRef.current === 'three' && threeRef.current ? threeRef.current.flowGeo.drawRange.count
          : eng.particles.length
        setStats({ nodes: eng.nodes.size, edges: eng.edges.size, particles: flowCount, lines: eng.totalLines })
        // a new critical event arrived → ping its node on the map + refresh badge
        if (eng.alerts.length > lastAlertLenRef.current) {
          const latest = eng.alerts[eng.alerts.length - 1]
          if (latest && eng.nodes.has(latest.id) && !pausedRef.current) pulseRef.current = { id: latest.id, until: performance.now() + 1400 }
          lastAlertLenRef.current = eng.alerts.length
          setTick(v => v + 1)
        }
        if (selRef.current) setTick(v => v + 1)
      }
      raf = requestAnimationFrame(frame)
    }
    raf = requestAnimationFrame(frame)
    return () => { cancelAnimationFrame(raf); ro.disconnect() }
  }, [cfg.showGrid, cfg.glow])

  // Create the Pixi scene ONCE, lazily, the first time Neon is selected — and
  // KEEP it for the life of the view. Destroying + recreating it on every
  // Canvas<->Neon toggle is what threw "shaderSource must be a WebGLShader":
  // under WebKitGTK, re-initing a renderer on the same canvas reuses stale GL
  // shader programs from the torn-down context. So we never destroy on toggle;
  // only on unmount. When Canvas is active the pixi <canvas> is just hidden.
  useEffect(() => {
    if (renderStyle !== 'pixi' || pixiRef.current || pixiInitRef.current) return
    pixiInitRef.current = true
    const r = wrapRef.current!.getBoundingClientRect()
    createPixiScene(pixiCanvasRef.current!, r.width || 800, r.height || 600)
      .then(scene => { pixiRef.current = scene; setPixiErr(null) })
      .catch((err) => {
        pixiInitRef.current = false
        setPixiErr('Neon failed: ' + (err?.message || String(err)))
        setRenderStyle('canvas')
      })
  }, [renderStyle])

  // lazily create the Three.js scene the first time 3D is selected; keep it for
  // the view's life (isolated from Canvas/Neon — falls back to Canvas on failure)
  useEffect(() => {
    if (renderStyle !== 'three' || threeRef.current || threeInitRef.current) return
    threeInitRef.current = true
    try {
      const r = wrapRef.current!.getBoundingClientRect()
      threeRef.current = makeThreeScene(threeCanvasRef.current!, r.width || 800, r.height || 600)
      setPixiErr(null)
    } catch (err: any) {
      threeInitRef.current = false
      setPixiErr('3D failed: ' + (err?.message || String(err)))
      setRenderStyle('canvas')
    }
  }, [renderStyle])

  // tear scenes down only when the component unmounts
  useEffect(() => () => {
    if (pixiRef.current) { destroyPixiScene(pixiRef.current); pixiRef.current = null }
    pixiInitRef.current = false
    if (threeRef.current) { destroyThreeScene(threeRef.current); threeRef.current = null }
    threeInitRef.current = false
  }, [])

  // ---- pointer interaction ----------------------------------------------
  const toWorld = (clientX: number, clientY: number) => {
    const r = wrapRef.current!.getBoundingClientRect()
    const cam = camRef.current
    return { x: (clientX - r.left - cam.ox) / cam.scale, y: (clientY - r.top - cam.oy) / cam.scale }
  }

  // nearest moving particle to a world point (active renderer's particles) →
  // its source node id + the log line it carries. Used by hover + click-to-follow.
  const nearestParticle = (wpt: { x: number; y: number }): { a: string; line?: LogcatLine } | null => {
    const eng = engineRef.current, cam = camRef.current
    let best: { a: string; line?: LogcatLine } | null = null, bestD = 13 / cam.scale
    if (styleRef.current === 'pixi' && pixiRef.current) {
      for (const p of pixiRef.current.flows) {
        const ed = eng.edges.get(p.ek); if (!ed) continue
        const a = eng.nodes.get(ed.a), b = eng.nodes.get(ed.b); if (!a || !b) continue
        const { cx, cy } = edgeCurve(a.x, a.y, b.x, b.y, ed.id)
        const dd = Math.hypot(bezier(a.x, cx, b.x, p.t) - wpt.x, bezier(a.y, cy, b.y, p.t) - wpt.y)
        if (dd < bestD) { bestD = dd; best = { a: ed.a, line: p.line } }
      }
    } else {
      for (const p of eng.particles) {
        const a = eng.nodes.get(p.a), b = eng.nodes.get(p.b); if (!a || !b) continue
        const dd = Math.hypot(a.x + (b.x - a.x) * p.t - wpt.x, a.y + (b.y - a.y) * p.t - wpt.y)
        if (dd < bestD) { bestD = dd; best = { a: p.a, line: p.line } }
      }
    }
    return best
  }

  const onPointerDown = (e: React.PointerEvent) => {
    if (styleRef.current === 'three') {
      dragRef.current = { kind: 'pan', lastX: e.clientX, lastY: e.clientY, moved: 0 }
      setPktHover(null)
      ;(e.target as HTMLElement).setPointerCapture(e.pointerId)
      return
    }
    const wpt = toWorld(e.clientX, e.clientY)
    const hit = engineRef.current.nodeAt(wpt.x, wpt.y, nodeRadius)
    // Shift+drag a node = move it AND its directly-connected nodes as a cluster.
    // Pin the neighbours for the duration so the force sim doesn't fight the drag;
    // they're released (relax back) on pointer-up, while the dragged node stays pinned.
    let group: string[] | undefined
    if (hit && e.shiftKey) {
      group = engineRef.current.neighbors(hit.id).map(nb => nb.node.id)
      for (const id of group) { const n = engineRef.current.nodes.get(id); if (n) n.pinned = true }
    }
    dragRef.current = { kind: hit ? 'node' : 'pan', id: hit?.id, group, lastX: e.clientX, lastY: e.clientY, moved: 0 }
    setPktHover(null)
    ;(e.target as HTMLElement).setPointerCapture(e.pointerId)
  }
  const onPointerMove = (e: React.PointerEvent) => {
    if (styleRef.current === 'three') {
      const dd = dragRef.current
      if (dd) {
        const dx = e.clientX - dd.lastX, dy = e.clientY - dd.lastY
        dd.lastX = e.clientX; dd.lastY = e.clientY; dd.moved += Math.abs(dx) + Math.abs(dy)
        const o = orbitRef.current
        o.az -= dx * 0.01
        o.el = Math.max(-1.45, Math.min(1.45, o.el + dy * 0.01))
      }
      return
    }
    const d = dragRef.current
    if (!d) {
      const wpt = toWorld(e.clientX, e.clientY)
      const eng = engineRef.current
      const hit = eng.nodeAt(wpt.x, wpt.y, nodeRadius)
      hovRef.current = hit?.id || null
      if (hit) { setHover({ id: hit.id, x: e.clientX, y: e.clientY }); setPktHover(null); return }
      setHover(null)
      // no node under the cursor → grab the nearest MOVING particle and show the
      // event it carries (track what a packet is)
      const np = nearestParticle(wpt)
      setPktHover(np?.line ? { x: e.clientX, y: e.clientY, line: np.line } : null)
      return
    }
    const dx = e.clientX - d.lastX, dy = e.clientY - d.lastY
    d.lastX = e.clientX; d.lastY = e.clientY; d.moved += Math.abs(dx) + Math.abs(dy)
    if (d.kind === 'pan') { camRef.current.ox += dx; camRef.current.oy += dy }
    else if (d.id) {
      const eng = engineRef.current
      const sx = dx / camRef.current.scale, sy = dy / camRef.current.scale
      const n = eng.nodes.get(d.id)
      if (n) { n.pinned = true; n.x += sx; n.y += sy; n.vx = 0; n.vy = 0 }
      if (d.group) for (const id of d.group) {
        const m = eng.nodes.get(id); if (m) { m.x += sx; m.y += sy; m.vx = 0; m.vy = 0 }
      }
    }
  }
  const onPointerUp = (e: React.PointerEvent) => {
    if (styleRef.current === 'three') {
      const dd = dragRef.current; dragRef.current = null
      ;(e.target as HTMLElement).releasePointerCapture?.(e.pointerId)
      if (dd && dd.moved < 4 && threeRef.current) {
        const rect = wrapRef.current!.getBoundingClientRect()
        const id = pick3D(threeRef.current, engineRef.current, e.clientX, e.clientY, rect)
        selectNode(id ? (selRef.current === id ? null : id) : null)
      }
      return
    }
    const d = dragRef.current; dragRef.current = null
    // release the shift-dragged cluster's neighbours so they relax back naturally
    // (the node you grabbed stays pinned, matching plain single-node drag)
    if (d?.group) for (const id of d.group) { const m = engineRef.current.nodes.get(id); if (m) m.pinned = false }
    if (d && d.moved < 4) {
      if (d.kind === 'node' && d.id) selectNode(selRef.current === d.id ? null : d.id)
      else {
        // clicked empty space — if it's near a moving packet, FOLLOW it (select
        // its source + isolate that flow); otherwise clear the selection
        const np = nearestParticle(toWorld(e.clientX, e.clientY))
        if (np) { selectNode(np.a); setIsolate(true) }
        else selectNode(null)
      }
    }
    ;(e.target as HTMLElement).releasePointerCapture?.(e.pointerId)
  }
  const onDoubleClick = (e: React.PointerEvent) => {
    const wpt = toWorld(e.clientX, e.clientY)
    const hit = engineRef.current.nodeAt(wpt.x, wpt.y, nodeRadius)
    if (hit && onInspectEntity) {
      if (hit.kind === 'process') onInspectEntity({ kind: 'pid', value: hit.id.slice(2), label: hit.label })
      else if (hit.kind === 'tag') onInspectEntity({ kind: 'tag', value: hit.id.slice(2), label: hit.label })
    }
  }
  const onWheel = (e: React.WheelEvent) => {
    if (styleRef.current === 'three') {
      const o = orbitRef.current
      o.dist = Math.max(200, Math.min(7000, o.dist * (e.deltaY < 0 ? 1 / 1.12 : 1.12)))
      return
    }
    const cam = camRef.current
    const r = canvasRef.current!.getBoundingClientRect()
    const mx = e.clientX - r.left, my = e.clientY - r.top
    const factor = e.deltaY < 0 ? 1.12 : 1 / 1.12
    const ns = Math.min(4, Math.max(0.25, cam.scale * factor))
    // zoom around cursor
    cam.ox = mx - (mx - cam.ox) * (ns / cam.scale)
    cam.oy = my - (my - cam.oy) * (ns / cam.scale)
    cam.scale = ns
  }

  const resetView = () => { camRef.current = { scale: 1, ox: 0, oy: 0 } }
  const clearMap = () => { engineRef.current.clear(); selectNode(null) }
  // drag the inspector's left edge to resize it (panel is right-anchored, so
  // width grows as you drag left). Listens on window so the drag is smooth.
  const startInspectorResize = (e: React.PointerEvent) => {
    e.preventDefault(); e.stopPropagation()
    const startX = e.clientX, startW = inspectorW
    const onMove = (ev: PointerEvent) => setInspectorW(Math.min(760, Math.max(260, startW - (ev.clientX - startX))))
    const onUp = () => { window.removeEventListener('pointermove', onMove); window.removeEventListener('pointerup', onUp) }
    window.addEventListener('pointermove', onMove); window.addEventListener('pointerup', onUp)
  }
  // resize the live packet feed by dragging its top-right corner (anchored
  // bottom-left, so width grows dragging right, height grows dragging up)
  const startFeedResize = (e: React.PointerEvent) => {
    e.preventDefault(); e.stopPropagation()
    const sx = e.clientX, sy = e.clientY, sw = feedSize.w, sh = feedSize.h
    const onMove = (ev: PointerEvent) => setFeedSize({
      w: Math.min(960, Math.max(300, sw + (ev.clientX - sx))),
      h: Math.min(760, Math.max(150, sh - (ev.clientY - sy))),
    })
    const onUp = () => { window.removeEventListener('pointermove', onMove); window.removeEventListener('pointerup', onUp) }
    window.addEventListener('pointermove', onMove); window.addEventListener('pointerup', onUp)
  }
  // box layout fills the view in screen space, so snap the camera to identity on enable
  const toggleBoxLayout = () => {
    const on = !cfgRef.current.boxLayout
    if (on) camRef.current = { scale: 1, ox: 0, oy: 0 }
    patch({ boxLayout: on, geometry: 'none' })   // box + geometry are mutually exclusive
  }
  // cycle through the geometric layout structures (off → ring → … → metatron)
  const cycleGeometry = () => {
    const order: GeometryShape[] = ['none', 'tree', 'radial', 'ring', 'grid', 'spiral', 'cube', 'metatron']
    const next = order[(order.indexOf(cfgRef.current.geometry) + 1) % order.length]
    if (next !== 'none') camRef.current = { scale: 1, ox: 0, oy: 0 }
    // reset scale to a full-screen fit when switching shape (user tunes from there)
    patch({ geometry: next, boxLayout: false, layoutScale: 1 })
  }

  const fitView = () => {
    const ns = [...engineRef.current.nodes.values()]
    if (!ns.length) { resetView(); return }
    let minX = Infinity, minY = Infinity, maxX = -Infinity, maxY = -Infinity
    for (const n of ns) { minX = Math.min(minX, n.x); minY = Math.min(minY, n.y); maxX = Math.max(maxX, n.x); maxY = Math.max(maxY, n.y) }
    const { w, h } = sizeRef.current, pad = 70
    const bw = Math.max(1, maxX - minX), bh = Math.max(1, maxY - minY)
    const scale = Math.min(3, Math.max(0.2, Math.min((w - pad * 2) / bw, (h - pad * 2) / bh)))
    const cx = (minX + maxX) / 2, cy = (minY + maxY) / 2
    camRef.current = { scale, ox: w / 2 - cx * scale, oy: h / 2 - cy * scale }
  }
  const zoomBy = (f: number) => {
    const cam = camRef.current, { w, h } = sizeRef.current
    const ns = Math.min(4, Math.max(0.2, cam.scale * f))
    cam.ox = w / 2 - (w / 2 - cam.ox) * (ns / cam.scale)
    cam.oy = h / 2 - (h / 2 - cam.oy) * (ns / cam.scale)
    cam.scale = ns
  }

  // ---- inspector data ----------------------------------------------------
  const eng = engineRef.current
  const selNode = selected ? eng.nodes.get(selected) : null
  const neighbors = selected ? eng.neighbors(selected) : []
  // per-node packet history: every flow event in/out of the selected node
  const nodePackets = selected ? eng.flowLog.filter(f => f.a === selected || f.b === selected).slice(-40).reverse() : []

  const jumpToLineTarget = (line: LogcatLine) => {
    const refs = line.refs || []
    for (const r of refs) {
      const id = r.targetKind === 'pid' ? 'p:' + r.target : r.targetKind === 'component' ? 'cmp:' + r.target : 'pkg:' + r.target
      if (eng.nodes.has(id)) { focusNode(id); return true }
    }
    return false
  }

  return (
    <div ref={wrapRef} className={`overflow-hidden bg-[#0a0c12] ${hidden ? 'hidden' : ''} ${mapFull ? 'fixed inset-0 z-[60]' : 'relative flex-1'}`}>
      <canvas ref={canvasRef} className={`absolute inset-0 ${renderStyle === 'canvas' ? '' : 'hidden'}`} />
      <canvas ref={pixiCanvasRef} className={`absolute inset-0 ${renderStyle === 'pixi' ? '' : 'hidden'}`} />
      <canvas ref={threeCanvasRef} className={`absolute inset-0 ${renderStyle === 'three' ? '' : 'hidden'}`} />
      <div ref={threeLabelsRef} className={`absolute inset-0 overflow-hidden pointer-events-none ${renderStyle === 'three' ? '' : 'hidden'}`} />
      {/* shared gesture surface — sits above the canvases, below the HUD/inspector */}
      <div
        className="absolute inset-0 touch-none"
        onPointerDown={onPointerDown}
        onPointerMove={onPointerMove}
        onPointerUp={onPointerUp}
        onDoubleClick={onDoubleClick as any}
        onWheel={onWheel}
        style={{ cursor: dragRef.current?.kind === 'pan' ? 'grabbing' : 'crosshair' }}
      />

      {/* top-left HUD + controls */}
      <div className="absolute top-2 left-2 right-2 flex items-center gap-1.5 flex-wrap">
        <button onClick={() => setShowSettings(v => !v)} className={`map-btn ${showSettings ? 'text-accent-green' : ''}`} title="Settings & presets">
          <Settings2 size={13} />
        </button>
        <button onClick={() => setPaused(p => !p)} className={`map-btn ${paused ? 'text-warn' : ''}`} title={paused ? 'Resume' : 'Pause — freeze the whole map to inspect'}>
          {paused ? <Play size={13} /> : <Pause size={13} />}
        </button>
        <button onClick={() => patch({ freeze: !cfg.freeze })} className={`map-btn ${cfg.freeze ? 'text-accent-green' : ''}`} title="Freeze positions — stop nodes moving/jumping (flows keep flowing). Works in every layout mode.">
          <Snowflake size={13} />
        </button>
        <button onClick={toggleBoxLayout} className={`map-btn ${cfg.boxLayout ? 'text-accent-green' : ''}`} title="Box layout — arrange nodes into 8 hub boxes, edges curve between them">
          <LayoutGrid size={13} />
        </button>
        <button onClick={cycleGeometry} className={`map-btn ${cfg.geometry !== 'none' ? 'text-accent-green' : ''}`} title={`Geometry layout: ${cfg.geometry} — click to cycle (ring · grid · spiral · cube · metatron)`}>
          <Shapes size={13} />
        </button>
        <button onClick={() => setShowEdges(v => !v)} className={`map-btn ${showEdges ? 'text-accent-green' : 'text-warn'}`} title={showEdges ? 'Hide edge overlay — declutter to watch the moving particles' : 'Show edge overlay'}>
          <Spline size={13} />
        </button>
        <button onClick={() => patch({ wireframe: !cfg.wireframe })} className={`map-btn ${cfg.wireframe ? 'text-accent-green' : ''}`} title="Wireframe mode — hollow ring nodes + crisp lines (schematic look)">
          <Hexagon size={13} />
        </button>
        {/* speed / slow-mo */}
        <div className="flex items-center gap-1 px-2 h-7 rounded bg-black/40 border border-bg-border" title="Animation speed — drag left to slow everything down">
          <Gauge size={12} className="text-text-muted" />
          <input type="range" min={0.25} max={2} step={0.05} value={cfg.timeScale} onChange={e => patch({ timeScale: Number(e.target.value) })} className="w-16 h-1 accent-accent-green" />
          <span className="text-[9px] font-mono text-text-muted w-7">{cfg.timeScale.toFixed(2)}x</span>
        </div>
        {renderStyle !== 'three' && (
          <div className="flex items-center gap-1 px-2 h-7 rounded bg-black/40 border border-bg-border" title="Layout scale — spread the whole layout bigger/smaller in place (works in every 2D mode)">
            <Scaling size={12} className="text-text-muted" />
            <input type="range" min={0.3} max={4} step={0.05} value={cfg.layoutScale} onChange={e => patch({ layoutScale: Number(e.target.value) })} className="w-16 h-1 accent-accent-green" />
            <span className="text-[9px] font-mono text-text-muted w-7">{cfg.layoutScale.toFixed(2)}x</span>
          </div>
        )}
        <button onClick={fitView} className="map-btn" title="Fit all nodes to view (zoom camera)"><Maximize size={13} /></button>
        <button onClick={() => { pendingFitRef.current = true }} className="map-btn" title="Stretch to fill — spread the layout to use the whole screen"><Frame size={13} /></button>
        <button onClick={() => zoomBy(1.2)} className="map-btn" title="Zoom in"><ZoomIn size={13} /></button>
        <button onClick={() => zoomBy(1 / 1.2)} className="map-btn" title="Zoom out"><ZoomOut size={13} /></button>
        <button onClick={resetView} className="map-btn" title="Reset view"><Crosshair size={13} /></button>
        <button onClick={clearMap} className="map-btn" title="Clear map"><Trash2 size={13} /></button>
        <button onClick={() => setShowFeed(f => !f)} className={`map-btn ${showFeed ? 'text-accent-green' : ''}`} title="Live packet feed — watch what each moving particle is, in real time">
          <Waves size={13} />
        </button>
        <button onClick={() => setShowTimeline(t => !t)} className={`map-btn ${showTimeline ? 'text-accent-green' : ''}`} title="Timeline — event volume by severity over time">
          <Clock size={13} />
        </button>
        <button onClick={() => setShowData(v => !v)} className={`map-btn ${showData ? 'text-accent-green' : ''}`} title="Data view — the map's nodes & connections as live, copyable text">
          <Table size={13} />
        </button>
        <button onClick={() => { const r = !recording; setRecording(r); if (r) { setShowFeed(true); setFeedSource('captured') } }} className={`map-btn ${recording ? 'text-red-500' : ''}`} title={recording ? 'Stop capturing packets' : 'Capture/record packets to a reviewable, exportable buffer'}>
          <Circle size={13} fill={recording ? 'currentColor' : 'none'} />
        </button>
        <button onClick={() => { setShowAlerts(v => !v); setAlertSeen(eng.alerts.length) }} className={`map-btn relative ${showAlerts ? 'text-accent-green' : eng.alerts.length > alertSeen ? 'text-warn' : ''}`} title="Critical events — crashes, ANRs, kills, errors as they happen (click to jump)">
          <AlertTriangle size={13} />
          {eng.alerts.length > alertSeen && <span className="absolute -top-1 -right-1 min-w-3 h-3 px-0.5 rounded-full bg-warn text-black text-[8px] font-bold flex items-center justify-center">{Math.min(99, eng.alerts.length - alertSeen)}</span>}
        </button>
        <button onClick={() => patch({ levelFloor: cfg.levelFloor >= 4 ? 0 : 4 })} className={`map-btn ${cfg.levelFloor >= 4 ? 'text-warn' : ''}`} title={cfg.levelFloor >= 4 ? 'Showing errors only — click for all levels' : 'Errors only — drop everything below Error severity'}>
          <Filter size={13} />
        </button>
        <button onClick={() => setShowWatch(v => !v)} className={`map-btn relative ${showWatch ? 'text-accent-green' : watch.length ? 'text-yellow-400' : ''}`} title="Watchlist — nodes you're tracking (kept pinned)">
          <Star size={13} />
          {watch.length > 0 && <span className="absolute -top-1 -right-1 min-w-3 h-3 px-0.5 rounded-full bg-yellow-400 text-black text-[8px] font-bold flex items-center justify-center">{watch.length}</span>}
        </button>
        <button onClick={() => { const on = !baselineOn; engineRef.current.setBaseline(on); setBaselineOn(on) }} className={`map-btn relative ${baselineOn ? 'text-cyan-400' : ''}`} title={baselineOn ? 'Diff active — cyan = nodes that appeared since baseline. Click to clear.' : 'Set baseline now — then anything new (after you trigger something) lights up cyan'}>
          <Flag size={13} />
          {baselineOn && (() => { const nw = [...eng.nodes.values()].filter(n => !n.baseline).length; return nw > 0 ? <span className="absolute -top-1 -right-1 min-w-3 h-3 px-0.5 rounded-full bg-cyan-400 text-black text-[8px] font-bold flex items-center justify-center">{Math.min(99, nw)}</span> : null })()}
        </button>
        {/* render-style switcher */}
        <div className="flex rounded overflow-hidden border border-bg-border ml-1 bg-black/40">
          <button onClick={() => setRenderStyle('canvas')} title="Canvas (light)"
            className={`px-1.5 py-1 ${renderStyle === 'canvas' ? 'bg-accent-green/20 text-accent-green' : 'text-text-muted hover:bg-bg-raised'}`}>
            <Square size={13} />
          </button>
          <button onClick={() => setRenderStyle('pixi')} title="Neon — GPU (PixiJS)"
            className={`px-1.5 py-1 ${renderStyle === 'pixi' ? 'bg-accent-green/20 text-accent-green' : 'text-text-muted hover:bg-bg-raised'}`}>
            <Sparkles size={13} />
          </button>
          <button onClick={() => setRenderStyle('three')} title="3D tree — hierarchical hanging tree (drag to orbit, scroll to zoom)"
            className={`px-1.5 py-1 ${renderStyle === 'three' ? 'bg-accent-green/20 text-accent-green' : 'text-text-muted hover:bg-bg-raised'}`}>
            <Box size={13} />
          </button>
        </div>
        <button onClick={() => { const nv = !mapFull; setMapFull(nv); if (nv) pendingFitRef.current = true }} className={`map-btn ml-1 ${mapFull ? 'text-accent-green' : ''}`} title={mapFull ? 'Exit fullscreen map' : 'Fullscreen — fill the whole window and stretch the layout to fit'}>{mapFull ? <Minimize2 size={13} /> : <Maximize2 size={13} />}</button>
        <button onClick={() => setShowLegend(v => !v)} className={`map-btn ${showLegend ? 'text-accent-green' : ''}`} title="Legend — what the colours & sizes mean"><Info size={13} /></button>
        <button onClick={() => setShowHelp(v => !v)} className={`map-btn ${showHelp ? 'text-accent-green' : ''}`} title="Controls & keyboard shortcuts"><Keyboard size={13} /></button>
        {!!(search && search.trim()) && (() => {
          const m = searchMatches()
          return (
            <div className="flex items-center gap-0.5 px-1.5 h-7 rounded bg-black/40 border border-accent-green/40" title="Search matches — step through and jump to each">
              <span className="text-[9px] mono text-accent-green px-0.5">{m.length ? (matchIdx % m.length) + 1 : 0}/{m.length}</span>
              <button onClick={() => stepMatch(-1)} className="map-btn"><ArrowLeft size={12} /></button>
              <button onClick={() => stepMatch(1)} className="map-btn"><ArrowRight size={12} /></button>
            </div>
          )
        })()}
        <div className="ml-1 px-2 py-1 rounded bg-black/40 text-[10px] font-mono text-text-muted flex items-center gap-2">
          <span className="text-accent-green">{stats.nodes}</span>nodes
          <span className="text-blue-400">{stats.edges}</span>edges
          <span className="text-warn">{stats.particles}</span>flows
          <span>{stats.lines.toLocaleString()} lines</span>
        </div>
        {pixiErr && <span className="px-2 py-1 rounded bg-warn/10 text-warn text-[10px] max-w-[40rem] truncate" title={pixiErr}>{pixiErr} — using Canvas</span>}
      </div>

      {paused && (
        <div className="absolute top-12 left-1/2 -translate-x-1/2 px-2.5 py-1 rounded bg-warn/15 text-warn text-[10px] font-mono pointer-events-none z-20 border border-warn/30">
          PAUSED — hover a particle to read it · space to resume
        </div>
      )}

      {!running && stats.lines === 0 && (
        <div className="absolute inset-0 flex flex-col items-center justify-center gap-2 text-text-muted pointer-events-none">
          <Activity size={30} className="opacity-30" />
          <p className="text-sm">Press <span className="text-accent-green">Start</span> — events will appear as a live map.</p>
          <p className="text-xs opacity-70">Tip: pick the <span className="mono">events</span> or <span className="mono">all</span> buffer to see system events.</p>
        </div>
      )}

      {/* hover tooltip */}
      {hover && (() => {
        const n = eng.nodes.get(hover.id); if (!n) return null
        return (
          <div className="fixed z-30 pointer-events-none px-2 py-1 rounded bg-black/85 border border-bg-border text-[10px] font-mono text-text-secondary"
            style={{ left: hover.x + 12, top: hover.y + 12 }}>
            <div className="text-text-primary">{n.label}</div>
            <div className="text-text-muted">{n.kind} · {n.count} events · sev {Math.round(n.worst)}</div>
          </div>
        )
      })()}

      {/* timeline — rolling per-second event volume, coloured by peak severity */}
      {showTimeline && (
        <div className="absolute h-14 rounded-lg bg-bg-surface/95 border border-bg-border backdrop-blur flex items-end gap-px px-2 py-1 overflow-hidden z-10"
          style={{ left: 8, right: selNode ? inspectorW + 16 : 8, bottom: 8 }}>
          {eng.tl.length === 0
            ? <span className="text-[10px] text-text-muted self-center mx-auto">Timeline — event volume by severity (press Start). Click a bar to inspect that second.</span>
            : (() => {
              const len = eng.tl.length
              const max = Math.max(1, ...eng.tl.map(b => b.reduce((s, c) => s + c, 0)))
              return eng.tl.map((b, i) => {
                const total = b.reduce((s, c) => s + c, 0)
                let sev = 0; for (let k = 5; k >= 0; k--) if (b[k] > 0) { sev = k; break }
                const hh = Math.max(3, (Math.log(1 + total) / Math.log(1 + max)) * 100)
                const ageSec = len - 1 - i
                const onPick = () => {
                  const now = performance.now()
                  setFeedWindow({ start: now - (ageSec + 1) * 1000, end: now - ageSec * 1000, label: ageSec === 0 ? 'this second' : ageSec + 's ago' })
                  setShowFeed(true); setPaused(true)
                }
                return <div key={i} onClick={onPick} className="flex-1 min-w-px rounded-sm cursor-pointer hover:opacity-100 hover:outline hover:outline-1 hover:outline-white/40" style={{ height: `${hh}%`, background: LEVEL_COLOR[sev], opacity: total ? 0.85 : 0.12 }}
                  title={`${ageSec === 0 ? 'this second' : ageSec + 's ago'} — ${total} events · V${b[0]} D${b[1]} I${b[2]} W${b[3]} E${b[4]} F${b[5]} (click to inspect)`} />
              })
            })()}
        </div>
      )}

      {/* moving-particle hover — the event this packet is carrying */}
      {pktHover && (
        <div className="fixed z-30 pointer-events-none px-2 py-1 rounded bg-black/90 border border-accent-green/40 text-[10px] font-mono max-w-[28rem]"
          style={{ left: pktHover.x + 12, top: pktHover.y + 12 }}>
          <div className="flex items-center gap-1.5">
            <span className="font-bold" style={{ color: LEVEL_COLOR[Math.min(5, levelNum(pktHover.line.level))] }}>{pktHover.line.level}</span>
            <span className="text-warn/80">{pktHover.line.tag}</span>
            {pktHover.line.pid && <span className="text-text-muted">pid {pktHover.line.pid}</span>}
          </div>
          <div className="text-text-secondary break-words">{pktHover.line.message || pktHover.line.raw}</div>
        </div>
      )}

      {/* live packet feed — what each moving particle actually is, in real time */}
      {showFeed && (
        <div className={`absolute rounded-lg bg-bg-surface/95 border border-bg-border backdrop-blur flex flex-col overflow-hidden shadow-xl ${bigPanel === 'feed' ? 'inset-6 z-40' : 'left-2 z-20'}`}
          style={bigPanel === 'feed' ? undefined : { width: feedSize.w, height: feedSize.h, bottom: showTimeline ? 72 : 8 }}>
          {/* drag the top-right corner to resize (when not expanded) */}
          {bigPanel !== 'feed' && <div onPointerDown={startFeedResize} className="absolute top-0 right-0 w-3 h-3 cursor-nesw-resize hover:bg-accent-green/50 z-10" title="Drag to resize" />}
          <div className="px-3 py-1.5 border-b border-bg-border flex items-center justify-between">
            <p className="section-title flex items-center gap-1">
              <Waves size={11} /> {feedWindow ? `Packets @ ${feedWindow.label}` : 'Live packets'}
              {feedWindow
                ? <button onClick={() => setFeedWindow(null)} className="text-accent-green font-normal normal-case ml-1 underline">← back to live</button>
                : <span className="text-text-muted font-normal normal-case">— click to follow</span>}
            </p>
            <div className="flex gap-1">
              <button onClick={() => setBigPanel(bigPanel === 'feed' ? null : 'feed')} className="map-btn" title={bigPanel === 'feed' ? 'Restore' : 'Expand to fullscreen'}>{bigPanel === 'feed' ? <Shrink size={12} /> : <Expand size={12} />}</button>
              <button onClick={() => { setShowFeed(false); setBigPanel(p => p === 'feed' ? null : p) }} className="map-btn"><X size={12} /></button>
            </div>
          </div>
          {(eng.captured.length > 0 || recording) && (
            <div className="px-3 py-1 border-b border-bg-border/60 flex items-center gap-2 text-[10px]">
              <button onClick={() => setFeedSource('live')} className={feedSource === 'live' ? 'text-accent-green' : 'text-text-muted'}>Live</button>
              <button onClick={() => setFeedSource('captured')} className={feedSource === 'captured' ? 'text-accent-green' : 'text-text-muted'}>Captured ({eng.captured.length})</button>
              {recording && <span className="text-red-500 flex items-center gap-1"><Circle size={8} fill="currentColor" /> rec</span>}
              <button onClick={exportCaptured} className="ml-auto text-text-muted hover:text-accent-green underline" title="Copy captured packets to clipboard as JSON">copy JSON</button>
            </div>
          )}
          <div className="overflow-auto flex-1 px-1 py-1 space-y-0.5">
            {(() => {
              let evs = [...(feedSource === 'captured' ? eng.captured : eng.flowLog)]
              if (feedWindow) evs = evs.filter(f => f.ts >= feedWindow.start && f.ts <= feedWindow.end)
              if (!evs.length) return <p className="text-[10px] text-text-muted px-2 py-2">{feedWindow ? 'No packets kept for this moment (only the most recent ~160 are buffered).' : 'No flows yet — press Start and pick the all/events buffer.'}</p>
              return evs.slice(-80).reverse().map((f, i) => {
              const aN = eng.nodes.get(f.a), bN = eng.nodes.get(f.b)
              const col = KIND_COLOR[f.kind] || '#3b82f6'
              const lv = Math.min(5, Math.max(0, Math.round(f.level)))
              return (
                <button key={i} onClick={() => focusNode(f.b)} title="Follow this packet to its destination node"
                  className="w-full text-left px-1.5 py-1 rounded hover:bg-bg-raised text-[10px] leading-tight">
                  <div className="flex items-center gap-1.5">
                    <span className="shrink-0 w-3 font-bold" style={{ color: LEVEL_COLOR[lv] }}>{LEVELS[lv]}</span>
                    <span className="mono text-accent-green truncate flex-1 min-w-0">{aN?.label || f.a.slice(2)}</span>
                    <ArrowRight size={10} className="shrink-0" style={{ color: col }} />
                    <span className="mono text-blue-300 truncate flex-1 min-w-0">{bN?.label || f.b.slice(2)}</span>
                    <span className="px-1 rounded text-[8px] shrink-0" style={{ background: col + '33', color: col }}>{KIND_LABEL[f.kind] || f.kind}</span>
                  </div>
                  {f.msg && <div className="mono text-text-secondary truncate pl-4 opacity-80">{f.msg}</div>}
                </button>
              )
              })
            })()}
          </div>
        </div>
      )}

      {/* legend — what the colours & sizes mean */}
      {showLegend && (
        <div className="absolute top-12 right-2 w-52 rounded-lg bg-bg-surface/95 border border-bg-border backdrop-blur p-3 shadow-xl z-30 text-[10px] space-y-2">
          <div className="flex items-center justify-between"><p className="section-title">Legend</p><button onClick={() => setShowLegend(false)} className="map-btn"><X size={11} /></button></div>
          <div>
            <p className="text-text-muted mb-1">Severity (node colour at warn+)</p>
            <div className="flex flex-wrap gap-1">
              {LEVELS.map((l, i) => <span key={l} className="flex items-center gap-1"><span className="w-2.5 h-2.5 rounded-full inline-block" style={{ background: LEVEL_COLOR[i] }} />{['Verbose', 'Debug', 'Info', 'Warn', 'Error', 'Fatal'][i]}</span>)}
            </div>
          </div>
          <div>
            <p className="text-text-muted mb-1">Node kind <span className="opacity-70">— click to show/hide</span></p>
            <div className="flex flex-wrap gap-x-2 gap-y-1">
              {([['process', 'Process'], ['tag', 'Tag'], ['package', 'Package'], ['component', 'Component']] as const).map(([k, lbl]) => {
                const off = hiddenKinds.includes(k)
                return <button key={k} onClick={() => toggleKind(k)} title={off ? 'Hidden — click to show' : 'Shown — click to hide'} className={`flex items-center gap-1 ${off ? 'opacity-30 line-through' : 'hover:text-text-primary'}`}><span className="w-2.5 h-2.5 rounded-full inline-block" style={{ background: kindBase(k) }} />{lbl}</button>
              })}
            </div>
          </div>
          <p className="text-text-muted">Node <b>size</b> = recent activity. Node colour: <b>{cfg.nodeColorMode}</b>. Edges: <b>{cfg.edgeColorMode === 'source' ? 'source hub' : cfg.edgeColorMode}</b>. Moving dots = packets (events) flowing source→target. (Change in Settings → Colour coding.)</p>
        </div>
      )}

      {/* controls & shortcuts */}
      {showHelp && (
        <div className="absolute top-12 left-1/2 -translate-x-1/2 w-80 rounded-lg bg-bg-surface/95 border border-bg-border backdrop-blur p-3 shadow-xl z-40 text-[11px] space-y-1">
          <div className="flex items-center justify-between"><p className="section-title">Controls</p><button onClick={() => setShowHelp(false)} className="map-btn"><X size={11} /></button></div>
          {([['Space', 'Pause / resume (freeze to grab particles)'], ['Esc', 'Clear selection'], ['Drag', 'Pan (2D) · Orbit (3D globe)'], ['Scroll', 'Zoom'], ['Click node', 'Select + inspect'], ['Click packet', 'Follow its flow (isolates it)'], ['Hover packet', 'See the event it carries'], ['Shift+drag', 'Move a node + its connections'], ['❄ button', 'Freeze positions (stop jumping)'], ['◫ button', 'Hide edges to declutter']] as const).map(([k, d]) =>
            <div key={k} className="flex gap-2"><span className="mono text-accent-green w-20 shrink-0">{k}</span><span className="text-text-secondary">{d}</span></div>)}
        </div>
      )}

      {/* critical events / alerts — the "something broke, here" panel */}
      {showAlerts && (
        <div className="absolute top-12 right-2 w-72 max-h-[60%] rounded-lg bg-bg-surface/95 border border-warn/40 backdrop-blur flex flex-col overflow-hidden shadow-xl z-40 text-[10px]">
          <div className="px-3 py-1.5 border-b border-bg-border flex items-center justify-between">
            <p className="section-title flex items-center gap-1 text-warn"><AlertTriangle size={11} /> Critical events ({eng.alerts.length})</p>
            <button onClick={() => setShowAlerts(false)} className="map-btn"><X size={12} /></button>
          </div>
          <div className="overflow-auto flex-1 px-1 py-1 space-y-0.5">
            {eng.alerts.length === 0 && <p className="text-text-muted px-2 py-2">No errors or crashes yet. Errors (E), Fatals (F), crashes, ANRs &amp; kills land here as they happen.</p>}
            {[...eng.alerts].slice(-120).reverse().map((al, i) => {
              const n = eng.nodes.get(al.id)
              const lv = Math.min(5, Math.max(0, Math.round(al.level)))
              return (
                <button key={i} onClick={() => focusNode(al.id)} title="Jump to this node on the map" className="w-full text-left px-1.5 py-1 rounded hover:bg-bg-raised leading-tight">
                  <div className="flex items-center gap-1.5">
                    <span className="shrink-0 font-bold w-3" style={{ color: LEVEL_COLOR[lv] }}>{LEVELS[lv]}</span>
                    {al.rule && <span className="px-1 rounded text-[8px] bg-accent-green/25 text-accent-green shrink-0" title={`matched your rule: ${al.rule}`}>⌕</span>}
                    <span className="mono text-text-primary truncate flex-1 min-w-0">{n?.label || al.id.slice(2)}</span>
                    <span className="text-warn/80 mono shrink-0 truncate max-w-[5rem]">{al.tag}</span>
                  </div>
                  <div className="mono text-text-secondary truncate pl-4 opacity-80">{al.msg}</div>
                </button>
              )
            })}
          </div>
          <div className="px-2 py-1.5 border-t border-bg-border space-y-1">
            <div className="flex gap-1">
              <input value={ruleInput} onChange={e => setRuleInput(e.target.value)} onKeyDown={e => { if (e.key === 'Enter') addRule() }} placeholder="Alert when tag/text contains…" className="flex-1 min-w-0 bg-bg-base border border-bg-border rounded px-1.5 py-0.5 text-[10px] outline-none focus:border-warn text-text-primary" />
              <button onClick={addRule} className="px-2 py-0.5 rounded text-[10px] bg-warn/20 text-warn border border-warn/30">Add</button>
            </div>
            {alertRules.length > 0 && <div className="flex flex-wrap gap-1">
              {alertRules.map(r => <span key={r} className="flex items-center rounded text-[9px] bg-bg-raised border border-bg-border overflow-hidden">
                <span className="px-1.5 py-0.5 text-accent-green">⌕ {r}</span>
                <button onClick={() => setAlertRules(a => a.filter(x => x !== r))} className="px-1 text-text-muted hover:text-warn border-l border-bg-border"><X size={8} /></button>
              </span>)}
            </div>}
          </div>
        </div>
      )}

      {/* watchlist — nodes the analyst is tracking (kept pinned, easy to revisit) */}
      {showWatch && (
        <div className="absolute top-12 right-2 w-64 max-h-[55%] rounded-lg bg-bg-surface/95 border border-yellow-400/40 backdrop-blur flex flex-col overflow-hidden shadow-xl z-40 text-[10px]">
          <div className="px-3 py-1.5 border-b border-bg-border flex items-center justify-between">
            <p className="section-title flex items-center gap-1 text-yellow-400"><Star size={11} /> Watchlist ({watch.length})</p>
            <div className="flex gap-1">
              {watch.length > 0 && <button onClick={() => setWatch([])} className="text-text-muted hover:text-warn underline normal-case font-normal">clear</button>}
              <button onClick={() => setShowWatch(false)} className="map-btn"><X size={12} /></button>
            </div>
          </div>
          <div className="overflow-auto flex-1 px-1 py-1 space-y-0.5">
            {watch.length === 0 && <p className="text-text-muted px-2 py-2">Empty. Select a node and hit the ★ to watch it — watched nodes stay pinned and never fade out.</p>}
            {watch.map(id => {
              const n = eng.nodes.get(id)
              const sev = n ? Math.min(5, Math.round(n.worst)) : 0
              return (
                <div key={id} className="w-full flex items-center gap-1.5 px-1.5 py-1 rounded hover:bg-bg-raised">
                  <span className="w-2 h-2 rounded-full shrink-0" style={{ background: n ? (sev >= 3 ? LEVEL_COLOR[sev] : kindBase(n.kind)) : '#555' }} />
                  <button onClick={() => focusNode(id)} className="mono text-text-primary truncate flex-1 min-w-0 text-left" title="Jump to this node">{n?.label || id.slice(2)}</button>
                  <span className="text-text-muted shrink-0">{n ? n.count : '–'}</span>
                  <button onClick={() => toggleWatch(id)} className="text-text-muted hover:text-warn shrink-0" title="Stop watching"><X size={10} /></button>
                </div>
              )
            })}
          </div>
        </div>
      )}

      {/* data view — the live map as a plain-text, copyable table */}
      {showData && (
        <div className={`absolute rounded-lg bg-bg-surface/95 border border-bg-border backdrop-blur flex flex-col overflow-hidden shadow-xl ${bigPanel === 'data' ? 'inset-6 z-40' : 'top-12 left-2 w-[30rem] max-h-[72%] z-30'}`}>
          <div className="px-3 py-1.5 border-b border-bg-border flex items-center justify-between">
            <p className="section-title flex items-center gap-1"><Table size={11} /> Data (text)</p>
            <div className="flex gap-1">
              <button onClick={() => { try { navigator.clipboard?.writeText(mapDataText(eng)) } catch { /* */ } }} className="map-btn" title="Copy all as text"><Copy size={12} /></button>
              <button onClick={() => setBigPanel(bigPanel === 'data' ? null : 'data')} className="map-btn" title={bigPanel === 'data' ? 'Restore' : 'Expand to fullscreen'}>{bigPanel === 'data' ? <Shrink size={12} /> : <Expand size={12} />}</button>
              <button onClick={() => { setShowData(false); setBigPanel(p => p === 'data' ? null : p) }} className="map-btn"><X size={12} /></button>
            </div>
          </div>
          <pre className="text-[10px] mono whitespace-pre overflow-auto flex-1 px-2 py-1 text-text-secondary leading-tight">{mapDataText(eng)}</pre>
        </div>
      )}

      {/* settings drawer */}
      {showSettings && <SettingsDrawer cfg={cfg} patch={patch} applyPreset={applyPreset} userPresets={userPresets} saveUserPreset={saveUserPreset} deleteUserPreset={deleteUserPreset} onClose={() => setShowSettings(false)} />}

      {/* inspector — resizable: drag its left edge */}
      {selNode && (
        <div className={`absolute rounded-lg bg-bg-surface/95 border border-bg-border backdrop-blur flex flex-col overflow-hidden shadow-xl ${bigPanel === 'inspector' ? 'inset-6 z-40' : 'top-2 right-2 bottom-2'}`} style={bigPanel === 'inspector' ? undefined : { width: inspectorW }}>
          {bigPanel !== 'inspector' && <div onPointerDown={startInspectorResize} className="absolute left-0 top-0 bottom-0 w-1.5 cursor-ew-resize hover:bg-accent-green/50 z-10" title="Drag to resize panel" />}
          <div className="px-3 py-2 border-b border-bg-border flex items-start justify-between gap-2">
            <div className="min-w-0">
              <p className="mono text-xs text-text-primary break-all">{selNode.label}</p>
              <p className="text-[10px] text-text-muted mt-0.5">{selNode.kind} · {selNode.count} events</p>
            </div>
            <div className="flex gap-1 shrink-0">
              <button onClick={() => selected && toggleWatch(selected)} title="Watch — keep this node on your watchlist (never evicted)" className={`map-btn ${selected && watch.includes(selected) ? 'text-yellow-400' : ''}`}><Star size={13} /></button>
              <button onClick={() => setIsolate(v => !v)} title="Isolate — show only this node and its connections" className={`map-btn ${isolate ? 'text-accent-green' : ''}`}><Focus size={13} /></button>
              <button onClick={() => setBigPanel(bigPanel === 'inspector' ? null : 'inspector')} className="map-btn" title={bigPanel === 'inspector' ? 'Restore' : 'Expand to fullscreen'}>{bigPanel === 'inspector' ? <Shrink size={13} /> : <Expand size={13} />}</button>
              <button onClick={() => { selectNode(null); setBigPanel(p => p === 'inspector' ? null : p) }} title="Close (Esc, or click empty space)" className="map-btn"><X size={13} /></button>
            </div>
          </div>

          {/* severity histogram */}
          <div className="px-3 py-2 border-b border-bg-border/60">
            <div className="flex gap-0.5 h-6 items-end">
              {selNode.levels.map((c, i) => {
                const max = Math.max(1, ...selNode.levels)
                return <div key={i} className="flex-1 rounded-sm" title={`${LEVELS[i]}: ${c}`}
                  style={{ height: `${Math.max(2, (c / max) * 100)}%`, background: LEVEL_COLOR[i], opacity: c ? 0.9 : 0.25 }} />
              })}
            </div>
            <div className="flex gap-0.5 mt-0.5">
              {LEVELS.map(l => <div key={l} className="flex-1 text-center text-[8px] text-text-muted">{l}</div>)}
            </div>
            {onInspectEntity && (
              <button
                onClick={() => onInspectEntity(selNode.kind === 'tag'
                  ? { kind: 'tag', value: selNode.id.slice(2), label: selNode.label }
                  : { kind: 'pid', value: selNode.id.slice(2), label: selNode.label })}
                className="btn-ghost text-[10px] w-full justify-center mt-2">
                <Zap size={10} /> Filter text log to this
              </button>
            )}
          </div>

          {/* connections */}
          <div className="px-3 py-2 border-b border-bg-border/60">
            <p className="section-title mb-1">Connections ({neighbors.length})</p>
            <div className="space-y-0.5 max-h-32 overflow-auto">
              {neighbors.length === 0 && <p className="text-[10px] text-text-muted">No edges yet.</p>}
              {neighbors.map(({ node, edge, dir }) => (
                <button key={edge.id} onClick={() => focusNode(node.id)}
                  className="w-full flex items-center gap-1.5 text-left px-1.5 py-1 rounded hover:bg-bg-raised text-[10px]">
                  {dir === 'out' ? <ArrowRight size={10} style={{ color: KIND_COLOR[edge.kind] }} />
                    : <ArrowLeft size={10} style={{ color: KIND_COLOR[edge.kind] }} />}
                  <span className="mono text-text-secondary truncate flex-1">{shortLabel(node.label)}</span>
                  <span className="px-1 rounded text-[8px]" style={{ background: KIND_COLOR[edge.kind] + '33', color: KIND_COLOR[edge.kind] }}>
                    {KIND_LABEL[edge.kind]}
                  </span>
                  <span className="text-text-muted">{edge.count}</span>
                </button>
              ))}
            </div>
          </div>

          {/* packet history — every flow in/out of this node, newest first */}
          <div className="px-3 py-2 border-b border-bg-border/60">
            <p className="section-title mb-1">Packets in / out ({nodePackets.length})</p>
            <div className="space-y-0.5 max-h-28 overflow-auto">
              {nodePackets.length === 0 && <p className="text-[10px] text-text-muted">No packets yet.</p>}
              {nodePackets.map((f, i) => {
                const out = f.a === selected
                const other = out ? f.b : f.a
                const oN = eng.nodes.get(other)
                const col = KIND_COLOR[f.kind] || '#3b82f6'
                const lv = Math.min(5, Math.max(0, Math.round(f.level)))
                return (
                  <button key={i} onClick={() => focusNode(other)} title="Follow to the other end"
                    className="w-full text-left flex items-center gap-1 px-1 py-0.5 rounded hover:bg-bg-raised text-[10px]">
                    {out ? <ArrowRight size={9} style={{ color: col }} className="shrink-0" /> : <ArrowLeft size={9} style={{ color: col }} className="shrink-0" />}
                    <span className="shrink-0 font-bold w-3" style={{ color: LEVEL_COLOR[lv] }}>{LEVELS[lv]}</span>
                    <span className="mono text-text-secondary truncate flex-1 min-w-0">{shortLabel(oN?.label || other.slice(2))}</span>
                    <span className="mono text-text-muted truncate flex-[2] min-w-0">{f.msg}</span>
                  </button>
                )
              })}
            </div>
          </div>

          {/* recent events — click a line to jump to where it goes */}
          <div className="px-3 py-2 flex-1 overflow-hidden flex flex-col">
            <p className="section-title mb-1">Recent events</p>
            <p className="text-[9px] text-text-muted mb-1">Lines with a <span className="text-accent-green">→</span> reference another entity — click to jump there.</p>
            <div className="space-y-0.5 overflow-auto flex-1 -mx-1 px-1">
              {[...selNode.recent].reverse().map((l, i) => {
                const lv = levelNum(l.level)
                const hasTarget = (l.refs || []).length > 0
                const inner = (
                  <>
                    <span className="shrink-0 w-3 font-bold" style={{ color: LEVEL_COLOR[lv] }}>{l.level}</span>
                    <span className="shrink-0 text-warn/80 mono truncate w-16">{l.tag}</span>
                    <span className="mono text-text-secondary truncate flex-1">{l.message || l.raw}</span>
                    {hasTarget && <ArrowRight size={9} className="shrink-0 text-accent-green mt-0.5" />}
                  </>
                )
                return hasTarget ? (
                  <button key={i} onClick={() => jumpToLineTarget(l)} title="Jump to the entity this line references"
                    className="w-full text-left px-1.5 py-1 rounded hover:bg-accent-green/10 text-[10px] leading-tight flex gap-1.5">
                    {inner}
                  </button>
                ) : (
                  <div key={i} className="w-full px-1.5 py-1 text-[10px] leading-tight flex gap-1.5 opacity-60">{inner}</div>
                )
              })}
            </div>
          </div>
        </div>
      )}
    </div>
  )
}

// ---- helpers --------------------------------------------------------------
function kindBase(kind: string): string {
  return kind === 'tag' ? '#22d3ee' : kind === 'process' ? '#34d399' : kind === 'component' ? '#a78bfa' : '#60a5fa'
}
function hexA(hex: string, a: number): string {
  const c = hex.replace('#', '')
  const r = parseInt(c.slice(0, 2), 16), g = parseInt(c.slice(2, 4), 16), b = parseInt(c.slice(4, 6), 16)
  return `rgba(${r},${g},${b},${Math.max(0, Math.min(1, a))})`
}
// directional arrowhead near b — shows which way a flow goes on a focused edge
function drawArrowCanvas(ctx: CanvasRenderingContext2D, a: GNode, b: GNode, col: string, scale: number) {
  const dx = b.x - a.x, dy = b.y - a.y, d = Math.hypot(dx, dy) || 1
  const ux = dx / d, uy = dy / d
  const tx = b.x - ux * (nodeRadius(b) + 2), ty = b.y - uy * (nodeRadius(b) + 2)
  const s = 6 / scale
  ctx.fillStyle = hexA(col, 0.95)
  ctx.beginPath()
  ctx.moveTo(tx, ty)
  ctx.lineTo(tx - ux * s - uy * s * 0.55, ty - uy * s + ux * s * 0.55)
  ctx.lineTo(tx - ux * s + uy * s * 0.55, ty - uy * s - ux * s * 0.55)
  ctx.closePath(); ctx.fill()
}
// Pythagorean tetractys (10 points, rows 1/2/3/4) laid out inside a rect, with
// the triangular-lattice connecting lines — drawn as an overlay over box mode.
function tetractysPoints(rect: { x: number; y: number; w: number; h: number }): { x: number; y: number }[] {
  const cx = rect.x + rect.w / 2, top = rect.y + rect.h * 0.08, rowGap = rect.h * 0.84 / 3
  const colGap = Math.min(rect.w, rect.h * 1.1) / 3.4
  const pts: { x: number; y: number }[] = []
  for (let r = 0; r < 4; r++) { const y = top + r * rowGap, sx = cx - (r * colGap) / 2; for (let c = 0; c <= r; c++) pts.push({ x: sx + c * colGap, y }) }
  return pts
}
function tetractysLines(): [number, number][] {
  const idx = (r: number, c: number) => r * (r + 1) / 2 + c, out: [number, number][] = []
  for (let r = 0; r < 4; r++) for (let c = 0; c <= r; c++) {
    if (r < 3) { out.push([idx(r, c), idx(r + 1, c)]); out.push([idx(r, c), idx(r + 1, c + 1)]) }
    if (c < r) out.push([idx(r, c), idx(r, c + 1)])
  }
  return out
}
function boxesBounds(boxes: BoxRect[]): { x: number; y: number; w: number; h: number } | null {
  if (!boxes.length) return null
  let a = Infinity, b = Infinity, c = -Infinity, d = -Infinity
  for (const x of boxes) { a = Math.min(a, x.x); b = Math.min(b, x.y); c = Math.max(c, x.x + x.w); d = Math.max(d, x.y + x.h) }
  return { x: a, y: b, w: c - a, h: d - b }
}
function drawTetractysCanvas(ctx: CanvasRenderingContext2D, boxes: BoxRect[], scale: number) {
  const bb = boxesBounds(boxes); if (!bb) return
  const pts = tetractysPoints(bb), lines = tetractysLines()
  ctx.strokeStyle = 'rgba(214,178,124,0.22)'; ctx.lineWidth = 1.2 / scale
  ctx.beginPath()
  for (const [i, j] of lines) { ctx.moveTo(pts[i].x, pts[i].y); ctx.lineTo(pts[j].x, pts[j].y) }
  ctx.stroke()
  ctx.fillStyle = 'rgba(214,178,124,0.55)'
  for (const p of pts) { ctx.beginPath(); ctx.arc(p.x, p.y, 3.5 / scale, 0, 7); ctx.fill() }
}
function drawBoxesCanvas(ctx: CanvasRenderingContext2D, boxes: BoxRect[], cam: { scale: number; ox: number; oy: number }) {
  for (const b of boxes) {
    ctx.fillStyle = 'rgba(120,150,200,0.035)'
    ctx.fillRect(b.x, b.y, b.w, b.h)
    ctx.strokeStyle = 'rgba(130,160,210,0.28)'; ctx.lineWidth = 1.5 / cam.scale
    ctx.strokeRect(b.x, b.y, b.w, b.h)
    ctx.font = `${12 / cam.scale}px 'JetBrains Mono', monospace`
    ctx.fillStyle = 'rgba(205,218,242,0.72)'; ctx.textAlign = 'left'
    ctx.fillText(shortLabel(b.label) + '  ·' + b.count, b.x + 8 / cam.scale, b.y + 16 / cam.scale)
  }
}
function drawGrid(ctx: CanvasRenderingContext2D, w: number, h: number, cam: { scale: number; ox: number; oy: number }, on?: boolean) {
  if (!on) return
  const step = 60
  const x0 = -cam.ox / cam.scale, y0 = -cam.oy / cam.scale
  const x1 = x0 + w / cam.scale, y1 = y0 + h / cam.scale
  ctx.strokeStyle = 'rgba(80,110,160,0.06)'; ctx.lineWidth = 1 / cam.scale
  ctx.beginPath()
  for (let x = Math.floor(x0 / step) * step; x < x1; x += step) { ctx.moveTo(x, y0); ctx.lineTo(x, y1) }
  for (let y = Math.floor(y0 / step) * step; y < y1; y += step) { ctx.moveTo(x0, y); ctx.lineTo(x1, y) }
  ctx.stroke()
}

// ---- PixiJS (Neon GPU) renderer — the "TorFlow" look ---------------------
// Unlike the Canvas path (a node-link graph with a faint glow), the Neon path
// is built around FLOW: every active edge is a curved arc that continuously
// emits a stream of glowing particles travelling a->b, with the emission rate
// proportional to the edge weight. Many overlapping additive particles form
// rivers of light (à la unchartedsoftware/torflow). Edges themselves are faint
// guides; the moving particles are the visualisation. Node halos bloom via a
// blurred additive container; flow particles ride a crisp additive layer above.
// This renderer owns its OWN particle system (s.flows) — it does NOT use the
// engine's eng.particles, so the Canvas renderer is completely unaffected.
interface FlowP {
  ek: string      // edge id (a>b) — positions/curve looked up live each frame
  t: number       // 0..1 progress along the arc
  speed: number
  col: number     // tint
  size: number    // base screen px
  line?: LogcatLine  // the event this particle carries (for hover-inspect)
}
interface PixiScene {
  app: Application
  stage: Container
  edgeG: Graphics
  glowC: Container      // node halos — blurred (soft bloom)
  flowC: Container      // flow particles — crisp additive (the streams)
  nodeG: Graphics
  labelC: Container
  glowTex: Texture
  dotTex: Texture
  glowPool: Sprite[]    // node-halo sprites
  flowPool: Sprite[]    // flow-particle sprites
  flows: FlowP[]
  emitAcc: Map<string, number>  // per-edge fractional emission accumulator
  labels: Map<string, Text>
  boxLabels: Text[]             // box-layout labels (pooled)
}

// Stable curved control point for an edge: midpoint pushed perpendicular, with a
// deterministic sign per edge id so arcs don't flicker/flip frame to frame.
function edgeCurve(ax: number, ay: number, bx: number, by: number, id: string) {
  const dx = bx - ax, dy = by - ay
  const len = Math.hypot(dx, dy) || 1
  let h = 0; for (let i = 0; i < id.length; i++) h = (h * 31 + id.charCodeAt(i)) >>> 0
  const sign = (h & 1) ? 1 : -1
  const off = Math.min(60, len * 0.2) * sign
  return { cx: (ax + bx) / 2 + (-dy / len) * off, cy: (ay + by) / 2 + (dx / len) * off }
}
function bezier(a: number, c: number, b: number, t: number): number {
  const mt = 1 - t
  return mt * mt * a + 2 * mt * t * c + t * t * b
}

function hexNum(hex: string): number { return parseInt(hex.replace('#', ''), 16) }

function makeRadialTexture(size: number, coreStop: number): Texture {
  const c = document.createElement('canvas'); c.width = c.height = size
  const g = c.getContext('2d')!
  const grd = g.createRadialGradient(size / 2, size / 2, 0, size / 2, size / 2, size / 2)
  grd.addColorStop(0, 'rgba(255,255,255,1)')
  if (coreStop > 0) grd.addColorStop(coreStop, 'rgba(255,255,255,0.55)')
  grd.addColorStop(1, 'rgba(255,255,255,0)')
  g.fillStyle = grd; g.fillRect(0, 0, size, size)
  return Texture.from(c)
}

async function createPixiScene(canvas: HTMLCanvasElement, w: number, h: number): Promise<PixiScene> {
  const app = new Application()
  await app.init({
    canvas, width: w, height: h,
    backgroundColor: 0x0a0c12, antialias: true, autoStart: false,
    resolution: Math.min(window.devicePixelRatio || 1, 2), autoDensity: true,
    preference: 'webgl',
  })
  const stage = app.stage
  const edgeG = new Graphics()              // faint arc guides (bottom)
  const glowC = new Container()             // node halos — blurred soft bloom
  glowC.filters = [new BlurFilter({ strength: 12, quality: 2 })]
  const flowC = new Container()             // flow particles — crisp additive streams
  const nodeG = new Graphics()              // crisp node cores on top
  const labelC = new Container()
  stage.addChild(edgeG, glowC, flowC, nodeG, labelC)
  return {
    app, stage, edgeG, glowC, flowC, nodeG, labelC,
    glowTex: makeRadialTexture(64, 0), dotTex: makeRadialTexture(48, 0.35),
    glowPool: [], flowPool: [], flows: [], emitAcc: new Map(), labels: new Map(), boxLabels: [],
  }
}

function flowSprite(s: PixiScene, i: number): Sprite {
  let sp = s.flowPool[i]
  if (!sp) { sp = new Sprite(s.dotTex); sp.anchor.set(0.5); sp.blendMode = 'add'; s.flowC.addChild(sp); s.flowPool[i] = sp }
  return sp
}

// Emit + advance the per-edge particle streams. Rate ∝ edge weight so busy
// connections become dense rivers and idle ones a trickle. dt is real ms (the
// caller passes timeScale-adjusted dt); clamped so a frame hitch can't dump a
// burst or cull the whole stream at once.
function updateFlows(s: PixiScene, eng: LogGraph, cfg: GraphConfig, dtRaw: number) {
  const dt = Math.min(dtRaw, 64) / 1000
  const cap = cfg.maxParticles
  // emit
  for (const e of eng.edges.values()) {
    if (s.flows.length >= cap) break
    const w = Math.min(8, e.weight)
    if (w < 0.15) continue
    const acc = (s.emitAcc.get(e.id) || 0) + w * cfg.particleIntensity * 7 * dt
    let n = Math.floor(acc)
    s.emitAcc.set(e.id, acc - n)
    const col = hexNum(edgeColor(e, cfg.edgeColorMode))
    const line = eng.nodes.get(e.a)?.recent.slice(-1)[0]   // latest event on the source
    while (n-- > 0 && s.flows.length < cap) {
      s.flows.push({
        ek: e.id, t: 0,
        speed: (0.35 + (s.flows.length % 7) * 0.03) * cfg.particleSpeed,
        col, size: e.worst >= 3 ? 14 : 9, line,
      })
    }
  }
  // advance + cull
  const keep: FlowP[] = []
  for (const p of s.flows) {
    p.t += p.speed * dt
    if (p.t < 1 && eng.edges.has(p.ek)) keep.push(p)
  }
  s.flows = keep
  if (s.emitAcc.size > 4000) s.emitAcc.clear()
}

function glowSprite(s: PixiScene, i: number, tex: Texture): Sprite {
  let sp = s.glowPool[i]
  if (!sp) { sp = new Sprite(tex); sp.anchor.set(0.5); sp.blendMode = 'add'; s.glowC.addChild(sp); s.glowPool[i] = sp }
  else if (sp.texture !== tex) sp.texture = tex
  return sp
}

function renderPixi(s: PixiScene, eng: LogGraph, cam: { scale: number; ox: number; oy: number }, cfg: GraphConfig, sel: string | null, hov: string | null, pulse: { id: string; until: number } | null, dt: number, paused: boolean, showEdges: boolean, isolateOn: boolean, search: string, watched: Set<string>, hiddenKinds: Set<string>) {
  s.stage.scale.set(cam.scale); s.stage.position.set(cam.ox, cam.oy)
  const focus = sel || hov
  const neighborIds = new Set<string>()
  if (focus) for (const n of eng.neighbors(focus)) neighborIds.add(n.node.id)
  const iso = (isolateOn && sel) ? sel : null
  const isoVisible = (id: string) => !iso || id === iso || neighborIds.has(id)
  const q = search
  const matchNode = (n: GNode) => !q || n.label.toLowerCase().includes(q) || n.id.toLowerCase().includes(q)
  const kindHidden = (id: string) => { const nn = eng.nodes.get(id); return !!nn && hiddenKinds.has(nn.kind) }

  // box-layout rectangles + labels (drawn beneath everything)
  s.edgeG.clear()
  let bl = 0
  if (cfg.boxLayout) {
    for (const b of eng.boxes) {
      s.edgeG.rect(b.x, b.y, b.w, b.h).fill({ color: 0x7896c8, alpha: 0.04 }).stroke({ width: 1.5 / cam.scale, color: 0x82a0d2, alpha: 0.28 })
      let t = s.boxLabels[bl]
      if (!t) { t = new Text({ text: '', style: { fontFamily: 'JetBrains Mono, monospace', fontSize: 12, fill: 0xcddaf2 } }); t.anchor.set(0, 0); s.labelC.addChild(t); s.boxLabels[bl] = t }
      t.visible = true
      const lbl = shortLabel(b.label) + '  ·' + b.count
      if (t.text !== lbl) t.text = lbl
      t.position.set(b.x + 8 / cam.scale, b.y + 6 / cam.scale); t.scale.set(1 / cam.scale)
      bl++
    }
  }
  for (let i = bl; i < s.boxLabels.length; i++) s.boxLabels[i].visible = false

  // faint curved arc guides — the particles, not these lines, carry the meaning.
  // Overlay toggle hides them entirely so the moving streams read cleanly.
  if (showEdges) for (const e of eng.edges.values()) {
    if (iso && e.a !== iso && e.b !== iso) continue
    if (hiddenKinds.size && (kindHidden(e.a) || kindHidden(e.b))) continue
    const a = eng.nodes.get(e.a), b = eng.nodes.get(e.b)
    if (!a || !b) continue
    const rel = e.a === focus || e.b === focus
    let alpha: number, width: number
    if (!focus)   { alpha = Math.min(0.22, e.weight * 0.02 + 0.06); width = Math.min(2, 0.6 + e.weight * 0.1) / cam.scale + 0.2 }
    else if (rel) { alpha = Math.min(0.5, 0.22 + e.weight * 0.04); width = Math.min(3.5, 1 + e.weight * 0.2) / cam.scale + 0.25 }
    else          { alpha = 0.03; width = 0.4 / cam.scale }
    const col = hexNum(edgeColor(e, cfg.edgeColorMode))
    const { cx, cy } = edgeCurve(a.x, a.y, b.x, b.y, e.id)
    s.edgeG.moveTo(a.x, a.y).quadraticCurveTo(cx, cy, b.x, b.y).stroke({ width, color: col, alpha })
  }

  // node halos → soft bloom (blurred additive container) — skipped in wireframe
  let gi = 0
  if (!cfg.wireframe) for (const n of eng.nodes.values()) {
    if (iso && !isoVisible(n.id)) continue
    if (hiddenKinds.has(n.kind)) continue
    const r = nodeRadius(n)
    const col = nodeColor(n, cfg.nodeColorMode)
    const dim = (focus && n.id !== focus && !neighborIds.has(n.id)) || !matchNode(n)
    const sp = glowSprite(s, gi++, s.glowTex)
    sp.visible = true; sp.tint = hexNum(col)
    sp.alpha = (dim ? 0.1 : 0.6) * (0.5 + Math.min(1, n.heat / 4)) * cfg.glow
    sp.position.set(n.x, n.y); sp.width = sp.height = r * 7
  }
  for (let i = gi; i < s.glowPool.length; i++) s.glowPool[i].visible = false

  // ---- the rivers: continuous per-edge particle streams along the arcs -----
  if (!paused) updateFlows(s, eng, cfg, dt)
  let fi = 0
  for (const p of s.flows) {
    const e = eng.edges.get(p.ek); if (!e) continue
    if (iso && e.a !== iso && e.b !== iso) continue
    if (hiddenKinds.size && (kindHidden(e.a) || kindHidden(e.b))) continue
    const a = eng.nodes.get(e.a), b = eng.nodes.get(e.b)
    if (!a || !b) continue
    const dim = focus && e.a !== focus && e.b !== focus && !neighborIds.has(e.a) && !neighborIds.has(e.b)
    const { cx, cy } = edgeCurve(a.x, a.y, b.x, b.y, e.id)
    const x = bezier(a.x, cx, b.x, p.t), y = bezier(a.y, cy, b.y, p.t)
    const sp = flowSprite(s, fi++)
    sp.visible = true; sp.tint = p.col
    // fade in at the source, out at the target → comet-like streaks
    const fade = Math.min(1, p.t * 5) * Math.min(1, (1 - p.t) * 5)
    sp.alpha = (dim ? 0.12 : 0.95) * fade
    sp.position.set(x, y)
    sp.width = sp.height = p.size / cam.scale   // constant on-screen size
  }
  for (let i = fi; i < s.flowPool.length; i++) s.flowPool[i].visible = false

  // crisp cores + selection rings
  s.nodeG.clear()
  for (const n of eng.nodes.values()) {
    if (iso && !isoVisible(n.id)) continue
    if (hiddenKinds.has(n.kind)) continue
    const r = nodeRadius(n)
    const col = nodeColor(n, cfg.nodeColorMode)
    const dim = (focus && n.id !== focus && !neighborIds.has(n.id)) || !matchNode(n)
    if (cfg.wireframe) s.nodeG.circle(n.x, n.y, r).stroke({ width: 1.5 / cam.scale, color: hexNum(col), alpha: dim ? 0.3 : 0.95 })
    else s.nodeG.circle(n.x, n.y, r).fill({ color: hexNum(col), alpha: dim ? 0.35 : 1 })
    if (n.id === sel || n.id === hov) s.nodeG.circle(n.x, n.y, r + 3 / cam.scale).stroke({ width: 1.5 / cam.scale, color: 0xffffff, alpha: 0.9 })
    else if (q && matchNode(n)) s.nodeG.circle(n.x, n.y, r + 3 / cam.scale).stroke({ width: 2 / cam.scale, color: 0x34d399, alpha: 0.95 })
    if (watched.has(n.id)) s.nodeG.circle(n.x, n.y, r + 6 / cam.scale).stroke({ width: 2 / cam.scale, color: 0xfacc15, alpha: 0.9 })
    if (eng.baselineActive && !n.baseline) s.nodeG.circle(n.x, n.y, r + 9 / cam.scale).stroke({ width: 2.5 / cam.scale, color: 0x22d3ee, alpha: 0.95 })
  }
  if (pulse && performance.now() < pulse.until) {
    const pn = eng.nodes.get(pulse.id)
    if (pn) {
      const k = 1 - (pulse.until - performance.now()) / 1300
      s.nodeG.circle(pn.x, pn.y, nodeRadius(pn) + k * 44 / cam.scale).stroke({ width: 2 / cam.scale, color: 0xffffff, alpha: (1 - k) * 0.85 })
    }
  }
  // tetractys overlay on box mode
  if (cfg.boxLayout) {
    const bb = boxesBounds(eng.boxes)
    if (bb) {
      const pts = tetractysPoints(bb), lines = tetractysLines()
      for (const [i, j] of lines) s.nodeG.moveTo(pts[i].x, pts[i].y).lineTo(pts[j].x, pts[j].y)
      s.nodeG.stroke({ width: 1.2 / cam.scale, color: 0xd6b27c, alpha: 0.22 })
      for (const p of pts) s.nodeG.circle(p.x, p.y, 3.5 / cam.scale).fill({ color: 0xd6b27c, alpha: 0.55 })
    }
  }

  // pooled labels for prominent nodes
  const used = new Set<string>()
  if (cam.scale > 0.45) {
    for (const n of eng.nodes.values()) {
      if (used.size >= 50) break
      const big = n.heat > 1.2 || n.id === sel || n.id === hov || neighborIds.has(n.id)
      if (!big) continue
      used.add(n.id)
      let t = s.labels.get(n.id)
      if (!t) {
        t = new Text({ text: '', style: { fontFamily: 'JetBrains Mono, monospace', fontSize: 11, fill: 0xdfe6f5 } })
        t.anchor.set(0.5, 0); s.labelC.addChild(t); s.labels.set(n.id, t)
      }
      t.visible = true
      const lbl = shortLabel(n.label)
      if (t.text !== lbl) t.text = lbl
      t.position.set(n.x, n.y + nodeRadius(n) + 4 / cam.scale)
      t.scale.set(1 / cam.scale)
    }
  }
  for (const [id, t] of s.labels) if (!used.has(id)) t.visible = false

  s.app.renderer.render(s.stage)
}

function destroyPixiScene(s: PixiScene) {
  try { s.app.destroy({ removeView: false }, { children: true, texture: false }) } catch { /* ignore */ }
}

// ---- Three.js — 3D globe + TorFlow-style flowing arcs --------------------
// Faithful to unchartedsoftware/torflow's technique: particle motion happens
// ENTIRELY in the vertex shader from a STATIC per-particle buffer (path start
// in `position`, end in aEnd, two cubic-bézier control params with perpendicular
// offsets in aParam) + a `uTime` uniform — so each edge becomes a BUNDLE of
// curved arcs of looping glowing packets (the signature look), not a CPU lerp.
// Nodes sit at stable hash-placed lat/lon on a dark wireframe globe; the solid
// sphere occludes far-side arcs for depth. Orbit: drag = rotate, scroll = zoom.
const NODE_CAP3 = 600, FLOW_CAP3 = 6000, GLOBE_R = 360, STREAK_CAP = 500
const ARC_SAMPLES = 18, ARC_CAP_V = 900 * (ARC_SAMPLES - 1) * 2   // line-segment vertices
const ARC_LIFT = 0.06
function bez3(t: number, a: number[], b: number[], c: number[], d: number[]): number[] {
  const m = 1 - t, w0 = m * m * m, w1 = 3 * m * m * t, w2 = 3 * m * t * t, w3 = t * t * t
  return [a[0] * w0 + b[0] * w1 + c[0] * w2 + d[0] * w3, a[1] * w0 + b[1] * w1 + c[1] * w2 + d[1] * w3, a[2] * w0 + b[2] * w1 + c[2] * w2 + d[2] * w3]
}
function norm3(v: number[]): number[] { const l = Math.hypot(v[0], v[1], v[2]) || 1; return [v[0] / l, v[1] / l, v[2] / l] }
// 3D position = the node's hanging-tree spot (engine assigns it incrementally).
function node3D(n: GNode): [number, number, number] {
  return [n.tx ?? 0, n.ty ?? 0, n.tz ?? 0]
}
interface ThreeScene {
  renderer: THREE.WebGLRenderer
  scene: THREE.Scene
  camera: THREE.PerspectiveCamera
  globe: THREE.Mesh; wire: THREE.LineSegments
  nodePts: THREE.Points; nodeGeo: THREE.BufferGeometry
  flowPts: THREE.Points; flowGeo: THREE.BufferGeometry; flowMat: THREE.ShaderMaterial
  arcSeg: THREE.LineSegments; arcGeo: THREE.BufferGeometry
  streakSeg: THREE.LineSegments; streakGeo: THREE.BufferGeometry
  streaks: { src: string; dst: string; t: number; speed: number; sev: number }[]
  streakAcc: Map<string, number>
  labels: HTMLSpanElement[]
  flowKey: string; t0: number
}
function pointMaterial(): THREE.ShaderMaterial {
  return new THREE.ShaderMaterial({
    transparent: true, depthWrite: false, vertexColors: true, uniforms: {},
    vertexShader: 'attribute float size; varying vec3 vCol; void main(){ vCol=color; vec4 mv=modelViewMatrix*vec4(position,1.0); gl_PointSize=size*(420.0/max(1.0,-mv.z)); gl_Position=projectionMatrix*mv; }',
    fragmentShader: 'varying vec3 vCol; void main(){ vec2 d=gl_PointCoord-vec2(0.5); float r=dot(d,d); if(r>0.25) discard; float a=smoothstep(0.25,0.16,r); gl_FragColor=vec4(vCol,a); }',
  })
}
// TorFlow-style shader: cubic-bézier arc (start, two offset control pts, end),
// animated by uTime with a per-particle random phase + distance-scaled speed.
const FLOW_VERT = `
attribute vec3 aEnd; attribute vec4 aParam;
uniform float uTime; uniform float uSpeed; uniform float uLift; uniform float uSize;
varying vec3 vCol; varying float vFade;
vec3 bez(float t, vec3 a, vec3 b, vec3 c, vec3 d){ float m=1.0-t; return a*m*m*m + b*3.0*m*m*t + c*3.0*m*t*t + d*t*t*t; }
float rnd(vec2 co){ return fract(sin(dot(co, vec2(12.9898,78.233)))*43758.5453); }
void main(){
  vCol = color;
  vec3 s1 = position; vec3 s4 = aEnd;
  vec3 diff = s4 - s1; float dist = length(diff);
  vec3 perp = normalize(cross(s1, s4) + vec3(0.00001));
  float R = length(s1);
  vec3 p1 = normalize(s1 + diff*aParam.x + perp*(aParam.y*dist)) * (R + uLift*dist);
  vec3 p2 = normalize(s1 + diff*aParam.z - perp*(aParam.w*dist)) * (R + uLift*dist);
  float r0 = rnd(s1.xy + aParam.xy); float r1 = rnd(s1.yz + aParam.zw);
  float nSpeed = uSpeed + uSpeed*r1;
  float t = mod(uTime + r0*nSpeed, nSpeed) / nSpeed;
  vFade = sin(t*3.14159265);
  vec3 pos = bez(t, s1, p1, p2, s4);
  vec4 mv = modelViewMatrix * vec4(pos, 1.0);
  gl_PointSize = uSize * (420.0/max(1.0,-mv.z)) * (0.5 + 0.7*vFade);
  gl_Position = projectionMatrix * mv;
}`
const FLOW_FRAG = `
precision highp float; varying vec3 vCol; varying float vFade;
void main(){ vec2 d=gl_PointCoord-vec2(0.5); float r2=dot(d,d); if(r2>0.25) discard; float a=smoothstep(0.25,0.02,r2)*clamp(vFade,0.0,1.0); gl_FragColor=vec4(vCol,a); }`
function attr(geo: THREE.BufferGeometry, name: string, n: number, itemSize: number) {
  geo.setAttribute(name, new THREE.BufferAttribute(new Float32Array(n * itemSize), itemSize))
}
function makeThreeScene(canvas: HTMLCanvasElement, w: number, h: number): ThreeScene {
  const renderer = new THREE.WebGLRenderer({ canvas, antialias: true })
  renderer.setPixelRatio(Math.min(window.devicePixelRatio || 1, 2))
  renderer.setSize(w, h, false)
  renderer.setClearColor(0x070a12, 1)
  const scene = new THREE.Scene()
  const camera = new THREE.PerspectiveCamera(55, w / h, 1, 100000)
  // globe: solid dark sphere (occludes far-side arcs) + faint wireframe grid
  const globe = new THREE.Mesh(new THREE.SphereGeometry(GLOBE_R, 36, 26), new THREE.MeshBasicMaterial({ color: 0x070b16 }))
  const wire = new THREE.LineSegments(new THREE.WireframeGeometry(new THREE.SphereGeometry(GLOBE_R * 1.001, 28, 18)), new THREE.LineBasicMaterial({ color: 0x1d3e63, transparent: true, opacity: 0.28 }))
  const nodeGeo = new THREE.BufferGeometry()
  attr(nodeGeo, 'position', NODE_CAP3, 3); attr(nodeGeo, 'color', NODE_CAP3, 3); attr(nodeGeo, 'size', NODE_CAP3, 1)
  const nodePts = new THREE.Points(nodeGeo, pointMaterial()); nodePts.frustumCulled = false
  const flowGeo = new THREE.BufferGeometry()
  attr(flowGeo, 'position', FLOW_CAP3, 3); attr(flowGeo, 'aEnd', FLOW_CAP3, 3); attr(flowGeo, 'aParam', FLOW_CAP3, 4); attr(flowGeo, 'color', FLOW_CAP3, 3)
  const flowMat = new THREE.ShaderMaterial({
    transparent: true, depthWrite: false, vertexColors: true, blending: THREE.AdditiveBlending,
    uniforms: { uTime: { value: 0 }, uSpeed: { value: 6.0 }, uLift: { value: 0.12 }, uSize: { value: 5.0 } },
    vertexShader: FLOW_VERT, fragmentShader: FLOW_FRAG,
  })
  const flowPts = new THREE.Points(flowGeo, flowMat); flowPts.frustumCulled = false
  // faint static connection arcs (the "wireframe" of who-connects-to-whom)
  const arcGeo = new THREE.BufferGeometry()
  attr(arcGeo, 'position', ARC_CAP_V, 3); attr(arcGeo, 'color', ARC_CAP_V, 3)
  const arcSeg = new THREE.LineSegments(arcGeo, new THREE.LineBasicMaterial({ vertexColors: true, transparent: true, opacity: 0.6, blending: THREE.AdditiveBlending, depthWrite: false })); arcSeg.frustumCulled = false
  // clean moving flow streaks (comets travelling source → destination)
  const streakGeo = new THREE.BufferGeometry()
  attr(streakGeo, 'position', STREAK_CAP * 2, 3); attr(streakGeo, 'color', STREAK_CAP * 2, 3)
  const streakSeg = new THREE.LineSegments(streakGeo, new THREE.LineBasicMaterial({ vertexColors: true, transparent: true, blending: THREE.AdditiveBlending, depthWrite: false })); streakSeg.frustumCulled = false
  scene.add(globe, wire, arcSeg, streakSeg, nodePts)   // flowPts (old particle storm) no longer added
  return { renderer, scene, camera, globe, wire, nodePts, nodeGeo, flowPts, flowGeo, flowMat, arcSeg, arcGeo, streakSeg, streakGeo, streaks: [], streakAcc: new Map(), labels: [], flowKey: '', t0: performance.now() }
}
// (re)build BOTH the static per-particle flow buffer (each edge → a bundle of
// particles, count ∝ weight, fanned bézier arcs — always on) AND the faint
// static connection arcs (the wireframe, toggled by the overlay button).
function buildFlows(s: ThreeScene, eng: LogGraph, iso: string | null, showArcs: boolean, hiddenKinds: Set<string>) {
  // 3D draws ONLY the tree edges (each node → its parent), not the whole 895-edge
  // web — that's what made it an unreadable storm. ~one edge per node.
  const edges: GEdge[] = []
  for (const n of eng.nodes.values()) {
    if (!n.tparent) continue
    if (iso && n.id !== iso && n.tparent !== iso) continue
    if (hiddenKinds.size) { const p = eng.nodes.get(n.tparent); if (hiddenKinds.has(n.kind) || (p && hiddenKinds.has(p.kind))) continue }
    const e = eng.edges.get(n.tparent + '>' + n.id) || eng.edges.get(n.id + '>' + n.tparent)
    edges.push(e || { id: n.tparent + '>' + n.id, a: n.tparent, b: n.id, kind: 'cooccur', weight: 1, count: 1, worst: 0, lastTs: 0 })
  }
  const c = new THREE.Color()
  s.flowGeo.setDrawRange(0, 0)   // old particle storm disabled; flows are streak-lines now (updateStreaks)

  // --- connection lines: ALWAYS shown in 3D (the tree IS the structure), drawn
  // STRAIGHT parent→child so the streaks ride exactly along them. ~one per node. ---
  const ap = s.arcGeo.attributes.position.array as Float32Array
  const acol = s.arcGeo.attributes.color.array as Float32Array
  let av = 0
  for (const e of edges) {
    if (av + 2 > ARC_CAP_V) break
    const a = eng.nodes.get(e.a), b = eng.nodes.get(e.b); if (!a || !b) continue
    const pa = node3D(a), pb = node3D(b)
    ap[av * 3] = pa[0]; ap[av * 3 + 1] = pa[1]; ap[av * 3 + 2] = pa[2]
    acol[av * 3] = 0.26; acol[av * 3 + 1] = 0.38; acol[av * 3 + 2] = 0.52; av++
    ap[av * 3] = pb[0]; ap[av * 3 + 1] = pb[1]; ap[av * 3 + 2] = pb[2]
    acol[av * 3] = 0.26; acol[av * 3 + 1] = 0.38; acol[av * 3 + 2] = 0.52; av++
  }
  s.arcGeo.setDrawRange(0, av)
  s.arcGeo.attributes.position.needsUpdate = true; s.arcGeo.attributes.color.needsUpdate = true
}
// emit + advance the clean flow streaks (comets travelling src → dst along tree edges)
function updateStreaks(s: ThreeScene, eng: LogGraph, dtRaw: number, iso: string | null, hiddenKinds: Set<string>) {
  const dt = Math.min(dtRaw, 64) / 1000
  for (const n of eng.nodes.values()) {
    if (s.streaks.length >= STREAK_CAP) break
    if (!n.tparent) continue
    if (iso && n.id !== iso && n.tparent !== iso) continue
    if (hiddenKinds.size) { const p = eng.nodes.get(n.tparent); if (hiddenKinds.has(n.kind) || (p && hiddenKinds.has(p.kind))) continue }
    const fwd = eng.edges.get(n.tparent + '>' + n.id), rev = eng.edges.get(n.id + '>' + n.tparent)
    const e = fwd || rev
    const src = fwd ? n.tparent : rev ? n.id : n.tparent
    const dst = fwd ? n.id : rev ? n.tparent : n.id
    const w = e ? Math.min(8, e.weight) : 0.5
    const key = n.tparent + '>' + n.id
    const acc = (s.streakAcc.get(key) || 0) + w * 1.3 * dt   // visible but still trackable
    let cnt = Math.floor(acc); s.streakAcc.set(key, acc - cnt)
    while (cnt-- > 0 && s.streaks.length < STREAK_CAP) s.streaks.push({ src, dst, t: 0, speed: 0.45 + Math.random() * 0.25, sev: e ? e.worst : 0 })
  }
  const keep: ThreeScene['streaks'] = []
  for (const st of s.streaks) { st.t += st.speed * dt; if (st.t < 1) keep.push(st) }
  s.streaks = keep
  if (s.streakAcc.size > 3000) s.streakAcc.clear()
}
const _c3 = new THREE.Color(), _pv = new THREE.Vector3()
function renderThree(s: ThreeScene, eng: LogGraph, orbit: { az: number; el: number; dist: number }, _size: { w: number; h: number }, sel: string | null, hov: string | null, showEdges: boolean, isolateOn: boolean, search: string, host: HTMLDivElement | null, watched: Set<string>, hiddenKinds: Set<string>, dt: number, paused: boolean) {
  eng.placeTree3D()   // give any new nodes a stable hanging-tree spot
  s.globe.visible = false; s.wire.visible = false   // no globe in tree mode
  // centre the orbit on the tree's vertical centroid (it grows downward)
  let cyAcc = 0, cn = 0
  for (const n of eng.nodes.values()) if (n.ty !== undefined) { cyAcc += n.ty; cn++ }
  const tgtY = cn ? cyAcc / cn : 0
  const ce = Math.cos(orbit.el), se = Math.sin(orbit.el)
  s.camera.position.set(Math.sin(orbit.az) * ce * orbit.dist, tgtY + se * orbit.dist, Math.cos(orbit.az) * ce * orbit.dist)
  s.camera.lookAt(0, tgtY, 0)
  const focus = sel || hov
  const neighborIds = new Set<string>()
  if (focus) for (const n of eng.neighbors(focus)) neighborIds.add(n.node.id)
  const iso = (isolateOn && sel) ? sel : null
  const q = search
  const match = (n: GNode) => !q || n.label.toLowerCase().includes(q) || n.id.toLowerCase().includes(q)

  // rebuild the static flow buffer only when the edge set / isolate / toggle changes
  const key = eng.edges.size + '|' + (iso || '') + '|' + (showEdges ? '1' : '0') + '|' + [...hiddenKinds].sort().join(',')
  if (key !== s.flowKey) { buildFlows(s, eng, iso, showEdges, hiddenKinds); s.flowKey = key }

  // clean flow streaks: short comets travelling source → destination so you can
  // follow where each packet is going (space/pause freezes them)
  if (!paused) updateStreaks(s, eng, dt, iso, hiddenKinds)
  const stp = s.streakGeo.attributes.position.array as Float32Array, stc = s.streakGeo.attributes.color.array as Float32Array
  let sti = 0
  for (const st of s.streaks) {
    if (sti >= STREAK_CAP) break
    const a = eng.nodes.get(st.src), b = eng.nodes.get(st.dst); if (!a || !b) continue
    const pa = node3D(a), pb = node3D(b)
    const tH = st.t, tT = Math.max(0, st.t - 0.16), o = sti * 6
    _c3.set(st.sev >= 3 ? '#ff5050' : '#7fd4ff')
    stp[o] = pa[0] + (pb[0] - pa[0]) * tT; stp[o + 1] = pa[1] + (pb[1] - pa[1]) * tT; stp[o + 2] = pa[2] + (pb[2] - pa[2]) * tT
    stc[o] = _c3.r * 0.04; stc[o + 1] = _c3.g * 0.04; stc[o + 2] = _c3.b * 0.04   // dark tail (fades on additive)
    stp[o + 3] = pa[0] + (pb[0] - pa[0]) * tH; stp[o + 4] = pa[1] + (pb[1] - pa[1]) * tH; stp[o + 5] = pa[2] + (pb[2] - pa[2]) * tH
    stc[o + 3] = _c3.r; stc[o + 4] = _c3.g; stc[o + 5] = _c3.b   // bright head
    sti++
  }
  s.streakGeo.setDrawRange(0, sti * 2)
  s.streakGeo.attributes.position.needsUpdate = true; s.streakGeo.attributes.color.needsUpdate = true

  const np = s.nodeGeo.attributes.position.array as Float32Array, nc = s.nodeGeo.attributes.color.array as Float32Array, ns = s.nodeGeo.attributes.size.array as Float32Array
  let ni = 0
  for (const n of eng.nodes.values()) {
    if (ni >= NODE_CAP3) break
    if (iso && n.id !== iso && !neighborIds.has(n.id)) continue
    if (hiddenKinds.has(n.kind)) continue
    const p = node3D(n)
    np[ni * 3] = p[0]; np[ni * 3 + 1] = p[1]; np[ni * 3 + 2] = p[2]
    const dim = (focus && n.id !== focus && !neighborIds.has(n.id)) || !match(n)
    _c3.set(nodeColor(n, eng.cfg.nodeColorMode))
    const f = dim ? 0.3 : 1
    nc[ni * 3] = _c3.r * f; nc[ni * 3 + 1] = _c3.g * f; nc[ni * 3 + 2] = _c3.b * f
    ns[ni] = (n.id === sel ? 1.8 : watched.has(n.id) ? 1.4 : (eng.baselineActive && !n.baseline) ? 1.5 : 1) * (5 + nodeRadius(n) * 0.85)
    ni++
  }
  s.nodeGeo.setDrawRange(0, ni)
  s.nodeGeo.attributes.position.needsUpdate = true; s.nodeGeo.attributes.color.needsUpdate = true; s.nodeGeo.attributes.size.needsUpdate = true

  s.renderer.render(s.scene, s.camera)

  // DOM label overlay (projected from 3D) so you can read nodes while orbiting
  if (host) {
    let li = 0
    for (const n of eng.nodes.values()) {
      if (li >= 44) break
      if (iso && n.id !== iso && !neighborIds.has(n.id)) continue
      if (hiddenKinds.has(n.kind)) continue
      const big = n.heat > 6 || n.id === sel || n.id === hov || neighborIds.has(n.id) || (q && match(n)) || watched.has(n.id) || (eng.baselineActive && !n.baseline)
      if (!big) continue
      const p = node3D(n)
      _pv.set(p[0], p[1], p[2]).project(s.camera)
      if (_pv.z > 1) continue
      let el = s.labels[li]
      if (!el) {
        el = document.createElement('span')
        el.style.cssText = 'position:absolute;transform:translate(-50%,-160%);font:11px "JetBrains Mono",monospace;color:#dfe6f5;text-shadow:0 1px 3px #000,0 0 2px #000;pointer-events:none;white-space:nowrap'
        host.appendChild(el); s.labels[li] = el
      }
      el.style.display = 'block'
      el.style.left = (_pv.x * 0.5 + 0.5) * 100 + '%'
      el.style.top = (-_pv.y * 0.5 + 0.5) * 100 + '%'
      el.style.color = n.id === sel ? '#ffffff' : '#dfe6f5'
      const txt = shortLabel(n.label)
      if (el.textContent !== txt) el.textContent = txt
      li++
    }
    for (let i = li; i < s.labels.length; i++) s.labels[i].style.display = 'none'
  }
}
function pick3D(s: ThreeScene, eng: LogGraph, clientX: number, clientY: number, rect: DOMRect): string | null {
  let best: string | null = null, bestD = 22
  for (const n of eng.nodes.values()) {
    const p = node3D(n)
    _pv.set(p[0], p[1], p[2]).project(s.camera)
    if (_pv.z > 1) continue
    const sx = (_pv.x * 0.5 + 0.5) * rect.width + rect.left
    const sy = (-_pv.y * 0.5 + 0.5) * rect.height + rect.top
    const d = Math.hypot(sx - clientX, sy - clientY)
    if (d < bestD) { bestD = d; best = n.id }
  }
  return best
}
function destroyThreeScene(s: ThreeScene) {
  try {
    s.nodeGeo.dispose(); s.flowGeo.dispose(); s.arcGeo.dispose(); s.streakGeo.dispose(); s.globe.geometry.dispose(); s.wire.geometry.dispose()
    ;(s.nodePts.material as THREE.Material).dispose(); s.flowMat.dispose(); (s.arcSeg.material as THREE.Material).dispose(); (s.streakSeg.material as THREE.Material).dispose()
    ;(s.globe.material as THREE.Material).dispose(); (s.wire.material as THREE.Material).dispose()
    s.renderer.dispose()
  } catch { /* ignore */ }
}

// ---- settings drawer ------------------------------------------------------
function SettingsDrawer({ cfg, patch, applyPreset, userPresets, saveUserPreset, deleteUserPreset, onClose }: { cfg: GraphConfig; patch: (p: Partial<GraphConfig>) => void; applyPreset: (name: string) => void; userPresets: Record<string, Partial<GraphConfig>>; saveUserPreset: (name: string) => void; deleteUserPreset: (name: string) => void; onClose: () => void }) {
  const [presetName, setPresetName] = useState('')
  return (
    <div className="absolute top-12 left-2 w-64 max-h-[calc(100%-3.5rem)] overflow-auto rounded-lg bg-bg-surface/95 border border-bg-border backdrop-blur p-3 space-y-3 shadow-xl text-xs">
      <div className="flex items-center justify-between">
        <p className="section-title">Map settings</p>
        <button onClick={onClose} className="map-btn"><X size={12} /></button>
      </div>

      <Section title="Presets">
        <p className="text-[10px] text-text-muted -mt-1">One-click looks. <b>See everything</b> stops nodes from fading.</p>
        <div className="flex flex-wrap gap-1">
          {Object.keys(PRESETS).map(name => (
            <button key={name} onClick={() => applyPreset(name)}
              className="px-2 py-0.5 rounded text-[10px] bg-bg-raised hover:bg-accent-green/20 hover:text-accent-green border border-bg-border">
              {name}
            </button>
          ))}
        </div>
        {Object.keys(userPresets).length > 0 && (
          <>
            <p className="text-[10px] text-text-muted">Your presets</p>
            <div className="flex flex-wrap gap-1">
              {Object.keys(userPresets).map(name => (
                <span key={name} className="flex items-center rounded text-[10px] bg-bg-raised border border-bg-border overflow-hidden">
                  <button onClick={() => applyPreset(name)} className="px-2 py-0.5 hover:bg-accent-green/20 hover:text-accent-green">{name}</button>
                  <button onClick={() => deleteUserPreset(name)} title="Delete preset" className="px-1 py-0.5 text-text-muted hover:text-warn border-l border-bg-border"><X size={9} /></button>
                </span>
              ))}
            </div>
          </>
        )}
        <div className="flex gap-1 pt-0.5">
          <input value={presetName} onChange={e => setPresetName(e.target.value)} placeholder="Save current as…"
            onKeyDown={e => { if (e.key === 'Enter') { saveUserPreset(presetName); setPresetName('') } }}
            className="flex-1 min-w-0 bg-bg-base border border-bg-border rounded px-1.5 py-0.5 text-[10px] outline-none focus:border-accent-green text-text-primary" />
          <button onClick={() => { saveUserPreset(presetName); setPresetName('') }}
            className="px-2 py-0.5 rounded text-[10px] bg-accent-green/20 text-accent-green border border-accent-green/30">Save</button>
        </div>
      </Section>

      <Section title="Grouping & edges">
        <Seg label="Nodes" hint="What each node represents: a process/app, or a log tag (subsystem)." value={cfg.grouping} opts={[['process', 'Process'], ['tag', 'Tag']]} onChange={v => patch({ grouping: v as any })} />
        <Toggle label="Co-occurrence edges" hint="Link nodes that log within a short time window — the ambient 'active together' web." v={cfg.cooccur} onChange={v => patch({ cooccur: v })} />
        <Slider label="Co-occur window" hint="How close in time two log lines must be to draw an ambient edge." v={cfg.cooccurWindowMs} min={50} max={1000} step={25} unit="ms" onChange={v => patch({ cooccurWindowMs: v })} />
        <Toggle label="Parsed relationships" hint="Real edges mined from messages/system events: launches, crashes, kills, signals." v={cfg.parsed} onChange={v => patch({ parsed: v })} />
        <Toggle label="Generic mentions (noisy)" hint="Also link any package name mentioned in a message. Lots more edges, more noise." v={cfg.mentions} onChange={v => patch({ mentions: v })} />
      </Section>

      <Section title="Colour coding">
        <Seg label="Node colour" hint="Auto = by kind, turning amber→red as severity rises. Or force: by kind, by severity (always), or a unique hue per node (hub)." value={cfg.nodeColorMode} opts={[['auto', 'Auto'], ['kind', 'Kind'], ['severity', 'Sev'], ['hub', 'Hub']]} onChange={v => patch({ nodeColorMode: v as any })} />
        <Seg label="Edge colour" hint="Per source-hub hue (read who-talks-to-whom), by relationship kind, or by severity. Crashes/kills keep their meaning colour in hub mode." value={cfg.edgeColorMode} opts={[['source', 'Hub'], ['kind', 'Kind'], ['severity', 'Sev']]} onChange={v => patch({ edgeColorMode: v as any })} />
        <Toggle label="Wireframe nodes" hint="Hollow ring nodes + crisp lines (schematic look), no halos/fills." v={cfg.wireframe} onChange={v => patch({ wireframe: v })} />
        <Slider label="Glow" hint="Bloom strength for the Neon renderer + node halos. Lower = subtler." v={cfg.glow} min={0.1} max={1.6} step={0.05} onChange={v => patch({ glow: v })} />
      </Section>

      <Section title="Fade / persistence">
        <Slider label="Node fade" hint="How long a node stays before fading. Higher = keep history longer (less 'disappearing')." v={cfg.nodeHalfLifeMs} min={2000} max={120000} step={1000} unit="ms" onChange={v => patch({ nodeHalfLifeMs: v })} />
        <Slider label="Edge fade" hint="How long an idle connection lingers before fading out." v={cfg.edgeHalfLifeMs} min={2000} max={120000} step={1000} unit="ms" onChange={v => patch({ edgeHalfLifeMs: v })} />
      </Section>

      <Section title="Layout">
        <Slider label="Repulsion" hint="How hard nodes push apart. Higher spreads the hairball out." v={cfg.repulsion} min={1000} max={12000} step={200} onChange={v => patch({ repulsion: v })} />
        <Slider label="Link distance" hint="Resting length of a connection's spring." v={cfg.linkDistance} min={30} max={220} step={5} onChange={v => patch({ linkDistance: v })} />
        <Slider label="Gravity" hint="Pull toward the centre. Lower lets the graph spread wider." v={cfg.gravity} min={0} max={0.08} step={0.002} onChange={v => patch({ gravity: v })} />
        <Slider label="Cluster by kind" hint="Pull same-kind nodes together into groups." v={cfg.clusterByKind} min={0} max={1} step={0.05} onChange={v => patch({ clusterByKind: v })} />
        <Toggle label="Freeze layout" hint="Stop nodes moving (flows keep animating)." v={cfg.freeze} onChange={v => patch({ freeze: v })} />
      </Section>

      <Section title="Motion, particles & glow">
        <Slider label="Speed (slow-mo)" hint="Global animation speed. Drag left to slow everything down." v={cfg.timeScale} min={0.25} max={2} step={0.05} unit="x" onChange={v => patch({ timeScale: v })} />
        <Slider label="Flow intensity" hint="Fraction of log lines that emit a particle (severe events always do)." v={cfg.particleIntensity} min={0} max={1} step={0.05} onChange={v => patch({ particleIntensity: v })} />
        <Slider label="Flow speed" hint="How fast particles travel along edges." v={cfg.particleSpeed} min={0.2} max={2.5} step={0.1} onChange={v => patch({ particleSpeed: v })} />
        <Slider label="Glow" hint="Bloom/glow strength. Lower = subtler." v={cfg.glow} min={0.1} max={1.6} step={0.05} onChange={v => patch({ glow: v })} />
        <Slider label="Max flows" hint="Hard cap on simultaneous particles." v={cfg.maxParticles} min={500} max={8000} step={250} onChange={v => patch({ maxParticles: v })} />
      </Section>

      <Section title="Filtering & limits">
        <Seg label="Min level" hint="Hide log lines below this severity (V<D<I<W<E<F)." value={String(cfg.levelFloor)}
          opts={LEVELS.map((l, i) => [String(i), l] as [string, string])} onChange={v => patch({ levelFloor: Number(v) })} />
        <Slider label="Max nodes" hint="Cap on nodes; coldest are evicted past this." v={cfg.maxNodes} min={30} max={400} step={10} onChange={v => patch({ maxNodes: v })} />
        <Slider label="Max edges" hint="Cap on connections kept." v={cfg.maxEdges} min={100} max={2500} step={50} onChange={v => patch({ maxEdges: v })} />
        <Toggle label="Background grid" hint="Show a faint reference grid." v={!!cfg.showGrid} onChange={v => patch({ showGrid: v })} />
      </Section>
    </div>
  )
}

function Section({ title, children }: { title: string; children: React.ReactNode }) {
  return <div className="space-y-1.5 pt-1 border-t border-bg-border/50 first:border-0 first:pt-0">
    <p className="text-[10px] uppercase tracking-wide text-text-muted">{title}</p>{children}
  </div>
}
function Toggle({ label, v, hint, onChange }: { label: string; v: boolean; hint?: string; onChange: (v: boolean) => void }) {
  return (
    <div className="flex items-center justify-between gap-2" title={hint}>
      <span className="text-[11px] text-text-secondary cursor-help">{label}</span>
      <button role="switch" aria-checked={v} onClick={() => onChange(!v)}
        className={`relative h-4 w-7 rounded-full shrink-0 transition-colors ${v ? 'bg-accent-green' : 'bg-bg-border'}`}>
        <span className={`absolute top-0.5 h-3 w-3 rounded-full bg-bg-surface transition-all ${v ? 'left-[14px]' : 'left-0.5'}`} />
      </button>
    </div>
  )
}
function Slider({ label, v, min, max, step, unit, hint, onChange }: { label: string; v: number; min: number; max: number; step: number; unit?: string; hint?: string; onChange: (v: number) => void }) {
  return (
    <div title={hint}>
      <div className="flex justify-between text-[10px] text-text-muted"><span className="cursor-help">{label}</span><span className="mono">{v}{unit || ''}</span></div>
      <input type="range" min={min} max={max} step={step} value={v} onChange={e => onChange(Number(e.target.value))}
        className="w-full h-1 accent-accent-green" />
    </div>
  )
}
function Seg({ label, value, opts, hint, onChange }: { label: string; value: string; opts: [string, string][]; hint?: string; onChange: (v: string) => void }) {
  return (
    <div className="flex items-center justify-between gap-2" title={hint}>
      <span className="text-[11px] text-text-secondary shrink-0 cursor-help">{label}</span>
      <div className="flex rounded overflow-hidden border border-bg-border">
        {opts.map(([val, lab]) => (
          <button key={val} onClick={() => onChange(val)}
            className={`px-1.5 py-0.5 text-[10px] ${value === val ? 'bg-accent-green/20 text-accent-green' : 'text-text-muted hover:bg-bg-raised'}`}>
            {lab}
          </button>
        ))}
      </div>
    </div>
  )
}
