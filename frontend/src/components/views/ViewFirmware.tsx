import { useState, useEffect, useRef } from 'react'
import { Download, Search, ShieldCheck, X, PackageOpen, FileCheck2 } from 'lucide-react'
import { ListFirmware, DownloadFirmware, CancelOperation, SelectFileForFlash, ListPayloadPartitions, ExtractPayloadPartition, SelectAnyFile, HashFile } from '../../lib/wails'
import { notify } from '../../lib/notify'

const rt = () => (window as any)['runtime']

interface Firmware { version: string; url: string; sha256: string }
interface PayloadPartition { name: string; sizeMB: number }
interface FileHashes { sha256: string; sha1: string; sizeBytes: number }

// Pixel device codenames (newest first). Value = codename used by Google's images.
const PIXEL_DEVICES: { name: string; cn: string }[] = [
  { name: 'Pixel 10 Pro Fold', cn: 'rango' },
  { name: 'Pixel 10 Pro XL', cn: 'mustang' },
  { name: 'Pixel 10 Pro', cn: 'blazer' },
  { name: 'Pixel 10', cn: 'frankel' },
  { name: 'Pixel 9a', cn: 'tegu' },
  { name: 'Pixel 9 Pro Fold', cn: 'comet' },
  { name: 'Pixel 9 Pro XL', cn: 'komodo' },
  { name: 'Pixel 9 Pro', cn: 'caiman' },
  { name: 'Pixel 9', cn: 'tokay' },
  { name: 'Pixel 8a', cn: 'akita' },
  { name: 'Pixel 8 Pro', cn: 'husky' },
  { name: 'Pixel 8', cn: 'shiba' },
  { name: 'Pixel Fold', cn: 'felix' },
  { name: 'Pixel Tablet', cn: 'tangorpro' },
  { name: 'Pixel 7a', cn: 'lynx' },
  { name: 'Pixel 7 Pro', cn: 'cheetah' },
  { name: 'Pixel 7', cn: 'panther' },
  { name: 'Pixel 6a', cn: 'bluejay' },
  { name: 'Pixel 6 Pro', cn: 'raven' },
  { name: 'Pixel 6', cn: 'oriole' },
  { name: 'Pixel 5a', cn: 'barbet' },
  { name: 'Pixel 5', cn: 'redfin' },
  { name: 'Pixel 4a 5G', cn: 'bramble' },
  { name: 'Pixel 4a', cn: 'sunfish' },
  { name: 'Pixel 4 XL', cn: 'coral' },
  { name: 'Pixel 4', cn: 'flame' },
  { name: 'Pixel 3a XL', cn: 'bonito' },
  { name: 'Pixel 3a', cn: 'sargo' },
  { name: 'Pixel 3 XL', cn: 'crosshatch' },
  { name: 'Pixel 3', cn: 'blueline' },
]

