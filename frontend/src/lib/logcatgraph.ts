// LogGraph — the stateful engine behind the Logcat visual map.
//
// It turns the firehose of log lines into a *bounded* graph plus an ephemeral
// particle stream (the two-layer model): persistent nodes/edges that decay over
// time, and short-lived particles that carry each event along its edge. Layout
// (force simulation) lives here too so the renderer stays a thin draw loop.
//
// Pure TS, no deps, no rendering — testable and reusable.

import type { LogcatLine, RefKind } from './types'

// Relationships are mined natively by the Go backend and arrive on each line as
// line.refs / line.mentions; this engine just consumes them. Severity weight per
// kind (used to colour/size the edge) stays here — it's a trivial lookup, not the
// mining logic.
const REF_SEVERITY: Record<RefKind, number> = {
  crash: 5, anr: 5, death: 3, signal: 3, spawn: 2, activity: 1, gfx: 1, mention: 0,
}

export type EdgeKind = 'cooccur' | RefKind
export type NodeKind = 'process' | 'tag' | 'package' | 'component'

export interface GNode {
  id: string
  kind: NodeKind
  label: string
  x: number; y: number; vx: number; vy: number
  pinned: boolean
  heat: number          // recent activity, decays
  count: number         // total lines attributed
  worst: number         // recent peak severity 0..5, decays
  lastTs: number
  recent: LogcatLine[]  // ring buffer (newest last), for the inspector
  levels: number[]      // histogram V..F counts (length 6)
  glat?: number; glon?: number  // (legacy globe) cached sphere position
  tx?: number; ty?: number; tz?: number; tdepth?: number  // 3D hanging-tree position (stable once set)
  tparent?: string   // 3D tree parent node id (the edge we actually draw in 3D)
  baseline?: boolean    // existed when the user set a baseline (so non-baseline = "new since")
}

export interface GEdge {
  id: string
  a: string; b: string  // directed a -> b (flow direction)
  kind: EdgeKind
  weight: number        // decays
  count: number
  worst: number
  lastTs: number
}

export interface Particle {
  a: string; b: string
  t: number             // 0..1 progress along the edge
  speed: number
  level: number
  kind: EdgeKind
  line?: LogcatLine
}

// A severe event (Error/Fatal or a crash/ANR/kill/signal relationship) — powers
// the Alerts panel so the analyst is told WHEN something breaks and WHERE.
export interface AlertEvent {
  ts: number
  id: string       // node id it happened on
  level: number
  tag: string
  msg: string
  rule?: string    // the user keyword rule that matched (undefined = severity alert)
}

// A real event that just flowed along an edge — powers the live "packet feed"
// so the user can see WHAT each moving particle is (which log line, src->dst).
export interface FlowEvent {
  ts: number
  a: string; b: string  // node ids (labels resolved live in the UI)
  kind: EdgeKind
  level: number
  tag: string
  msg: string
}

export interface GraphConfig {
  grouping: 'process' | 'tag'
  cooccur: boolean
  cooccurWindowMs: number
  parsed: boolean
  mentions: boolean
  nodeHalfLifeMs: number
  edgeHalfLifeMs: number
  maxNodes: number
  maxEdges: number
  maxParticles: number
  levelFloor: number       // ignore lines below this severity (0=V..5=F)
  particleIntensity: number
  particleSpeed: number
  // layout
  repulsion: number
  linkDistance: number
  gravity: number
  damping: number
  freeze: boolean
  clusterByKind: number    // extra pull between same-kind nodes
  timeScale: number        // global speed multiplier (slow-mo ↔ fast)
  // visual
  glow: number             // glow/bloom multiplier
  showGrid: boolean
  edgeColorMode: 'kind' | 'source' | 'severity'  // colour edges by kind, source-hub hue, or severity
  nodeColorMode: 'auto' | 'kind' | 'severity' | 'hub'  // how node colour is chosen
  boxLayout: boolean       // arrange nodes into 8 hub boxes (2x4 grid) instead of force layout
  geometry: GeometryShape  // arrange nodes onto a geometric structure ('none' = force/box)
  layoutScale: number      // scale the box/geometry arrangement bigger/smaller (around centre)
  wireframe: boolean       // schematic look: hollow ring nodes + crisp lines, no fills/halos
}

export type GeometryShape = 'none' | 'tree' | 'radial' | 'ring' | 'grid' | 'spiral' | 'cube' | 'metatron'

// A box in the "box layout" mode: a screen-space rectangle holding the nodes
// clustered around one of the busiest hubs.
export interface BoxRect {
  x: number; y: number; w: number; h: number
  label: string; count: number
}

