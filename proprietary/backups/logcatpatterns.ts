// ⚑ BACKUP / REFERENCE COPY — NOT compiled, NOT imported, NOT for GitHub.
// This is the original TypeScript of the Logcat visual-map relationship-mining
// engine, kept here after it was ported to Go (backend_logcatpatterns.go) on
// 2026-06-04. The Go file is the LIVE version now; this is preserved so we can
// read/refactor the logic in future. If you change the Go version, mirror it here.
//
// ---------------------------------------------------------------------------
//
// Parsed-reference extraction for the Logcat visual map.
//
// A log line is just text, but Android's framework + system-event logs encode
// real relationships: who started whom, who crashed, who got killed, who sent a
// signal to which pid. We mine those so the map can draw *meaningful* edges
// ("ActivityManager → com.foo: spawn") on top of the ambient co-occurrence web.
//
// Covers both the framework text logs (main/system buffers) and the binary
// event-log tags (events buffer: am_proc_start, am_anr, am_crash, am_kill…) so
// "show system events" works when the user selects the events/all buffer.

import type { LogcatLine } from './types'

export type RefKind =
  | 'activity' // launching/focusing an activity in a package
  | 'spawn'    // process start
  | 'death'    // process death / kill / LMK
  | 'crash'    // app crash / FATAL
  | 'anr'      // application not responding
  | 'signal'   // signal sent to a pid
  | 'gfx'      // surface/window/composition reference
  | 'mention'  // generic package reference found in the message

export interface LogRef {
  kind: RefKind
  target: string                         // entity id payload (package, component, or pid)
  targetKind: 'package' | 'component' | 'pid'
}

// Severity weight per kind — used by the engine to colour/size the edge.
export const REF_SEVERITY: Record<RefKind, number> = {
  crash: 5, anr: 5, death: 3, signal: 3, spawn: 2, activity: 1, gfx: 1, mention: 0,
}

// A dotted token that looks like an Android package/class (≥2 segments, starts
// with a lowercase domain-ish chunk). Greedy but effective; the engine de-dupes.
const PKG = /\b([a-z][a-z0-9_]*(?:\.[a-z0-9_]+){2,})\b/g
// component: com.foo/.Bar  or  com.foo/com.foo.Bar
const COMPONENT = /\b([a-z][a-z0-9_.]+)\/([a-z0-9_.$]+)/i
// CSV payload of an event-log line: "[u0,12345,com.foo,...]" or "[12345,...]"
const EVENT_CSV = /\[([^\]]*)\]/

function firstPackage(s: string): string | null {
  PKG.lastIndex = 0
  const m = PKG.exec(s)
  return m ? m[1] : null
}

// Pull the package field out of an event-log CSV payload (first dotted token).
function eventPackage(msg: string): string | null {
  const csv = EVENT_CSV.exec(msg)
  if (!csv) return firstPackage(msg)
  for (const f of csv[1].split(',')) {
    const t = f.trim()
    if (/^[a-z][a-z0-9_]*(\.[a-z0-9_]+){2,}$/.test(t)) return t
  }
  return firstPackage(msg)
}

/**
 * Extract the relationships a single log line implies. Returns [] for the vast
 * majority of lines (which only contribute co-occurrence + their own node).
 */
export function extractRefs(line: LogcatLine): LogRef[] {
  const tag = line.tag
  const msg = line.message || ''
  const refs: LogRef[] = []
  const push = (kind: RefKind, target: string | null, targetKind: LogRef['targetKind']) => {
    if (target) refs.push({ kind, target, targetKind })
  }

  // ---- binary event-log tags (events buffer) -----------------------------
  switch (tag) {
    case 'am_proc_start':
    case 'am_proc_bound':
      push('spawn', eventPackage(msg), 'package'); return refs
    case 'am_proc_died':
    case 'am_kill':
    case 'am_low_memory':
      push('death', eventPackage(msg), 'package'); return refs
    case 'am_crash':
      push('crash', eventPackage(msg), 'package'); return refs
    case 'am_anr':
      push('anr', eventPackage(msg), 'package'); return refs
    case 'am_activity_launch_time':
    case 'am_focused_activity':
    case 'am_resume_activity':
    case 'am_pause_activity':
    case 'wm_focused_window': {
      const c = COMPONENT.exec(msg)
      push('activity', c ? `${c[1]}/${c[2]}` : eventPackage(msg), c ? 'component' : 'package')
      return refs
    }
  }

  // ---- framework text logs (main/system buffers) -------------------------
  if (tag === 'ActivityManager' || tag === 'ActivityTaskManager') {
    if (/\bANR in\b/.test(msg))            push('anr',   firstPackage(msg), 'package')
    if (/\bStart proc\b/.test(msg))        push('spawn', firstPackage(msg), 'package')
    if (/\bKilling\b|\bhas died\b|\bdied\b/.test(msg)) push('death', firstPackage(msg), 'package')
    const sig = /Sending signal\.\s*PID:\s*(\d+)/.exec(msg)
    if (sig) push('signal', sig[1], 'pid')
    if (/\bSTART u\d+|\bDisplayed\b|\bmoveTaskTo/.test(msg)) {
      const c = COMPONENT.exec(msg)
      push('activity', c ? `${c[1]}/${c[2]}` : firstPackage(msg), c ? 'component' : 'package')
    }
    if (refs.length) return refs
  }

  if (tag === 'AndroidRuntime' || /FATAL EXCEPTION/.test(msg)) {
    const p = /Process:\s*([a-z][a-z0-9_.]+)/i.exec(msg)
    push('crash', p ? p[1] : firstPackage(msg), 'package')
    if (refs.length) return refs
  }

  if (tag === 'lowmemorykiller' || tag === 'lmkd') {
    push('death', firstPackage(msg), 'package'); if (refs.length) return refs
  }

  if (/^(SurfaceFlinger|WindowManager|ViewRootImpl|Choreographer|gralloc|OpenGLRenderer)/.test(tag)) {
    const c = COMPONENT.exec(msg)
    if (c) { push('gfx', `${c[1]}/${c[2]}`, 'component'); return refs }
  }

  return refs // caller may still apply the generic "mention" fallback if enabled
}

// Generic fallback: any package-looking token (used when "parsed mentions" is on
// in settings — maximises connections for "see everything", at the cost of noise).
export function extractMentions(line: LogcatLine, max = 3): LogRef[] {
  const msg = line.message || ''
  const out: LogRef[] = []
  const seen = new Set<string>()
  PKG.lastIndex = 0
  let m: RegExpExecArray | null
  while ((m = PKG.exec(msg)) && out.length < max) {
    const t = m[1]
    // Skip obvious noise: java.*, android.* internal classes are too common.
    if (seen.has(t)) continue
    seen.add(t)
    if (/^(java|javax|sun|kotlin|android|androidx|dalvik)\./.test(t)) continue
    out.push({ kind: 'mention', target: t, targetKind: 'package' })
  }
  return out
}
