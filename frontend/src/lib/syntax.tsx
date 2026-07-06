// Dependency-free, theme-aware syntax highlighter.
//
// tokenize() splits code into typed tokens; <CodeView> renders them as spans
// whose colours come from CSS variables (.syn-* classes in global.css), so the
// highlighting automatically tracks the active theme. Deliberately lightweight —
// ordered sticky-regex rules per language, capped for large inputs — not a full
// parser, but good enough for manifests, config, logs and shell output.
import { useMemo } from 'react'

export type SynLang = 'xml' | 'json' | 'shell' | 'log' | 'text'

interface Rule { re: RegExp; c: string }

// All patterns use the sticky flag so they only match at the cursor position.
const RULES: Record<Exclude<SynLang, 'text'>, Rule[]> = {
  xml: [
    { re: /<!--[\s\S]*?-->/y, c: 'com' },
    { re: /<!\[CDATA\[[\s\S]*?\]\]>/y, c: 'str' },
    { re: /<[?!][\s\S]*?>/y, c: 'com' },
    { re: /<\/?[A-Za-z_][\w:.-]*/y, c: 'tag' },
    { re: /"[^"]*"|'[^']*'/y, c: 'str' },
    { re: /[A-Za-z_][\w:.-]*(?=\s*=)/y, c: 'attr' },
    { re: /\/?>/y, c: 'punc' },
    { re: /\b\d[\w.]*\b/y, c: 'num' },
  ],
  json: [
    { re: /"(?:\\.|[^"\\])*"(?=\s*:)/y, c: 'key' },
    { re: /"(?:\\.|[^"\\])*"/y, c: 'str' },
    { re: /-?\d+(?:\.\d+)?(?:[eE][+-]?\d+)?/y, c: 'num' },
    { re: /\b(?:true|false|null)\b/y, c: 'bool' },
    { re: /[{}\[\],:]/y, c: 'punc' },
  ],
  shell: [
    { re: /#[^\n]*/y, c: 'com' },
    { re: /"(?:\\.|[^"\\])*"|'[^']*'/y, c: 'str' },
    { re: /--?[A-Za-z][\w-]*/y, c: 'attr' },
    { re: /\b0x[0-9a-fA-F]+\b/y, c: 'num' },
    { re: /\b\d+\b/y, c: 'num' },
    { re: /[|&;<>()]/y, c: 'punc' },
  ],
  log: [
    { re: /"(?:\\.|[^"\\])*"/y, c: 'str' },
    { re: /\b(?:true|false|null|enabled|disabled|granted|SYSTEM|DEBUGGABLE|ENABLED|DISABLED)\b/y, c: 'bool' },
    { re: /[A-Za-z_][\w.]*(?=\s*=)/y, c: 'attr' },
    { re: /\b0x[0-9a-fA-F]+\b/y, c: 'num' },
    { re: /\b\d[\d.:]*\b/y, c: 'num' },
    { re: /[=:{}\[\]]/y, c: 'punc' },
  ],
}

const MAX_HIGHLIGHT = 400_000 // skip highlighting for very large blobs (perf)

export interface Tok { t: string; c: string }

export function tokenize(code: string, lang: SynLang): Tok[] {
  if (lang === 'text') return [{ t: code, c: '' }]
  const rules = RULES[lang]
  const out: Tok[] = []
  let plain = ''
  const flush = () => { if (plain) { out.push({ t: plain, c: '' }); plain = '' } }
  let i = 0
  const n = code.length
  while (i < n) {
    let matched = false
    for (const { re, c } of rules) {
      re.lastIndex = i
      const m = re.exec(code)
      if (m && m.index === i && m[0].length > 0) {
        flush()
        out.push({ t: m[0], c })
        i += m[0].length
        matched = true
        break
      }
    }
    if (!matched) { plain += code[i]; i++ }
  }
  flush()
  return out
}

// detectLang guesses a language from a filename and/or content sniff.
export function detectLang(name: string, content: string): SynLang {
  const n = (name || '').toLowerCase()
  if (/\.(xml|htm|html|svg)$/.test(n) || n.endsWith('androidmanifest.xml')) return 'xml'
  if (/\.(json|arsc\.json)$/.test(n)) return 'json'
  if (/\.(sh|bash|zsh|rc|prop|conf|cfg|ini|env)$/.test(n)) return 'shell'
  const head = content.slice(0, 400).trimStart()
  if (head.startsWith('<?xml') || head.startsWith('<manifest') || /^<[A-Za-z!]/.test(head)) return 'xml'
  if (head.startsWith('{') || head.startsWith('[')) return 'json'
  return 'text'
}

export function CodeView({ code, lang, className }: { code: string; lang: SynLang; className?: string }) {
  const toks = useMemo(() => {
    if (!code) return null
    if (code.length > MAX_HIGHLIGHT || lang === 'text') return null
    return tokenize(code, lang)
  }, [code, lang])

  if (!toks) return <pre className={className}>{code}</pre>
  return (
    <pre className={className}>
      {toks.map((t, i) => (t.c ? <span key={i} className={`syn-${t.c}`}>{t.t}</span> : <span key={i}>{t.t}</span>))}
    </pre>
  )
}