export const DEFAULT_CONFIG: GraphConfig = {
  grouping: 'process',
  cooccur: true,
  cooccurWindowMs: 700,
  parsed: true,
  mentions: false,
  nodeHalfLifeMs: 16000,
  edgeHalfLifeMs: 12000,
  maxNodes: 180,
  maxEdges: 900,
  maxParticles: 3500,
  levelFloor: 0,
  particleIntensity: 0.75,
  particleSpeed: 0.9,
  repulsion: 11000,
  linkDistance: 125,
  gravity: 0.004,
  damping: 0.8,
  freeze: false,
  clusterByKind: 0,
  timeScale: 1,
  glow: 0.45,
  showGrid: false,
  edgeColorMode: 'source',
  nodeColorMode: 'auto',
  boxLayout: false,
  geometry: 'none',
  layoutScale: 1,
  wireframe: false,
}

// Target points for a geometric arrangement of n nodes (ordered by activity).
// All 2D/projected so the existing renderers can draw them; 3D shapes (cube,
// metatron) use a fixed isometric projection to read as structure.
export function geometryPoints(shape: GeometryShape, n: number, w: number, h: number): { x: number; y: number }[] {
  const cx = w / 2, cy = h / 2, R = Math.min(w, h) * 0.42, pts: { x: number; y: number }[] = []
  if (n <= 0) return pts
  const s = R * 0.85, ax = 0.5, ay = 0.62
  const proj3 = (x: number, y: number, z: number) => {
    const x1 = x * Math.cos(ay) + z * Math.sin(ay)
    const z1 = -x * Math.sin(ay) + z * Math.cos(ay)
    const y2 = y * Math.cos(ax) - z1 * Math.sin(ax)
    return { x: cx + x1 * s, y: cy + y2 * s }
  }
  if (shape === 'radial') {
    // biggest / most-active nodes (lowest index — caller sorts by activity desc) on
    // the OUTER rim, smaller ones filling toward the centre. sqrt falloff → even
    // disc fill (not a central clump). Elliptical + near-edge to fill wide screens.
    const rx = w * 0.48, ry = h * 0.46
    for (let i = 0; i < n; i++) {
      const t = n > 1 ? i / (n - 1) : 0
      const rad = 0.1 + 0.9 * Math.sqrt(1 - t)
      const a = i * 2.399963 - Math.PI / 2
      pts.push({ x: cx + Math.cos(a) * rx * rad, y: cy + Math.sin(a) * ry * rad })
    }
  } else if (shape === 'ring') {
    for (let i = 0; i < n; i++) { const a = (i / n) * Math.PI * 2 - Math.PI / 2; pts.push({ x: cx + Math.cos(a) * R, y: cy + Math.sin(a) * R }) }
  } else if (shape === 'grid') {
    const cols = Math.max(1, Math.ceil(Math.sqrt(n * (w / h)))), rows = Math.ceil(n / cols)
    const pad = 64, gw = w - pad * 2, gh = h - pad * 2
    for (let i = 0; i < n; i++) { const c = i % cols, r = Math.floor(i / cols); pts.push({ x: pad + (cols === 1 ? gw / 2 : (c / (cols - 1)) * gw), y: pad + (rows === 1 ? gh / 2 : (r / (rows - 1)) * gh) }) }
  } else if (shape === 'spiral') {
    for (let i = 0; i < n; i++) { const a = i * 2.399963, rr = R * Math.sqrt((i + 1) / n); pts.push({ x: cx + Math.cos(a) * rr, y: cy + Math.sin(a) * rr }) }
  } else if (shape === 'cube') {
    const v = [[-1, -1, -1], [1, -1, -1], [1, 1, -1], [-1, 1, -1], [-1, -1, 1], [1, -1, 1], [1, 1, 1], [-1, 1, 1]]
    const ed = [[0, 1], [1, 2], [2, 3], [3, 0], [4, 5], [5, 6], [6, 7], [7, 4], [0, 4], [1, 5], [2, 6], [3, 7]]
    const per = Math.max(1, Math.ceil(n / ed.length))
    for (let i = 0; i < n; i++) {
      const e = ed[i % ed.length], k = Math.floor(i / ed.length), t = (k + 0.5) / per
      const a = v[e[0]], b = v[e[1]]
      pts.push(proj3(a[0] + (b[0] - a[0]) * t, a[1] + (b[1] - a[1]) * t, a[2] + (b[2] - a[2]) * t))
    }
  } else if (shape === 'metatron') {
    // 13 centres: 1 centre + inner hex (r) + outer hex (2r), classic Metatron's cube
    const centres: { x: number; y: number }[] = [{ x: cx, y: cy }]
    for (let ring = 1; ring <= 2; ring++) for (let k = 0; k < 6; k++) {
      const a = (k / 6) * Math.PI * 2 - Math.PI / 2
      centres.push({ x: cx + Math.cos(a) * R * 0.5 * ring, y: cy + Math.sin(a) * R * 0.5 * ring })
    }
    for (let i = 0; i < n; i++) {
      const c = centres[i % centres.length], k = Math.floor(i / centres.length)
      const a = k * 2.399963, rr = k === 0 ? 0 : R * 0.06 * Math.sqrt(k)
      pts.push({ x: c.x + Math.cos(a) * rr, y: c.y + Math.sin(a) * rr })
    }
  }
  return pts
}

