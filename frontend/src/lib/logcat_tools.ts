// Logcat highlight rules + sensitive-data scrubbing for export.

export type HiColor = 'red' | 'amber' | 'green' | 'blue' | 'purple' | 'pink'

export interface HighlightRule {
  id: string
  pattern: string
  mode: 'contains' | 'regex'
  color: HiColor
}

// Row style per colour (background tint + a left accent + readable text).
export const HI_STYLES: Record<HiColor, string> = {
  red:    'bg-danger/25 text-danger',
  amber:  'bg-warn/25 text-warn',
  green:  'bg-accent-green/20 text-accent-green',
  blue:   'bg-blue-500/20 text-blue-300',
  purple: 'bg-purple-500/20 text-purple-300',
  pink:   'bg-pink-500/20 text-pink-300',
}

export const HI_SWATCH: Record<HiColor, string> = {
  red: '#e78284', amber: '#e5c890', green: '#a6d189', blue: '#8caaee', purple: '#ca9ee6', pink: '#f4b8e4',
}

const STORAGE_KEY = 'atk-logcat-highlights'

export function loadHighlightRules(): HighlightRule[] {
  try {
    const raw = localStorage.getItem(STORAGE_KEY)
    if (!raw) return []
    const parsed = JSON.parse(raw)
    return Array.isArray(parsed) ? parsed.filter(r => r && typeof r.pattern === 'string') : []
  } catch {
    return []
  }
}

export function saveHighlightRules(rules: HighlightRule[]): void {
  try { localStorage.setItem(STORAGE_KEY, JSON.stringify(rules)) } catch {}
}

// A compiled matcher for one rule. Regex rules that fail to compile become a
// literal substring match so a bad pattern never throws mid-render.
export interface CompiledRule {
  rule: HighlightRule
  test: (raw: string) => boolean
  style: string
}

export function compileRules(rules: HighlightRule[]): CompiledRule[] {
  return rules
    .filter(r => r.pattern.trim() !== '')
    .map(r => {
      let test: (raw: string) => boolean
      if (r.mode === 'regex') {
        try {
          const re = new RegExp(r.pattern, 'i')
          test = (raw) => re.test(raw)
        } catch {
          const needle = r.pattern.toLowerCase()
          test = (raw) => raw.toLowerCase().includes(needle)
        }
      } else {
        const needle = r.pattern.toLowerCase()
        test = (raw) => raw.toLowerCase().includes(needle)
      }
      return { rule: r, test, style: HI_STYLES[r.color] || HI_STYLES.amber }
    })
}

// ---------------------------------------------------------------------------
// Sensitive-data scrubbing (applied on export).
// Order matters: longer / more-specific patterns run before shorter ones so a
// digit run isn't half-consumed by a broader rule.
// ---------------------------------------------------------------------------
const SCRUBBERS: [RegExp, string][] = [
  [/[A-Za-z0-9._%+-]+@[A-Za-z0-9.-]+\.[A-Za-z]{2,}/g, '[redacted-email]'],
  [/\b(?:[0-9A-Fa-f]{2}:){5}[0-9A-Fa-f]{2}\b/g, '[redacted-mac]'],
  [/\b\d{19,20}\b/g, '[redacted-iccid]'],        // ICCID (SIM serial)
  [/\b\d{14,16}\b/g, '[redacted-imei]'],          // IMEI / IMSI / MEID / long device ids
  [/\+\d[\d ()\-.]{6,14}\d/g, '[redacted-phone]'], // international phone numbers
  [/\b\d{3}[-.\s]\d{3}[-.\s]\d{4}\b/g, '[redacted-phone]'], // NANP formatted
]

// scrubSensitive removes IMEIs, phone numbers, SIM serials, MACs and emails.
export function scrubSensitive(text: string): string {
  let out = text
  for (const [re, repl] of SCRUBBERS) out = out.replace(re, repl)
  return out
}
