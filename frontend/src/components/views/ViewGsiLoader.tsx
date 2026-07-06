import { useState, useEffect } from 'react'
import { HardDriveDownload, Boxes, Zap, RefreshCw, Check, X, AlertTriangle, FileUp, Play, Power, Trash2, RotateCcw } from 'lucide-react'
import {
  GsiCompat, GsiDsuStatus, InstallDsu, DsuEnable, DsuDisable, DsuWipe,
  FlashGsiSystem, SelectFileForFlash, Reboot,
} from '../../lib/wails'
import { notify } from '../../lib/notify'
import { ensureDangerUnlocked } from '../../lib/applock'
import type { GsiCompat as GsiCompatT } from '../../lib/types'

const GIB = 1073741824

export default function ViewGsiLoader() {
  const [tab, setTab] = useState<'dsu' | 'flash'>('dsu')
  const [compat, setCompat] = useState<GsiCompatT | null>(null)
  const [compatLoading, setCompatLoading] = useState(false)

  // DSU
  const [dsuImage, setDsuImage] = useState('')
  const [systemSize, setSystemSize] = useState(0) // bytes; 0 = auto for raw .img
  const [userdataGiB, setUserdataGiB] = useState(8)
  const [installing, setInstalling] = useState(false)
  const [pushPct, setPushPct] = useState(-1)
  const [dsuStatus, setDsuStatus] = useState('')

  // Flash
  const [flashImage, setFlashImage] = useState('')
  const [vbmeta, setVbmeta] = useState('')
  const [opts, setOpts] = useState({ fastbootd: true, wipeData: true, disableVerity: false, deleteProduct: false, slot: '' })
  const [dryRun, setDryRun] = useState('')
  const [flashing, setFlashing] = useState(false)
  const [flashOut, setFlashOut] = useState('')

  const loadCompat = async () => {
    setCompatLoading(true)
    try { setCompat(await GsiCompat()) } catch (e: any) { notify.error(e) } finally { setCompatLoading(false) }
  }
  useEffect(() => { loadCompat() }, [])

  // Push progress for the DSU image upload.
  useEffect(() => {
    const rt = () => (window as any)['runtime']
    const onProg = (t: any) => { if (t?.label?.includes('atk-dsu') || t?.kind === 'push') setPushPct(t.percent) }
    const onDone = () => setPushPct(-1)
    const off1 = rt()?.EventsOn?.('transfer:progress', onProg)
    const off2 = rt()?.EventsOn?.('transfer:done', onDone)
    return () => { rt()?.EventsOff?.('transfer:progress'); rt()?.EventsOff?.('transfer:done'); off1?.(); off2?.() }
  }, [])

  const pickImage = async (setter: (p: string) => void) => {
    try { const p = await SelectFileForFlash(); if (p) setter(p) } catch (e: any) { notify.error(e) }
  }

  const refreshStatus = async () => {
    try { setDsuStatus((await GsiDsuStatus()) || '(no status)') } catch (e: any) { notify.error(e) }
  }

  const install = async () => {
    if (!dsuImage) { notify.error('Select a GSI image first'); return }
    setInstalling(true); setPushPct(0)
    const id = notify.loading('Preparing & pushing GSI (this can take a while)...')
    try {
      const out = await InstallDsu(dsuImage, systemSize, userdataGiB * GIB)
      notify.dismiss(id); notify.success('DSU install launched'); setDsuStatus(out)
    } catch (e: any) { notify.dismiss(id); notify.error(e) } finally { setInstalling(false); setPushPct(-1) }
  }

  const gsiTool = async (fn: () => Promise<string>, label: string) => {
    try { const out = await fn(); notify.success(`${label}: ${out || 'ok'}`); refreshStatus() } catch (e: any) { notify.error(e) }
  }

  const previewFlash = async () => {
    if (!flashImage) { notify.error('Select a GSI system image first'); return }
    try { setDryRun(await FlashGsiSystem(flashImage, { ...opts, vbmetaPath: vbmeta, dryRun: true })) } catch (e: any) { notify.error(e) }
  }

  const doFlash = async () => {
    if (!flashImage) { notify.error('Select a GSI system image first'); return }
    if (!confirm('Permanently flash this GSI to the system partition?\n\nThis ERASES system, wipes userdata, and requires an unlocked bootloader. If the GSI is incompatible the device may not boot. Continue?')) return
    if (!(await ensureDangerUnlocked())) return
    setFlashing(true)
    const id = notify.loading('Flashing GSI via fastboot...')
    try {
      const out = await FlashGsiSystem(flashImage, { ...opts, vbmetaPath: vbmeta, dryRun: false })
      notify.dismiss(id); notify.success('GSI flashed'); setFlashOut(out)
    } catch (e: any) { notify.dismiss(id); notify.error(e); setFlashOut(String(e?.message || e)) } finally { setFlashing(false) }
  }

  const trebleOk = compat?.trebleEnabled
  const baseName = (p: string) => p.split('/').pop() || p

  return (
    <div className="flex flex-col h-full overflow-hidden">
      {/* Header + tabs */}
      <div className="border-b border-bg-border px-4 py-2 flex items-center gap-2 shrink-0">
        <Boxes size={15} className="text-accent-green" />
        <span className="text-sm font-medium text-text-primary">GSI Loader</span>
        <div className="flex rounded overflow-hidden border border-bg-border ml-2">
          <button onClick={() => setTab('dsu')} className={`px-3 py-1 text-xs flex items-center gap-1 ${tab === 'dsu' ? 'bg-accent-green/20 text-accent-green' : 'text-text-muted hover:bg-bg-raised'}`}>
            <HardDriveDownload size={12} /> DSU (Temporary)
          </button>
          <button onClick={() => setTab('flash')} className={`px-3 py-1 text-xs flex items-center gap-1 ${tab === 'flash' ? 'bg-accent-green/20 text-accent-green' : 'text-text-muted hover:bg-bg-raised'}`}>
            <Zap size={12} /> GSI Flasher (Permanent)
          </button>
        </div>
        <div className="flex-1" />
        <button onClick={loadCompat} disabled={compatLoading} className="btn-ghost text-xs">
          <RefreshCw size={12} className={compatLoading ? 'animate-spin' : ''} /> Recheck
        </button>
      </div>

      {/* Compatibility panel */}
      <div className="border-b border-bg-border px-4 py-2 shrink-0 bg-bg-surface flex items-center gap-4 flex-wrap text-xs">
        <span className="section-title">Compatibility</span>
        {!compat && <span className="text-text-muted">{compatLoading ? 'Checking…' : 'No device / unknown'}</span>}
        {compat && (
          <>
            <span className={`flex items-center gap-1 ${trebleOk ? 'text-accent-green' : 'text-danger'}`}>
              {trebleOk ? <Check size={12} /> : <X size={12} />} Treble {trebleOk ? 'enabled' : 'NOT enabled'}
            </span>
            <span className="text-text-secondary">ABI: <span className="mono text-text-primary">{compat.abi || '?'}</span> → use <span className="mono text-accent-green">{compat.gsiArch || '?'}</span> GSI</span>
            <span className="text-text-secondary">Android {compat.androidRelease || '?'} (SDK {compat.sdk || '?'})</span>
            <span className={compat.vndkIsolated ? 'text-accent-green' : 'text-warn'}>
              {compat.vndkIsolated ? 'VNDK isolated — any newer GSI' : 'not VNDK-isolated — same-version GSI only'}
            </span>
          </>
        )}
        {compat && !trebleOk && (
          <span className="flex items-center gap-1 text-danger"><AlertTriangle size={12} /> Device may not support GSIs</span>
        )}
      </div>

      <div className="flex-1 overflow-auto p-4">
        {tab === 'dsu' ? (
          <div className="max-w-2xl space-y-4">
            <p className="text-xs text-text-muted leading-relaxed">
              Installs a GSI as a temporary <span className="text-text-secondary">guest OS</span> via Dynamic System Updates — no unlock,
              no data wipe. Pick a <span className="text-text-secondary">raw</span> (unsparsed) GSI <span className="mono">system.img</span> or a
              <span className="mono"> .gz</span> you made from one. After install, tap <span className="text-accent-green">Restart</span> in the device notification to boot it.
            </p>

            {/* Image picker */}
            <div className="flex items-center gap-2">
              <button onClick={() => pickImage(setDsuImage)} className="btn-ghost text-xs"><FileUp size={12} /> Select GSI image</button>
              <span className="mono text-xs text-text-secondary truncate">{dsuImage ? baseName(dsuImage) : 'no file selected'}</span>
            </div>

            <div className="grid grid-cols-2 gap-4">
              <div>
                <p className="text-xs text-text-muted mb-1">Userdata size (GiB)</p>
                <input type="number" min={1} className="input text-xs w-full" value={userdataGiB} onChange={e => setUserdataGiB(Math.max(1, Number(e.target.value)))} />
              </div>
              <div>
                <p className="text-xs text-text-muted mb-1">System size (bytes) — auto for raw .img, <span className="text-warn">required for .gz</span></p>
                <input type="number" min={0} className="input text-xs w-full" value={systemSize} onChange={e => setSystemSize(Math.max(0, Number(e.target.value)))} placeholder="0 = auto (raw .img)" />
              </div>
            </div>

            {pushPct >= 0 && (
              <div className="flex items-center gap-2">
                <div className="flex-1 h-2 bg-bg-border rounded-full overflow-hidden">
                  <div className="h-full bg-accent-green transition-all duration-200" style={{ width: `${pushPct}%` }} />
                </div>
                <span className="mono text-xs text-text-muted w-10 text-right">{pushPct}%</span>
              </div>
            )}

            <div className="flex items-center gap-2">
              <button onClick={install} disabled={installing || !dsuImage} className="btn-primary text-xs">
                <Play size={12} /> {installing ? 'Installing…' : 'Install DSU'}
              </button>
              <button onClick={() => Reboot('')} className="btn-ghost text-xs" title="Cold reboot — boots the GSI if just installed, or back to the host OS"><RotateCcw size={12} /> Reboot</button>
            </div>

            {/* gsi_tool management */}
            <div className="border-t border-bg-border pt-3 space-y-2">
              <p className="section-title">DSU management (gsi_tool)</p>
              <div className="flex items-center gap-2 flex-wrap">
                <button onClick={refreshStatus} className="btn-ghost text-xs"><RefreshCw size={12} /> Status</button>
                <button onClick={() => gsiTool(DsuEnable, 'enabled (sticky)')} className="btn-ghost text-xs"><Power size={12} /> Enable sticky</button>
                <button onClick={() => gsiTool(DsuDisable, 'disabled')} className="btn-ghost text-xs"><Power size={12} /> Disable</button>
                <button onClick={() => gsiTool(DsuWipe, 'wiped')} className="btn-danger text-xs"><Trash2 size={12} /> Wipe DSU</button>
              </div>
              {dsuStatus && <pre className="mono text-[11px] text-text-secondary whitespace-pre-wrap bg-bg-raised rounded p-2 border border-bg-border max-h-40 overflow-auto">{dsuStatus}</pre>}
            </div>
          </div>
        ) : (
          <div className="max-w-2xl space-y-4">
            <div className="flex items-start gap-2 rounded border border-danger/30 bg-danger/5 p-3">
              <AlertTriangle size={14} className="text-danger shrink-0 mt-0.5" />
              <p className="text-xs text-danger/90">
                <span className="font-medium">Destructive & permanent.</span> Erases the system partition, wipes userdata, and needs an
                <span className="font-medium"> unlocked bootloader</span>. An incompatible GSI can leave the device unbootable — keep the stock factory image to recover. GSIs don't support rollback.
              </p>
            </div>

            <div className="flex items-center gap-2">
              <button onClick={() => pickImage(setFlashImage)} className="btn-ghost text-xs"><FileUp size={12} /> Select GSI system.img</button>
              <span className="mono text-xs text-text-secondary truncate">{flashImage ? baseName(flashImage) : 'no file selected'}</span>
            </div>

            <div className="grid grid-cols-2 gap-2">
              {([
                ['fastbootd', 'Reboot to fastbootd first (dynamic partitions)'],
                ['wipeData', 'Wipe userdata (fastboot -w)'],
                ['disableVerity', 'Disable Verified Boot (flash vbmeta)'],
                ['deleteProduct', 'Delete product partition (free space)'],
              ] as const).map(([key, label]) => (
                <label key={key} className="flex items-center gap-2 text-xs text-text-secondary cursor-pointer">
                  <input type="checkbox" checked={(opts as any)[key]} onChange={e => setOpts(o => ({ ...o, [key]: e.target.checked }))} className="accent-accent-green" />
                  {label}
                </label>
              ))}
            </div>

            {(opts.disableVerity) && (
              <div className="flex items-center gap-2">
                <button onClick={() => pickImage(setVbmeta)} className="btn-ghost text-xs"><FileUp size={12} /> Select vbmeta.img</button>
                <span className="mono text-xs text-text-secondary truncate">{vbmeta ? baseName(vbmeta) : 'required for disable-verity'}</span>
              </div>
            )}

            {(opts.deleteProduct) && (
              <div className="flex items-center gap-2">
                <span className="text-xs text-text-muted">Active slot suffix:</span>
                <select className="input text-xs w-24" value={opts.slot} onChange={e => setOpts(o => ({ ...o, slot: e.target.value }))}>
                  <option value="">(none)</option>
                  <option value="a">a</option>
                  <option value="b">b</option>
                </select>
              </div>
            )}

            <div className="flex items-center gap-2">
              <button onClick={previewFlash} disabled={!flashImage} className="btn-ghost text-xs">Dry run (preview commands)</button>
              <button onClick={doFlash} disabled={flashing || !flashImage} className="btn-danger text-xs"><Zap size={12} /> {flashing ? 'Flashing…' : 'Flash GSI'}</button>
            </div>

            {dryRun && (
              <div>
                <p className="section-title mb-1">Command preview</p>
                <pre className="mono text-[11px] text-accent-green whitespace-pre-wrap bg-bg-raised rounded p-2 border border-bg-border">{dryRun}</pre>
              </div>
            )}
            {flashOut && (
              <div>
                <p className="section-title mb-1">Output</p>
                <pre className="mono text-[11px] text-text-secondary whitespace-pre-wrap bg-bg-raised rounded p-2 border border-bg-border max-h-60 overflow-auto">{flashOut}</pre>
              </div>
            )}
          </div>
        )}
      </div>
    </div>
  )
}