// Named presets — applied on top of the current config from the settings drawer.
export const PRESETS: Record<string, Partial<GraphConfig>> = {
  Investigate: { cooccurWindowMs: 700, nodeHalfLifeMs: 16000, edgeHalfLifeMs: 12000, maxNodes: 180, glow: 0.45, particleIntensity: 0.75, particleSpeed: 0.9, gravity: 0.004, repulsion: 11000, linkDistance: 125, timeScale: 1 },
  'See everything': { cooccurWindowMs: 1200, nodeHalfLifeMs: 600000, edgeHalfLifeMs: 600000, maxNodes: 400, maxEdges: 2500, glow: 0.4, particleIntensity: 0.6, gravity: 0.003, repulsion: 11000, linkDistance: 120, timeScale: 1 },
  'Live pulse': { cooccurWindowMs: 500, nodeHalfLifeMs: 4000, edgeHalfLifeMs: 3000, maxNodes: 120, glow: 0.55, particleIntensity: 0.9, particleSpeed: 1.2, gravity: 0.008, repulsion: 7500, timeScale: 1 },
  Calm: { glow: 0.4, particleIntensity: 0.45, particleSpeed: 0.6, timeScale: 0.6, nodeHalfLifeMs: 14000, edgeHalfLifeMs: 11000 },
  Cinematic: { glow: 1, particleIntensity: 0.95, particleSpeed: 1.1, maxParticles: 5000, timeScale: 1 },
}

export const LEVELS = ['V', 'D', 'I', 'W', 'E', 'F']
export function levelNum(l: string): number {
  const i = LEVELS.indexOf(l)
  return i < 0 ? 2 : i
}

const RECENT_CAP = 80
const FLOWLOG_CAP = 160

function now() { return performance.now() }

// Visual radius of a node — shared by the renderer (draw size) and the layout
// (collision separation) so big nodes can't overlap into a blob.
export function nodeRadius(n: GNode): number {
  return Math.min(26, 4 + Math.sqrt(Math.max(0, n.heat)) * 2.2 + Math.log(1 + n.count) * 1.6)
}

export class LogGraph {
  nodes = new Map<string, GNode>()
  edges = new Map<string, GEdge>()
  particles: Particle[] = []
  flowLog: FlowEvent[] = []          // live ring buffer of flowing events (newest last)
  captured: FlowEvent[] = []         // capture/record buffer (large, only while capturing)
  capturing = false
  alerts: AlertEvent[] = []          // severe events (E/F + crash/anr/kill/signal), newest last
  alertRules: string[] = []          // user keyword/tag rules (lowercased) that also raise alerts
  watchedIds = new Set<string>()     // user's watchlist — these nodes are never evicted
  baselineActive = false             // diff mode: highlight nodes that appeared since baseline
  cfg: GraphConfig = { ...DEFAULT_CONFIG }
  processNames: Record<string, string> = {}

  private recentActive: { id: string; ts: number }[] = []
  private lastDecay = now()
  totalLines = 0
  droppedParticles = 0

  // 3D hanging-tree placement state (incremental, stable)
  private treeChildN = new Map<string, number>()
  private treeRootN = 0

  // box-layout state (recomputed on an interval, eased toward each frame)
  boxes: BoxRect[] = []
  private boxTarget = new Map<string, { x: number; y: number }>()
  private lastBoxCalc = 0

  // timeline: rolling per-second event counts by level [V,D,I,W,E,F], newest last
  tl: number[][] = []
  private tlLast = 0

  setConfig(c: Partial<GraphConfig>) { this.cfg = { ...this.cfg, ...c } }
  setProcessNames(m: Record<string, string>) {
    this.processNames = m
    // relabel existing process nodes in place
    for (const n of this.nodes.values()) {
      if (n.kind === 'process') {
        const pid = n.id.slice(2)
        n.label = m[pid] || pid
      }
    }
  }

  // snapshot the current nodes as the baseline; afterwards any node without the
  // flag is "new since" and gets highlighted by the renderers
  setBaseline(on: boolean) {
    this.baselineActive = on
    if (on) for (const n of this.nodes.values()) n.baseline = true
  }

  clear() {
    this.baselineActive = false
    this.treeChildN.clear(); this.treeRootN = 0
    this.nodes.clear(); this.edges.clear(); this.particles = []
    this.flowLog = []; this.captured = []; this.alerts = []; this.boxes = []; this.boxTarget.clear(); this.tl = []
    this.recentActive = []; this.totalLines = 0; this.droppedParticles = 0
  }

  // ---- ingestion ---------------------------------------------------------