export default function ViewFirmware({ codename }: { codename?: string }) {
  const [cn, setCn] = useState(codename || 'husky')
  const [custom, setCustom] = useState(false)
  const [kind, setKind] = useState<'factory' | 'ota'>('factory')
  const [list, setList] = useState<Firmware[]>([])
  const [loading, setLoading] = useState(false)
  const [downloading, setDownloading] = useState(false)
  const [percent, setPercent] = useState(0)
  const [eta, setEta] = useState('')
  const t0 = useRef(0)
  // payload.bin extraction
  const [otaZip, setOtaZip] = useState('')
  const [parts, setParts] = useState<PayloadPartition[] | null>(null)
  const [partsBusy, setPartsBusy] = useState(false)
  const [extracting, setExtracting] = useState('')
  const [extractPct, setExtractPct] = useState(0)
  // verify a file
  const [vName, setVName] = useState('')
  const [vHashes, setVHashes] = useState<FileHashes | null>(null)
  const [vExpected, setVExpected] = useState('')
  const [vBusy, setVBusy] = useState(false)

  useEffect(() => { if (codename) setCn(codename) }, [codename]) // prefill from connected device

  // If the detected codename isn't a known Pixel, still offer it in the list.
  const known = PIXEL_DEVICES.some(d => d.cn === cn)

  useEffect(() => {
    const onProg = (p: { percent: number }) => {
      setPercent(p.percent)
      const now = performance.now()
      if (p.percent <= 1 || !t0.current) t0.current = now
      const elapsed = now - t0.current
      if (p.percent > 1 && p.percent < 100) {
        const total = elapsed / (p.percent / 100)
        const s = Math.round((total - elapsed) / 1000)
        setEta(s < 60 ? `${s}s` : `${Math.floor(s / 60)}m ${String(s % 60).padStart(2, '0')}s`)
      } else setEta('')
    }
    const onDone = () => { setDownloading(false); setPercent(0); setEta(''); t0.current = 0 }
    const off1 = rt()?.EventsOn?.('firmware:progress', onProg)
    const off2 = rt()?.EventsOn?.('firmware:done', onDone)
    const off3 = rt()?.EventsOn?.('payload:progress', (p: { percent: number }) => setExtractPct(p.percent))
    const off4 = rt()?.EventsOn?.('payload:done', () => { setExtracting(''); setExtractPct(0) })
    return () => { off1?.(); off2?.(); off3?.(); off4?.() }
  }, [])

  const pickOta = async () => {
    const z = await SelectFileForFlash()
    if (!z) return
    setOtaZip(z)
    setParts(null)
    setPartsBusy(true)
    try {
      setParts(await ListPayloadPartitions(z) || [])
    } catch (e: any) { notify.error(e); setParts([]) }
    finally { setPartsBusy(false) }
  }

  const verifyFile = async () => {
    const f = await SelectAnyFile()
    if (!f) return
    setVName(f.split('/').pop() || f)
    setVHashes(null)
    setVBusy(true)
    try { setVHashes(await HashFile(f)) }
    catch (e: any) { notify.error(e) }
    finally { setVBusy(false) }
  }

  const extractPart = async (name: string) => {
    setExtracting(name)
    setExtractPct(0)
    try {
      notify.success(await ExtractPayloadPartition(otaZip, name))
    } catch (e: any) { notify.error(e) }
    finally { setExtracting('') }
  }

  const search = async () => {
    setLoading(true)
    setList([])
    try {
      setList(await ListFirmware(cn, kind) || [])
    } catch (e: any) {
      notify.error(e)
    } finally {
      setLoading(false)
    }
  }

  const download = async (fw: Firmware) => {
    setDownloading(true)
    setPercent(0)
    t0.current = 0
    try {
      const out = await DownloadFirmware(fw.url, fw.sha256)
      notify.success(out)
    } catch (e: any) {
      notify.error(e)
    } finally {
      setDownloading(false)
    }
  }

  return (
    <div className="p-4 space-y-4">
      <div className="card p-4 space-y-3">
        <p className="section-title">Download Firmware</p>
        <p className="text-xs text-text-muted">
          Official Google Pixel images. Pick your device (auto-selected from the connected phone when possible). Files are large (2–3 GB) and verified by SHA-256 automatically after download.
        </p>
        <div className="flex items-center gap-2">
          <div className="flex gap-1 bg-bg-raised rounded p-0.5 shrink-0">
            {(['factory', 'ota'] as const).map(k => (
              <button key={k} onClick={() => setKind(k)}
                className={`px-3 py-0.5 rounded text-xs font-medium transition-colors ${kind === k ? 'bg-accent-green/20 text-accent-green' : 'text-text-muted hover:text-text-secondary'}`}>
                {k === 'factory' ? 'Factory' : 'OTA'}
              </button>
            ))}
          </div>
          <select className="input text-xs flex-1" value={custom ? '__other__' : cn}
            onChange={e => {
              if (e.target.value === '__other__') { setCustom(true); setCn('') }
              else { setCustom(false); setCn(e.target.value) }
            }}>
            {!known && cn && !custom && <option value={cn}>{cn} (detected)</option>}
            {PIXEL_DEVICES.map(d => (
              <option key={d.cn} value={d.cn}>{d.name} ({d.cn})</option>
            ))}
            <option value="__other__">Other (type codename)…</option>
          </select>
          {custom && (
            <input className="input text-xs w-32 mono shrink-0" value={cn} placeholder="codename" autoFocus
              onChange={e => setCn(e.target.value.trim())} onKeyDown={e => e.key === 'Enter' && search()} />
          )}
          <button onClick={search} disabled={loading} className="btn-ghost text-xs shrink-0">
            <Search size={13} /> {loading ? 'Searching…' : 'List builds'}
          </button>
        </div>
      </div>

      {downloading && (
        <div className="card p-3 flex items-center gap-3">
          <Download size={14} className="text-accent-green shrink-0" />
          <div className="flex-1 h-1.5 rounded-full bg-bg-border overflow-hidden">
            <div className="h-full bg-accent-green transition-all duration-200" style={{ width: `${percent}%` }} />
          </div>
          <span className="text-xs text-text-muted mono w-10 text-right">{percent}%</span>
          {eta && <span className="text-xs text-text-muted w-20 text-right">~{eta} left</span>}
          <button onClick={() => CancelOperation()} className="btn-warn text-xs">Cancel</button>
        </div>
      )}

      {list.length > 0 && (
        <div className="card divide-y divide-bg-border/50">
          {list.map(fw => (
            <div key={fw.url} className="flex items-center gap-3 px-4 py-2.5">
              <div className="flex-1 min-w-0">
                <p className="text-xs text-text-primary leading-snug break-words">{fw.version}</p>
                {fw.sha256 ? (
                  <>
                    <p className="text-[10px] text-accent-green flex items-center gap-1 mt-0.5">
                      <ShieldCheck size={10} className="shrink-0" /> verified on download
                    </p>
                    <p className="text-[10px] text-text-muted mono break-all leading-snug">{fw.sha256}</p>
                  </>
                ) : (
                  <p className="text-[10px] text-text-muted mt-0.5">no checksum listed</p>
                )}
              </div>
              <button onClick={() => download(fw)} disabled={downloading} className="btn-ghost text-xs shrink-0">
                <Download size={13} /> Download
              </button>
            </div>
          ))}
        </div>
      )}

      {!loading && list.length === 0 && (
        <div className="flex flex-col items-center justify-center py-8 text-text-muted gap-2">
          <X size={24} className="opacity-20" />
          <p className="text-sm">Pick a device and list builds.</p>
        </div>
      )}

      {/* Extract from an existing OTA (payload.bin) */}
      <div className="card p-4 space-y-3">
        <div className="flex items-center gap-2">
          <PackageOpen size={14} className="text-accent-green" />
          <p className="section-title">Extract from OTA (payload.bin)</p>
        </div>
        <p className="text-xs text-text-muted">
          Pull individual partition images (e.g. <span className="mono">init_boot</span>, <span className="mono">boot</span>, <span className="mono">system</span>) out of an A/B OTA zip — for patching, reverting, or analysis. Full OTAs only.
        </p>
        <div className="flex gap-2">
          <input className="input text-xs flex-1 mono" value={otaZip} readOnly placeholder="Select an OTA .zip..." />
          <button onClick={pickOta} disabled={partsBusy} className="btn-ghost text-xs shrink-0">
            {partsBusy ? 'Reading…' : 'Select OTA zip'}
          </button>
        </div>

        {extracting && (
          <div className="flex items-center gap-3">
            <span className="text-xs text-text-secondary shrink-0 mono">{extracting}</span>
            <div className="flex-1 h-1.5 rounded-full bg-bg-border overflow-hidden">
              <div className="h-full bg-accent-green transition-all duration-200" style={{ width: `${extractPct}%` }} />
            </div>
            <span className="text-xs text-text-muted mono w-10 text-right">{extractPct}%</span>
            <button onClick={() => CancelOperation()} className="btn-warn text-xs">Cancel</button>
          </div>
        )}

        {parts !== null && parts.length > 0 && (
          <div className="grid grid-cols-2 sm:grid-cols-3 gap-1.5">
            {parts.map(p => (
              <button
                key={p.name}
                onClick={() => extractPart(p.name)}
                disabled={!!extracting}
                className="flex items-center justify-between gap-2 rounded border border-bg-border px-2 py-1.5 text-xs hover:bg-bg-raised disabled:opacity-50"
              >
                <span className="mono text-text-secondary truncate">{p.name}</span>
                <span className="text-text-muted shrink-0">{p.sizeMB ? `${p.sizeMB}M` : ''}</span>
              </button>
            ))}
          </div>
        )}
        {parts !== null && parts.length === 0 && (
          <p className="text-xs text-text-muted">No partitions found — not an A/B OTA, or it's an incremental update.</p>
        )}
      </div>

      {/* Verify a file (SHA-256) */}
      <div className="card p-4 space-y-3">
        <div className="flex items-center gap-2">
          <FileCheck2 size={14} className="text-accent-green" />
          <p className="section-title">Verify a File (SHA-256)</p>
        </div>
        <div className="flex gap-2">
          <input className="input text-xs flex-1 mono" value={vName} readOnly placeholder="Select any file to hash..." />
          <button onClick={verifyFile} disabled={vBusy} className="btn-ghost text-xs shrink-0">{vBusy ? 'Hashing…' : 'Select file'}</button>
        </div>
        {vHashes && (
          <div className="space-y-2">
            <p className="text-[10px] text-text-muted mono break-all">SHA-256 {vHashes.sha256}</p>
            <p className="text-[10px] text-text-muted mono break-all">SHA-1&nbsp;&nbsp;&nbsp;{vHashes.sha1}</p>
            <input
              className="input text-xs w-full mono"
              placeholder="Paste expected SHA-256 to compare…"
              value={vExpected}
              onChange={e => setVExpected(e.target.value)}
            />
            {vExpected.trim() && (
              vHashes.sha256.toLowerCase() === vExpected.trim().toLowerCase()
                ? <p className="text-xs text-accent-green flex items-center gap-1"><ShieldCheck size={12} /> Match — file is authentic</p>
                : <p className="text-xs text-danger flex items-center gap-1"><X size={12} /> Mismatch — checksums differ</p>
            )}
          </div>
        )}
      </div>
    </div>
  )
}