  ingest(line: LogcatLine, w: number, h: number) {
    const lv = levelNum(line.level)
    if (lv < this.cfg.levelFloor) return
    this.totalLines++
    const ts = now()
    this.bumpTimeline(ts, lv)

    const primary = this.primaryNode(line, w, h)
    this.touch(primary, line, lv, ts)

    let flowed = false
    let severe = lv >= 4   // Error / Fatal

    // parsed "real" relationships → directed edges to target nodes
    if (this.cfg.parsed) {
      const refs = line.refs || []
      for (const r of refs) {
        if (REF_SEVERITY[r.kind] >= 4) severe = true   // crash / anr / fatal kind
        const target = this.refNode(r.kind, r.target, r.targetKind, w, h)
        if (target && target.id !== primary.id) {
          this.link(primary.id, target.id, r.kind, REF_SEVERITY[r.kind], lv, ts, line)
          flowed = true
        }
      }
    }
    let matchedRule: string | undefined
    if (this.alertRules.length) {
      const hay = ((line.tag || '') + ' ' + (line.message || line.raw || '')).toLowerCase()
      for (const r of this.alertRules) { if (r && hay.includes(r)) { matchedRule = r; severe = true; break } }
    }
    if (severe) {
      this.alerts.push({ ts, id: primary.id, level: lv, tag: line.tag || '', msg: line.message || line.raw || '', rule: matchedRule })
      if (this.alerts.length > 240) this.alerts.shift()
    }
    if (this.cfg.mentions) {
      for (const r of (line.mentions || [])) {
        const target = this.refNode(r.kind, r.target, r.targetKind, w, h)
        if (target && target.id !== primary.id) {
          this.link(primary.id, target.id, 'mention', 0, lv, ts, line)
          flowed = true
        }
      }
    }

    // ambient co-occurrence: link to the recently-active OTHER nodes within the
    // window (not just the immediately-previous line). This is what makes a busy
    // process actually connect to — and visibly flow toward — whatever else is
    // active at the same time, instead of looking dead when it dominates the log.
    if (this.cfg.cooccur) {
      let linked = 0
      for (const ra of this.recentActive) {
        if (linked >= 3) break
        if (ra.id === primary.id || ts - ra.ts > this.cfg.cooccurWindowMs) continue
        if (!this.nodes.has(ra.id)) continue
        this.link(ra.id, primary.id, 'cooccur', 0, lv, ts, line)
        flowed = true
        linked++
      }
    }
    // update the recency ring (distinct, most-recent first)
    this.recentActive = this.recentActive.filter(r => r.id !== primary.id)
    this.recentActive.unshift({ id: primary.id, ts })
    if (this.recentActive.length > 8) this.recentActive.length = 8

    if (!flowed) primary.heat += 0.4 // truly isolated event: just glow harder
  }

  // roll the 1s timeline buckets forward to `ts`, then count this event
  private bumpTimeline(ts: number, lv: number) {
    const BUCKET = 1000, CAP = 120
    if (!this.tl.length) { this.tl.push([0, 0, 0, 0, 0, 0]); this.tlLast = ts }
    while (ts - this.tlLast >= BUCKET) {
      this.tl.push([0, 0, 0, 0, 0, 0]); this.tlLast += BUCKET
      if (this.tl.length > CAP) this.tl.shift()
    }
    this.tl[this.tl.length - 1][lv]++
  }

  private primaryNode(line: LogcatLine, w: number, h: number): GNode {
    if (this.cfg.grouping === 'tag') {
      const id = 't:' + (line.tag || '?')
      return this.ensure(id, 'tag', line.tag || '?', w, h)
    }
    const pid = line.pid || '?'
    return this.ensure('p:' + pid, 'process', this.processNames[pid] || pid, w, h)
  }

  private refNode(_kind: RefKind, target: string, targetKind: 'package' | 'component' | 'pid', w: number, h: number): GNode | null {
    if (targetKind === 'pid') return this.ensure('p:' + target, 'process', this.processNames[target] || target, w, h)
    if (targetKind === 'component') return this.ensure('cmp:' + target, 'component', target, w, h)
    return this.ensure('pkg:' + target, 'package', target, w, h)
  }

  private ensure(id: string, kind: NodeKind, label: string, w: number, h: number): GNode {
    let n = this.nodes.get(id)
    if (!n) {
      // spawn on a wide golden-angle spiral so a burst of new nodes doesn't pile
      // up at the centre and explode outward (the "lots of movement on Start")
      const a = (this.nodes.size * 2.399963) % (Math.PI * 2)
      const r = 90 + (this.nodes.size % 19) * 26
      n = {
        id, kind, label,
        x: w / 2 + Math.cos(a) * r, y: h / 2 + Math.sin(a) * r,
        vx: 0, vy: 0, pinned: false,
        heat: 0, count: 0, worst: 0, lastTs: 0, recent: [], levels: [0, 0, 0, 0, 0, 0],
      }
      this.nodes.set(id, n)
    }
    return n
  }

  private touch(n: GNode, line: LogcatLine, lv: number, ts: number) {
    n.count++
    n.heat += 1
    n.worst = Math.max(n.worst, lv)
    n.lastTs = ts
    n.levels[lv]++
    // collapse consecutive identical lines so the inspector shows variety, not
    // 80 copies of the same chatty message
    const last = n.recent[n.recent.length - 1]
    if (!last || last.raw !== line.raw) {
      n.recent.push(line)
      if (n.recent.length > RECENT_CAP) n.recent.shift()
    }
  }

  private link(a: string, b: string, kind: EdgeKind, sev: number, lv: number, ts: number, line: LogcatLine) {
    const id = a + '>' + b
    let e = this.edges.get(id)
    if (!e) {
      e = { id, a, b, kind, weight: 0, count: 0, worst: 0, lastTs: ts }
      this.edges.set(id, e)
    }
    e.weight += 1
    e.count++
    e.lastTs = ts
    if (sev >= e.worst) { e.worst = sev; if (sev > 0) e.kind = kind }
    this.spawnParticle(a, b, lv, e.kind, sev, line)
    // record the real event for the live packet feed (dedupe immediate repeats)
    const prev = this.flowLog[this.flowLog.length - 1]
    const msg = line.message || line.raw || ''
    if (!prev || prev.a !== a || prev.b !== b || prev.msg !== msg) {
      const ev: FlowEvent = { ts, a, b, kind: e.kind, level: lv, tag: line.tag || '', msg }
      this.flowLog.push(ev)
      if (this.flowLog.length > FLOWLOG_CAP) this.flowLog.shift()
      if (this.capturing) { this.captured.push(ev); if (this.captured.length > 8000) this.captured.shift() }
    }
  }

  private spawnParticle(a: string, b: string, lv: number, kind: EdgeKind, sev: number, line: LogcatLine) {
    // always emit for severe events; otherwise sample by intensity
    if (sev < 3 && Math.random() > this.cfg.particleIntensity) return
    if (this.particles.length >= this.cfg.maxParticles) {
      this.particles.shift(); this.droppedParticles++
    }
    this.particles.push({
      a, b, t: 0,
      speed: (0.45 + Math.random() * 0.4) * this.cfg.particleSpeed * (sev >= 3 ? 1.5 : 1),
      level: lv, kind,
      line,   // the actual event this particle carries
    })
  }

  // ---- per-frame updates -------------------------------------------------

  decay(scale = 1) {
    const t = now()
    // Clamp elapsed: after a pause / hidden view, lastDecay is stale and an
    // unclamped dt would decay all heat+edges in one tick and evict the whole
    // graph, leaving an empty map on return. Cap at 2s of decay per call.
    const dt = Math.min(t - this.lastDecay, 2000) * scale
    this.lastDecay = t
    if (dt <= 0) return
    const nf = Math.pow(0.5, dt / this.cfg.nodeHalfLifeMs)
    const ef = Math.pow(0.5, dt / this.cfg.edgeHalfLifeMs)
    for (const n of this.nodes.values()) { n.heat *= nf; n.worst *= nf }
    for (const [id, e] of this.edges) { e.weight *= ef; e.worst *= ef; if (e.weight < 0.04) this.edges.delete(id) }
    this.evict()
  }

  private evict() {
    // drop cold, edgeless, unpinned nodes; then cap total by heat
    const connected = new Set<string>()
    for (const e of this.edges.values()) { connected.add(e.a); connected.add(e.b) }
    for (const [id, n] of this.nodes) {
      if (!n.pinned && !this.watchedIds.has(id) && n.heat < 0.02 && !connected.has(id)) this.nodes.delete(id)
    }
    if (this.nodes.size > this.cfg.maxNodes) {
      const arr = [...this.nodes.values()].filter(n => !n.pinned && !this.watchedIds.has(n.id)).sort((a, b) => a.heat - b.heat)
      let over = this.nodes.size - this.cfg.maxNodes
      for (const n of arr) {
        if (over-- <= 0) break
        this.nodes.delete(n.id)
        for (const [eid, e] of this.edges) if (e.a === n.id || e.b === n.id) this.edges.delete(eid)
      }
    }
    if (this.edges.size > this.cfg.maxEdges) {
      const arr = [...this.edges.values()].sort((a, b) => a.weight - b.weight)
      let over = this.edges.size - this.cfg.maxEdges
      for (const e of arr) { if (over-- <= 0) break; this.edges.delete(e.id) }
    }
  }

  advanceParticles(dt: number) {
    const keep: Particle[] = []
    // Clamp the step: a single long frame (view switch, GC pause, WebKitGTK
    // render stall) would otherwise push every particle's t past 1 in one tick
    // and cull the entire stream — the "0 flows" bug. Cap at ~4 frames' worth
    // so motion stays continuous after a hitch instead of resetting to empty.
    const step = Math.min(dt, 64) / 1000
    for (const p of this.particles) {
      p.t += p.speed * step
      if (p.t < 1 && this.nodes.has(p.a) && this.nodes.has(p.b)) keep.push(p)
    }
    this.particles = keep
  }

  // Incrementally place every not-yet-placed node into a 3D HANGING TREE: parent =
  // strongest INCOMING edge, child hangs one level below its parent and fans out in
  // the XZ plane (golden angle) so siblings spread into a cone. Parents are placed
  // before children (multi-pass); true roots (no incoming edge) sit at the top.
  // Stable once set → no re-jumping; the tree grows downward as the graph builds.
  placeTree3D() {
    const LEVEL = 115, CR = 230
    const placeRoot = (n: GNode) => {
      const ri = this.treeRootN++, a = ri * 2.399963, rr = 50 + ri * 16
      n.tx = Math.cos(a) * rr; n.tz = Math.sin(a) * rr; n.ty = 0; n.tdepth = 0
    }
    const placeChild = (n: GNode, par: GNode) => {
      const k = this.treeChildN.get(par.id) || 0; this.treeChildN.set(par.id, k + 1)
      const depth = (par.tdepth || 0) + 1
      const r = (CR / Math.sqrt(depth + 1)) * (0.55 + 0.45 * ((k % 6) / 5)), a = k * 2.399963
      n.tx = (par.tx || 0) + Math.cos(a) * r
      n.tz = (par.tz || 0) + Math.sin(a) * r
      n.ty = (par.ty || 0) - LEVEL
      n.tdepth = depth
      n.tparent = par.id
    }
    let changed = true, guard = 0
    while (changed && guard++ < 60) {
      changed = false
      for (const n of this.nodes.values()) {
        if (n.tx !== undefined) continue
        let par: GNode | null = null, bestW = -1, hasIn = false
        for (const e of this.edges.values()) {
          if (e.b !== n.id) continue
          hasIn = true
          const src = this.nodes.get(e.a)
          if (src && src.tx !== undefined && e.weight > bestW) { bestW = e.weight; par = src }
        }
        if (par) { placeChild(n, par); changed = true }
        else if (!hasIn) { placeRoot(n); changed = true }
      }
    }
    for (const n of this.nodes.values()) if (n.tx === undefined) placeRoot(n)  // cycles / unreachable
  }

  // ---- box layout: 8 hub boxes in a 2-col grid --------------------------
  // Group nodes around the busiest hubs (each box = one hub + the nodes that
  // connect to it most), lay the boxes out 2-wide, and ease nodes to their slot.
  // Recomputed on an interval so the hub set doesn't reshuffle every frame.
  computeBoxes(w: number, h: number, N = 8) {
    const nodes = [...this.nodes.values()]
    this.boxes = []; this.boxTarget.clear()
    if (!nodes.length) return

    // degree weight = incident edge weight (+ a little heat as tiebreak)
    const deg = new Map<string, number>()
    for (const n of nodes) deg.set(n.id, n.heat * 0.5)
    for (const e of this.edges.values()) {
      deg.set(e.a, (deg.get(e.a) || 0) + e.weight)
      deg.set(e.b, (deg.get(e.b) || 0) + e.weight)
    }
    const k = Math.min(N, nodes.length)
    const anchors = [...nodes].sort((a, b) => (deg.get(b.id) || 0) - (deg.get(a.id) || 0)).slice(0, k)
    const anchorBox = new Map<string, number>()
    anchors.forEach((n, i) => anchorBox.set(n.id, i))

    // assign every node to a box: anchors own theirs; others go to the box of
    // their strongest-connected anchor; unconnected fall back to a stable hash.
    const members: string[][] = Array.from({ length: k }, () => [])
    for (const n of nodes) {
      let box = anchorBox.get(n.id)
      if (box === undefined) {
        let bestW = -1
        for (const e of this.edges.values()) {
          const other = e.a === n.id ? e.b : e.b === n.id ? e.a : null
          if (other !== null && anchorBox.has(other) && e.weight > bestW) { bestW = e.weight; box = anchorBox.get(other) }
        }
        if (box === undefined) {
          let hsh = 0; for (let i = 0; i < n.id.length; i++) hsh = (hsh * 31 + n.id.charCodeAt(i)) >>> 0
          box = hsh % k
        }
      }
      members[box].push(n.id)
    }

    // grid: 2 columns (like the drawing), rows as needed
    const cols = Math.min(2, k), rows = Math.ceil(k / cols)
    const pad = 36, gap = 46
    const bw = (w - pad * 2 - gap * (cols - 1)) / cols
    const bh = (h - pad * 2 - gap * (rows - 1)) / rows
    for (let i = 0; i < k; i++) {
      const c = i % cols, r = Math.floor(i / cols)
      const x = pad + c * (bw + gap), y = pad + r * (bh + gap)
      this.boxes.push({ x, y, w: bw, h: bh, label: anchors[i].label, count: members[i].length })
      // hierarchy: busiest node (the hub) sits prominently at the box's top-
      // centre, the rest sorted by activity flow into a grid beneath it.
      const mem = members[i].sort((p, q) => (deg.get(q) || 0) - (deg.get(p) || 0))
      const ipad = 26, iw = bw - ipad * 2, ih = bh - ipad * 2
      this.boxTarget.set(mem[0], { x: x + bw / 2, y: y + ipad + 6 })
      const rest = mem.slice(1)
      const top = y + ipad + 36, gh = Math.max(1, ih - 36)
      const gc = Math.max(1, Math.round(Math.sqrt(rest.length * (iw / Math.max(1, gh)))))
      const gr = Math.max(1, Math.ceil(rest.length / gc))
      rest.forEach((id, j) => {
        const cc = j % gc, rr = Math.floor(j / gc)
        const tx = x + ipad + (gc === 1 ? iw / 2 : (cc / (gc - 1)) * iw)
        const ty = top + (gr === 1 ? gh / 2 : (rr / (gr - 1)) * gh)
        this.boxTarget.set(id, { x: tx, y: ty })
      })
    }
    // scale the whole arrangement (boxes + node targets) around the centre
    const sc = this.cfg.layoutScale || 1
    if (sc !== 1) {
      const cx = w / 2, cy = h / 2
      for (const b of this.boxes) { b.x = cx + (b.x - cx) * sc; b.y = cy + (b.y - cy) * sc; b.w *= sc; b.h *= sc }
      for (const [id, t] of this.boxTarget) this.boxTarget.set(id, { x: cx + (t.x - cx) * sc, y: cy + (t.y - cy) * sc })
    }
  }

  private easeToTargets() {
    for (const n of this.nodes.values()) {
      if (n.pinned) continue
      const tg = this.boxTarget.get(n.id); if (!tg) continue
      n.vx = 0; n.vy = 0
      n.x += (tg.x - n.x) * 0.16; n.y += (tg.y - n.y) * 0.16
    }
  }
  private stepBoxLayout(w: number, h: number) {
    const t = now()
    if (t - this.lastBoxCalc > 1200 || !this.boxes.length) { this.computeBoxes(w, h); this.lastBoxCalc = t }
    this.easeToTargets()
  }
  // hierarchical tidy tree: parent = strongest INCOMING edge; root(s) at top,
  // children cascade down, leaves spread across the width, internal nodes centred
  // over their children (Reingold–Tilford-ish). Fills the viewport.
  computeTreeTargets(w: number, h: number) {
    const nodes = [...this.nodes.values()]
    this.boxes = []; this.boxTarget.clear()
    if (!nodes.length) return
    const parent = new Map<string, string>(), inW = new Map<string, number>()
    for (const e of this.edges.values()) {
      if ((inW.get(e.b) ?? -1) < e.weight) { inW.set(e.b, e.weight); parent.set(e.b, e.a) }
    }
    const children = new Map<string, string[]>(), roots: string[] = []
    for (const n of nodes) {
      const p = parent.get(n.id)
      // root if no parent, parent missing, or a 2-cycle where this node is the stronger
      if (p && p !== n.id && this.nodes.has(p) && !(parent.get(p) === n.id && (inW.get(n.id) ?? 0) >= (inW.get(p) ?? 0))) {
        const arr = children.get(p); if (arr) arr.push(n.id); else children.set(p, [n.id])
      } else roots.push(n.id)
    }
    const visited = new Set<string>(), xpos = new Map<string, number>(), depth = new Map<string, number>()
    let cursor = 0, maxDepth = 0
    const dfs = (id: string, d: number) => {
      if (visited.has(id)) return
      visited.add(id); depth.set(id, d); if (d > maxDepth) maxDepth = d
      const ch = (children.get(id) || []).filter(c => !visited.has(c))
      if (!ch.length) { xpos.set(id, cursor++); return }
      let sum = 0; for (const c of ch) { dfs(c, d + 1); sum += xpos.get(c) ?? 0 }
      xpos.set(id, sum / ch.length)
    }
    for (const r of roots) dfs(r, 0)
    for (const n of nodes) if (!visited.has(n.id)) { depth.set(n.id, 0); xpos.set(n.id, cursor++) }   // stragglers/cycles
    const maxX = Math.max(1, cursor - 1), pad = 60, sc = this.cfg.layoutScale || 1
    const cx = w / 2, cy = h / 2, levelGap = maxDepth > 0 ? (h - pad * 2) / maxDepth : 0
    for (const n of nodes) {
      const x0 = pad + ((xpos.get(n.id) ?? 0) / maxX) * (w - pad * 2)
      const y0 = pad + (depth.get(n.id) ?? 0) * levelGap
      this.boxTarget.set(n.id, { x: cx + (x0 - cx) * sc, y: cy + (y0 - cy) * sc })
    }
  }

  // arrange nodes (ordered by activity) onto the chosen geometric structure
  computeGeometry(w: number, h: number) {
    if (this.cfg.geometry === 'tree') { this.computeTreeTargets(w, h); return }
    const nodes = [...this.nodes.values()]
    this.boxes = []; this.boxTarget.clear()
    if (!nodes.length || this.cfg.geometry === 'none') return
    const deg = new Map<string, number>()
    for (const n of nodes) deg.set(n.id, n.heat)
    for (const e of this.edges.values()) { deg.set(e.a, (deg.get(e.a) || 0) + e.weight); deg.set(e.b, (deg.get(e.b) || 0) + e.weight) }
    const ordered = nodes.sort((a, b) => (deg.get(b.id) || 0) - (deg.get(a.id) || 0))
    const pts = geometryPoints(this.cfg.geometry, ordered.length, w, h)
    if (!pts.length) return
    const cx = w / 2, cy = h / 2, sc = this.cfg.layoutScale || 1
    ordered.forEach((n, i) => {
      const p = pts[i % pts.length]
      this.boxTarget.set(n.id, { x: cx + (p.x - cx) * sc, y: cy + (p.y - cy) * sc })
    })
  }
  private stepGeometry(w: number, h: number) {
    const t = now()
    if (t - this.lastBoxCalc > 1200 || !this.boxTarget.size) { this.computeGeometry(w, h); this.lastBoxCalc = t }
    this.easeToTargets()
  }

  // simple O(n²) force layout — fine for the bounded node count
  stepForces(w: number, h: number, dtMs: number) {
    if (this.cfg.freeze) return   // freeze = stop ALL node movement, in every layout mode
    if (this.cfg.boxLayout) { this.stepBoxLayout(w, h); return }
    if (this.cfg.geometry !== 'none') { this.stepGeometry(w, h); return }
    this.boxes = []
    const dt = Math.min(dtMs, 40) / 16.67
    const ns = [...this.nodes.values()]
    const cx = w / 2, cy = h / 2
    // layoutScale spreads the force layout too: more repulsion + longer springs +
    // weaker gravity → the whole graph grows/shrinks with the slider.
    const sc = this.cfg.layoutScale || 1
    const rep = this.cfg.repulsion * sc
    const grav = this.cfg.gravity / sc

    for (let i = 0; i < ns.length; i++) {
      const a = ns[i]
      for (let j = i + 1; j < ns.length; j++) {
        const b = ns[j]
        let dx = a.x - b.x, dy = a.y - b.y
        let d2 = dx * dx + dy * dy
        if (d2 < 0.01) { dx = (i - j) || 1; dy = 1; d2 = 2 }
        const inv = 1 / d2
        let f = rep * inv
        if (this.cfg.clusterByKind && a.kind === b.kind) f *= (1 - this.cfg.clusterByKind * 0.6)
        const d = Math.sqrt(d2)
        // size-aware collision: if the discs overlap, add a strong extra push so
        // big (hot) nodes separate instead of stacking into a central blob.
        const minSep = nodeRadius(a) + nodeRadius(b) + 10
        if (d < minSep) f += (minSep - d) * 1.4
        const fx = (dx / d) * f, fy = (dy / d) * f
        a.vx += fx; a.vy += fy
        b.vx -= fx; b.vy -= fy
      }
      // gravity toward centre
      a.vx += (cx - a.x) * grav
      a.vy += (cy - a.y) * grav
    }

    // springs
    const L = this.cfg.linkDistance * sc
    for (const e of this.edges.values()) {
      const a = this.nodes.get(e.a), b = this.nodes.get(e.b)
      if (!a || !b) continue
      const dx = b.x - a.x, dy = b.y - a.y
      const d = Math.hypot(dx, dy) || 1
      const rest = L / (1 + Math.min(e.weight, 6) * 0.12)
      const f = (d - rest) * 0.02
      const fx = (dx / d) * f, fy = (dy / d) * f
      a.vx += fx; a.vy += fy
      b.vx -= fx; b.vy -= fy
    }

    for (const n of ns) {
      if (n.pinned) { n.vx = 0; n.vy = 0; continue }
      n.vx *= this.cfg.damping; n.vy *= this.cfg.damping
      // clamp velocity for stability — lower cap calms the initial settle
      const v = Math.hypot(n.vx, n.vy)
      if (v > 14) { n.vx = (n.vx / v) * 14; n.vy = (n.vy / v) * 14 }
      n.x += n.vx * dt; n.y += n.vy * dt
    }
  }

  nodeAt(x: number, y: number, radiusFn: (n: GNode) => number): GNode | null {
    let best: GNode | null = null, bestD = Infinity
    for (const n of this.nodes.values()) {
      const r = radiusFn(n) + 4
      const d = Math.hypot(n.x - x, n.y - y)
      if (d <= r && d < bestD) { best = n; bestD = d }
    }
    return best
  }

  neighbors(id: string): { node: GNode; edge: GEdge; dir: 'out' | 'in' }[] {
    const out: { node: GNode; edge: GEdge; dir: 'out' | 'in' }[] = []
    for (const e of this.edges.values()) {
      if (e.a === id) { const n = this.nodes.get(e.b); if (n) out.push({ node: n, edge: e, dir: 'out' }) }
      else if (e.b === id) { const n = this.nodes.get(e.a); if (n) out.push({ node: n, edge: e, dir: 'in' }) }
    }
    return out.sort((x, y) => y.edge.weight - x.edge.weight)
  }
}
