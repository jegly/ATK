import { useState, useCallback, useEffect } from 'react'
import {
  Zap, RefreshCw, AlertTriangle, Power, Unlock, Lock, Rocket, HardDrive, KeyRound, Download, Boxes, Trash2, FileSearch
} from 'lucide-react'
import {
  GetFastbootDevices, FlashPartition, FastbootGetVar, SelectFileForFlash,
  SideloadPackage, SelectFileForInstall, FastbootBoot, FlashBootImage,
  FastbootFlashing, FastbootReboot, FlasherDeviceInfo, Reboot,
  MagiskInstalled, InstallMagisk, ExtractBootImages, PushImageToDevice, OpenMagisk, PullPatchedBoot,
  ListMagiskModules, ToggleMagiskModule, RemoveMagiskModule, AnalyzeBootImage
} from '../../lib/wails'
import { notify } from '../../lib/notify'
import { ensureDangerUnlocked } from '../../lib/applock'
import { getRootTools } from '../../lib/featureflags'
import DismissibleBanner from '../DismissibleBanner'
import ViewPixelFlasher from './ViewPixelFlasher'
import ViewFirmware from './ViewFirmware'
import type { Device } from '../../lib/types'

interface BootImages { boot: string; initBoot: string; source: string }
interface MagiskModule { id: string; name: string; version: string; author: string; description: string; enabled: boolean }
interface BootInfo { valid: boolean; type: string; headerVersion: number; androidVersion: string; securityPatch: string; pageSize: number; kernelKB: number; ramdiskKB: number; sizeMB: number; sha1: string; sha256: string; root: string }

const PARTITIONS = [
  'boot', 'init_boot', 'recovery', 'system', 'vendor', 'userdata',
  'dtbo', 'vbmeta', 'super', 'product', 'odm', 'radio'
]
const BOOT_PARTITIONS = ['boot', 'init_boot', 'vendor_boot', 'recovery', 'dtbo', 'vbmeta']

interface FlasherInfo {
  connection: string
  serial: string
  slot: string
  bootloader: string
  fingerprint: string
  androidVer: string
  codename: string
  lockState: string
  verifiedBoot: string
  root: string
}

// Tabbed container: all flash-related tools live here (Manual fastboot/sideload
// + Pixel factory-image flashing) to keep the sidebar uncluttered.
export default function ViewFlasher() {
  const [tab, setTab] = useState<'manual' | 'pixel' | 'download'>('manual')
  const [info, setInfo] = useState<FlasherInfo | null>(null)
  const [loadingInfo, setLoadingInfo] = useState(false)

  const refreshInfo = useCallback(async () => {
    setLoadingInfo(true)
    try {
      setInfo(await FlasherDeviceInfo())
    } catch {
      setInfo(null)
    } finally {
      setLoadingInfo(false)
    }
  }, [])

  useEffect(() => { refreshInfo() }, [refreshInfo])

  return (
    <div className="flex flex-col h-full">
      <div className="border-b border-bg-border px-4 py-2 flex items-center gap-3 shrink-0">
        <Zap size={15} className="text-accent-green" />
        <span className="text-sm font-medium text-text-primary">Flasher</span>
        <div className="flex gap-1 bg-bg-raised rounded p-0.5 ml-1">
          {([['manual', 'Manual'], ['pixel', 'Pixel Factory'], ['download', 'Download']] as const).map(([id, label]) => (
            <button
              key={id}
              onClick={() => setTab(id)}
              className={`px-3 py-0.5 rounded text-xs font-medium transition-colors ${
                tab === id ? 'bg-accent-green/20 text-accent-green' : 'text-text-muted hover:text-text-secondary'
              }`}
            >
              {label}
            </button>
          ))}
        </div>
      </div>

      <DeviceBar info={info} loading={loadingInfo} onRefresh={refreshInfo} />

      <div className="flex-1 overflow-auto">
        {tab === 'manual' && <ManualFlash info={info} refresh={refreshInfo} />}
        {tab === 'pixel' && <ViewPixelFlasher />}
        {tab === 'download' && <ViewFirmware codename={info?.codename} />}
      </div>
    </div>
  )
}

function Chip({ label, value, tone }: { label: string; value?: string; tone?: 'green' | 'red' | 'amber' }) {
  const color = tone === 'green' ? 'text-accent-green' : tone === 'red' ? 'text-danger' : tone === 'amber' ? 'text-warn' : 'text-text-secondary'
  return (
    <span className="flex items-center gap-1 whitespace-nowrap">
      <span className="text-text-muted">{label}</span>
      <span className={`mono ${color}`}>{value || '—'}</span>
    </span>
  )
}

function DeviceBar({ info, loading, onRefresh }: { info: FlasherInfo | null; loading: boolean; onRefresh: () => void }) {
  const conn = info?.connection ?? 'none'
  const connTone = conn === 'none' ? 'red' : 'green'
  return (
    <div className="border-b border-bg-border bg-bg-surface px-4 py-1.5 flex items-center gap-4 text-xs overflow-x-auto shrink-0">
      <Chip label="Mode" value={conn} tone={connTone as any} />
      {conn !== 'none' && <>
        <Chip label="Serial" value={info?.serial} />
        <Chip label="Slot" value={info?.slot ? info.slot : undefined} />
        <Chip label="Bootloader" value={info?.bootloader} />
        <Chip label="Lock" value={info?.lockState} tone={info?.lockState === 'unlocked' ? 'amber' : info?.lockState === 'locked' ? 'green' : undefined} />
        {info?.codename && <Chip label="Device" value={info?.codename} />}
        {info?.androidVer && <Chip label="Android" value={info?.androidVer} />}
        {info?.root && <Chip label="Root" value={info.root} tone={info.root !== 'none' ? 'amber' : undefined} />}
      </>}
      <button onClick={onRefresh} disabled={loading} className="btn-ghost text-xs ml-auto shrink-0" title="Refresh device info">
        <RefreshCw size={12} className={loading ? 'animate-spin' : ''} /> Refresh
      </button>
    </div>
  )
}

interface ManualProps { info: FlasherInfo | null; refresh: () => void }

function ManualFlash({ info, refresh }: ManualProps) {
  const [devices, setDevices] = useState<Device[]>([])
  const [loadingDevices, setLoadingDevices] = useState(false)
  const [partition, setPartition] = useState('boot')
  const [selectedFile, setSelectedFile] = useState('')
  const [flashing, setFlashing] = useState(false)
  const [getvarKey, setGetvarKey] = useState('all')
  const [getvarResult, setGetvarResult] = useState('')
  // Live-boot / boot-image flashing
  const [bootFile, setBootFile] = useState('')
  const [bootPartition, setBootPartition] = useState('boot')
  const [slot, setSlot] = useState('')
  const [busy, setBusy] = useState('')
  // Magisk rooting flow (gated by Settings → Advanced)
  const rootTools = getRootTools()
  const [magiskBusy, setMagiskBusy] = useState('')
  const [extracted, setExtracted] = useState<BootImages | null>(null)
  const [patchTarget, setPatchTarget] = useState<'boot' | 'initBoot'>('initBoot')
  const [magiskPkg, setMagiskPkg] = useState('')
  const [modules, setModules] = useState<MagiskModule[] | null>(null)
  const [modulesBusy, setModulesBusy] = useState(false)
  const [dryRun, setDryRun] = useState(false)
  const [force, setForce] = useState(false)
  const [bootInfo, setBootInfo] = useState<BootInfo | null>(null)

  const inFastboot = info?.connection === 'fastboot'

  const refreshDevices = useCallback(async () => {
    setLoadingDevices(true)
    try {
      const devs = await GetFastbootDevices()
      setDevices(devs || [])
    } catch (e: any) {
      notify.error(e)
      setDevices([])
    } finally {
      setLoadingDevices(false)
    }
  }, [])

  const handleSelectFile = async () => {
    const path = await SelectFileForFlash()
    if (path) setSelectedFile(path)
  }

  const handleFlash = async () => {
    if (!selectedFile) { notify.error('Select an image file first'); return }
    if (dryRun) { notify.info(`[dry run] fastboot ${force ? '--force ' : ''}flash ${partition} ${selectedFile}`); return }
    if (!confirm(`Flash ${selectedFile} to ${partition}?${force ? '\n\n⚠ --force is ON (skips safety checks).' : ''}\n\nThis overwrites the ${partition} partition.`)) return
    if (!(await ensureDangerUnlocked())) return
    setFlashing(true)
    const id = notify.loading(`Flashing ${partition}...`)
    try {
      const out = await FlashPartition(partition, selectedFile, force)
      notify.dismiss(id); notify.success(out || `${partition} flashed`)
    } catch (e: any) { notify.dismiss(id); notify.error(e) }
    finally { setFlashing(false) }
  }

  const handleGetvar = async () => {
    try { setGetvarResult(await FastbootGetVar(getvarKey)) }
    catch (e: any) { setGetvarResult(String(e)) }
  }

  const handleSideload = async () => {
    const path = await SelectFileForInstall()
    if (!path) return
    if (!confirm('Sideload requires the device in sideload mode (recovery → Apply update from ADB). Continue?')) return
    if (!(await ensureDangerUnlocked())) return
    const id = notify.loading('Sideloading...')
    try {
      const out = await SideloadPackage(path)
      notify.dismiss(id); notify.success(out || 'Sideload complete')
    } catch (e: any) { notify.dismiss(id); notify.error(e) }
  }

  const reboot = async (target: string) => {
    setBusy('reboot')
    try {
      if (inFastboot) await FastbootReboot(target)
      else await Reboot(target) // adb: '', bootloader, recovery, fastboot, sideload
      notify.success(`Reboot ${target || 'system'} sent`)
      setTimeout(refresh, 3500)
    } catch (e: any) { notify.error(e) }
    finally { setBusy('') }
  }

  const flashing2 = async (action: 'unlock' | 'lock') => {
    if (!confirm(`fastboot flashing ${action}\n\n${action === 'unlock'
      ? 'Unlocking ERASES ALL DATA and requires confirmation on the device screen.'
      : 'Locking ERASES ALL DATA. Only lock with fully stock partitions or you may brick the device.'}\n\nContinue?`)) return
    if (!(await ensureDangerUnlocked())) return
    setBusy(action)
    try {
      const out = await FastbootFlashing(action)
      notify.success(out)
      setTimeout(refresh, 1500)
    } catch (e: any) { notify.error(e) }
    finally { setBusy('') }
  }

  const selectBootFile = async () => {
    const path = await SelectFileForFlash()
    if (path) setBootFile(path)
  }

  const liveBoot = async () => {
    if (!bootFile) { notify.error('Select an image first'); return }
    if (dryRun) { notify.info(`[dry run] fastboot boot ${bootFile}`); return }
    setBusy('liveboot')
    const id = notify.loading('Live-booting image...')
    try {
      await FastbootBoot(bootFile)
      notify.dismiss(id); notify.success('Booting image — watch the device')
      setTimeout(refresh, 4000)
    } catch (e: any) { notify.dismiss(id); notify.error(e) }
    finally { setBusy('') }
  }

  // ── Magisk assisted patch flow ──
  const checkMagisk = useCallback(async () => {
    try { setMagiskPkg(await MagiskInstalled()) } catch { setMagiskPkg('') }
  }, [])
  useEffect(() => { if (rootTools) checkMagisk() }, [rootTools, checkMagisk])

  const installMagisk = async () => {
    if (!(await ensureDangerUnlocked())) return
    setMagiskBusy('install')
    const id = notify.loading('Downloading & installing Magisk (may take a moment)...')
    try {
      const out = await InstallMagisk()
      notify.dismiss(id); notify.success(out)
      checkMagisk()
    } catch (e: any) { notify.dismiss(id); notify.error(e) }
    finally { setMagiskBusy('') }
  }

  const loadModules = async () => {
    setModulesBusy(true)
    try {
      setModules(await ListMagiskModules() || [])
    } catch (e: any) { notify.error(e); setModules([]) }
    finally { setModulesBusy(false) }
  }
  const toggleModule = async (m: MagiskModule) => {
    try {
      const out = await ToggleMagiskModule(m.id, !m.enabled)
      notify.success(out)
      setModules(mods => mods?.map(x => x.id === m.id ? { ...x, enabled: !x.enabled } : x) || null)
    } catch (e: any) { notify.error(e) }
  }
  const removeModule = async (m: MagiskModule) => {
    if (!confirm(`Flag "${m.name}" for removal on next reboot?`)) return
    try { notify.success(await RemoveMagiskModule(m.id)) }
    catch (e: any) { notify.error(e) }
  }

  const magiskExtract = async () => {
    const zip = await SelectFileForFlash()
    if (!zip) return
    setMagiskBusy('extract')
    const id = notify.loading('Extracting boot images from factory zip...')
    try {
      const imgs: BootImages = await ExtractBootImages(zip)
      setExtracted(imgs)
      setPatchTarget(imgs.initBoot ? 'initBoot' : 'boot')
      notify.dismiss(id)
      notify.success(`Found ${[imgs.boot && 'boot.img', imgs.initBoot && 'init_boot.img'].filter(Boolean).join(' + ')}`)
    } catch (e: any) { notify.dismiss(id); notify.error(e) }
    finally { setMagiskBusy('') }
  }

  const magiskPushOpen = async () => {
    if (!extracted) return
    const local = patchTarget === 'initBoot' ? extracted.initBoot : extracted.boot
    if (!local) { notify.error('That image is not present in the zip'); return }
    setMagiskBusy('push')
    const id = notify.loading('Pushing image and opening Magisk...')
    try {
      await MagiskInstalled() // surfaces a clear error if Magisk isn't installed
      await PushImageToDevice(local)
      await OpenMagisk()
      notify.dismiss(id)
      notify.success('Pushed to /sdcard/Download. In Magisk: Install → Select and Patch a File → pick it → Let\'s Go.')
    } catch (e: any) { notify.dismiss(id); notify.error(e) }
    finally { setMagiskBusy('') }
  }

  const magiskPull = async () => {
    setMagiskBusy('pull')
    const id = notify.loading('Pulling patched image...')
    try {
      const path = await PullPatchedBoot()
      notify.dismiss(id)
      setBootFile(path)
      setBootPartition(patchTarget === 'initBoot' ? 'init_boot' : 'boot')
      notify.success('Patched image loaded into "Boot Image" below — Live boot to test, or Flash to make root permanent.')
    } catch (e: any) { notify.dismiss(id); notify.error(e) }
    finally { setMagiskBusy('') }
  }

  const flashBoot = async () => {
    if (!bootFile) { notify.error('Select an image first'); return }
    if (dryRun) { notify.info(`[dry run] fastboot ${force ? '--force ' : ''}${slot ? '--slot ' + slot + ' ' : ''}flash ${bootPartition} ${bootFile}`); return }
    const where = slot ? ` (slot ${slot})` : ''
    if (!confirm(`Flash ${bootFile}\n→ ${bootPartition}${where}?${force ? '\n\n⚠ --force is ON.' : ''}`)) return
    if (!(await ensureDangerUnlocked())) return
    setBusy('flashboot')
    const id = notify.loading(`Flashing ${bootPartition}...`)
    try {
      const out = await FlashBootImage(bootPartition, bootFile, slot, force)
      notify.dismiss(id); notify.success(out || `${bootPartition} flashed`)
    } catch (e: any) { notify.dismiss(id); notify.error(e) }
    finally { setBusy('') }
  }

  const analyzeBoot = async () => {
    const f = await SelectFileForFlash()
    if (!f) return
    setBootInfo(null)
    try { setBootInfo(await AnalyzeBootImage(f)) }
    catch (e: any) { notify.error(e) }
  }

  return (
    <div className="p-4 space-y-4">
      <DismissibleBanner id="warn-flasher" className="bg-warn/5 border border-warn/20 rounded-lg px-4 py-3 text-warn">
        <AlertTriangle size={16} className="text-warn shrink-0 mt-0.5" />
        <div className="text-xs text-warn/90">
          <p className="font-medium mb-1">Fastboot operations are destructive and irreversible.</p>
          <p className="text-warn/70">Wrong partition or wrong image = bricked device. Make sure the bootloader is unlocked before flashing.</p>
        </div>
      </DismissibleBanner>

      <div className="flex items-center justify-between gap-3 px-1">
        <div>
          <p className="text-xs font-medium text-text-primary">Dry run</p>
          <p className="text-[11px] text-text-muted">Preview the exact fastboot command instead of running it (flash / live-boot).</p>
        </div>
        <button
          onClick={() => setDryRun(v => !v)}
          role="switch"
          aria-checked={dryRun}
          className={`relative h-5 w-9 rounded-full transition-colors shrink-0 ${dryRun ? 'bg-warn' : 'bg-bg-border'}`}
        >
          <span className={`absolute top-0.5 h-4 w-4 rounded-full bg-bg-surface shadow transition-all ${dryRun ? 'left-[18px]' : 'left-0.5'}`} />
        </button>
      </div>

      <div className="flex items-center justify-between gap-3 px-1">
        <div>
          <p className="text-xs font-medium text-text-primary">Force (<span className="mono">--force</span>)</p>
          <p className="text-[11px] text-text-muted">Adds <span className="mono">--force</span> to flash commands (e.g. bootloader/radio). Skips safety checks — use only when you know it's needed.</p>
        </div>
        <button
          onClick={() => setForce(v => !v)}
          role="switch"
          aria-checked={force}
          className={`relative h-5 w-9 rounded-full transition-colors shrink-0 ${force ? 'bg-danger' : 'bg-bg-border'}`}
        >
          <span className={`absolute top-0.5 h-4 w-4 rounded-full bg-bg-surface shadow transition-all ${force ? 'left-[18px]' : 'left-0.5'}`} />
        </button>
      </div>

      <div className="grid grid-cols-1 xl:grid-cols-2 gap-4">
        {/* Reboot */}
        <div className="card p-4 space-y-3">
          <p className="section-title">Reboot</p>
          <p className="text-xs text-text-muted">{inFastboot ? 'Device in fastboot — uses fastboot reboot.' : 'Device in adb — uses adb reboot.'}</p>
          <div className="grid grid-cols-2 gap-2">
            <button onClick={() => reboot('')} disabled={!!busy} className="btn-ghost text-xs"><Power size={12} /> System</button>
            <button onClick={() => reboot('bootloader')} disabled={!!busy} className="btn-ghost text-xs">Bootloader</button>
            <button onClick={() => reboot('fastboot')} disabled={!!busy} className="btn-ghost text-xs">Fastbootd</button>
            <button onClick={() => reboot('recovery')} disabled={!!busy} className="btn-ghost text-xs">Recovery</button>
          </div>
        </div>

        {/* Bootloader */}
        <div className="card p-4 space-y-3">
          <p className="section-title">Bootloader Lock</p>
          <p className="text-xs text-text-muted">
            {inFastboot ? `Current: ${info?.lockState ?? 'unknown'}. Both actions wipe the device.` : 'Connect a device in fastboot mode to lock/unlock.'}
          </p>
          <div className="flex gap-2">
            <button onClick={() => flashing2('unlock')} disabled={!inFastboot || !!busy} className="btn-warn text-xs flex-1 justify-center"><Unlock size={13} /> Unlock</button>
            <button onClick={() => flashing2('lock')} disabled={!inFastboot || !!busy} className="btn-ghost text-xs flex-1 justify-center"><Lock size={13} /> Lock</button>
          </div>
        </div>

        {/* Magisk rooting flow (gated by Settings → Advanced) */}
        {rootTools && (
          <div className="card p-4 space-y-3 xl:col-span-2 border border-warn/20">
            <div className="flex items-center gap-2">
              <KeyRound size={14} className="text-warn" />
              <p className="section-title">Root with Magisk</p>
            </div>
            <p className="text-xs text-text-muted">
              Patches the factory boot image with the Magisk app on your phone, then loads it below to Live boot (temporary root) or Flash (permanent). ATK doesn't bundle Magisk — it uses the app on your device (install it below if missing). Requires an unlocked bootloader.
            </p>
            <div className="flex items-center justify-between gap-2 text-xs border-b border-bg-border pb-3">
              <span className={magiskPkg ? 'text-accent-green' : 'text-text-muted'}>
                {magiskPkg ? `Magisk detected: ${magiskPkg}` : 'Magisk not detected on device'}
              </span>
              <button onClick={installMagisk} disabled={!!magiskBusy} className="btn-ghost text-xs shrink-0">
                <Download size={12} /> {magiskBusy === 'install' ? 'Installing…' : 'Download & install Magisk'}
              </button>
            </div>
            <div className="grid grid-cols-1 sm:grid-cols-3 gap-2">
              <button onClick={magiskExtract} disabled={!!magiskBusy} className="btn-ghost text-xs justify-center">
                1. {magiskBusy === 'extract' ? 'Extracting…' : 'Extract boot from zip'}
              </button>
              <button onClick={magiskPushOpen} disabled={!extracted || !!magiskBusy} className="btn-ghost text-xs justify-center">
                2. {magiskBusy === 'push' ? 'Pushing…' : 'Push + open Magisk'}
              </button>
              <button onClick={magiskPull} disabled={!!magiskBusy} className="btn-ghost text-xs justify-center">
                3. {magiskBusy === 'pull' ? 'Pulling…' : 'Pull patched image'}
              </button>
            </div>
            {extracted && (
              <div className="flex items-center gap-2 text-xs">
                <span className="text-text-muted">Patch:</span>
                {(['initBoot', 'boot'] as const).map(t => {
                  const has = t === 'initBoot' ? extracted.initBoot : extracted.boot
                  return (
                    <button
                      key={t}
                      disabled={!has}
                      onClick={() => setPatchTarget(t)}
                      className={`px-2 py-0.5 rounded border text-xs ${
                        patchTarget === t ? 'border-accent-green text-accent-green bg-accent-green/10' : 'border-bg-border text-text-muted'
                      } ${!has ? 'opacity-40 cursor-not-allowed' : ''}`}
                    >
                      {t === 'initBoot' ? 'init_boot.img' : 'boot.img'}
                    </button>
                  )
                })}
                <span className="text-text-muted ml-1">(init_boot for Pixel 7+/8+, boot for older)</span>
              </div>
            )}
            <p className="text-[11px] text-text-muted">Step 2 opens Magisk on the phone — tap <span className="text-text-secondary">Install → Select and Patch a File</span>, choose the pushed image in Download, then <span className="text-text-secondary">Let's Go</span>. Then run step 3.</p>
          </div>
        )}

        {/* Magisk module management (gated, requires root) */}
        {rootTools && (
          <div className="card p-4 space-y-3 xl:col-span-2 border border-warn/20">
            <div className="flex items-center justify-between">
              <div className="flex items-center gap-2">
                <Boxes size={14} className="text-warn" />
                <p className="section-title">Magisk Modules</p>
              </div>
              <button onClick={loadModules} disabled={modulesBusy} className="btn-ghost text-xs">
                <RefreshCw size={12} className={modulesBusy ? 'animate-spin' : ''} /> {modules === null ? 'Load' : 'Refresh'}
              </button>
            </div>
            <p className="text-xs text-text-muted">Enable/disable or remove installed modules. Requires root (grant shell root in Magisk if prompted); changes apply on reboot.</p>
            {modules !== null && (
              modules.length === 0 ? (
                <p className="text-xs text-text-muted text-center py-3">No modules installed (or device not rooted).</p>
              ) : (
                <div className="divide-y divide-bg-border/50">
                  {modules.map(m => (
                    <div key={m.id} className="flex items-center gap-3 py-2">
                      <div className="flex-1 min-w-0">
                        <p className="text-xs text-text-primary truncate">{m.name} <span className="text-text-muted">{m.version}</span></p>
                        <p className="text-[10px] text-text-muted truncate">{m.author || m.id}</p>
                      </div>
                      <button
                        onClick={() => toggleModule(m)}
                        role="switch"
                        aria-checked={m.enabled}
                        title={m.enabled ? 'Enabled' : 'Disabled'}
                        className={`relative h-5 w-9 rounded-full transition-colors shrink-0 ${m.enabled ? 'bg-accent-green' : 'bg-bg-border'}`}
                      >
                        <span className={`absolute top-0.5 h-4 w-4 rounded-full bg-bg-surface shadow transition-all ${m.enabled ? 'left-[18px]' : 'left-0.5'}`} />
                      </button>
                      <button onClick={() => removeModule(m)} title="Remove on reboot" className="text-text-muted hover:text-danger shrink-0">
                        <Trash2 size={13} />
                      </button>
                    </div>
                  ))}
                </div>
              )
            )}
          </div>
        )}

        {/* Live boot + boot image flashing */}
        <div className="card p-4 space-y-3 xl:col-span-2">
          <p className="section-title">Boot Image — Live Boot &amp; Flash</p>
          <div className="flex gap-2">
            <input className="input text-xs flex-1 mono" value={bootFile} readOnly placeholder="Select a boot / init_boot image (.img)" />
            <button onClick={selectBootFile} className="btn-ghost text-xs shrink-0">Browse</button>
          </div>
          <div className="flex flex-wrap items-end gap-3">
            <label className="block">
              <span className="text-xs text-text-muted">Partition</span>
              <select className="input text-xs mt-1" value={bootPartition} onChange={e => setBootPartition(e.target.value)}>
                {BOOT_PARTITIONS.map(p => <option key={p} value={p}>{p}</option>)}
              </select>
            </label>
            <label className="block">
              <span className="text-xs text-text-muted">Slot</span>
              <select className="input text-xs mt-1" value={slot} onChange={e => setSlot(e.target.value)}>
                <option value="">current</option>
                <option value="a">a</option>
                <option value="b">b</option>
                <option value="all">both</option>
              </select>
            </label>
            <div className="flex gap-2 ml-auto">
              <button onClick={liveBoot} disabled={!inFastboot || !bootFile || !!busy} className="btn-ghost text-sm" title="Boot the image without flashing">
                <Rocket size={14} /> {busy === 'liveboot' ? 'Booting…' : 'Live boot'}
              </button>
              <button onClick={flashBoot} disabled={!inFastboot || !bootFile || !!busy} className="btn-danger text-sm">
                <HardDrive size={14} /> {busy === 'flashboot' ? 'Flashing…' : `Flash ${bootPartition}`}
              </button>
            </div>
          </div>
          {!inFastboot && <p className="text-xs text-text-muted">Connect a device in fastboot mode to live-boot or flash.</p>}
        </div>

        {/* Boot image analyzer (local file — no device needed) */}
        <div className="card p-4 space-y-3 xl:col-span-2">
          <div className="flex items-center justify-between">
            <div className="flex items-center gap-2">
              <FileSearch size={14} className="text-accent-green" />
              <p className="section-title">Boot Image Analyzer</p>
            </div>
            <button onClick={analyzeBoot} className="btn-ghost text-xs">Analyze a .img…</button>
          </div>
          <p className="text-xs text-text-muted">Inspect a boot / init_boot image: type, header, Android version + security patch, sizes, hashes, and whether it looks rooted. Local file only — no device needed.</p>
          {bootInfo && (
            <div className="grid grid-cols-2 gap-x-6 gap-y-1 text-xs">
              <Chip label="Type" value={bootInfo.type} tone={bootInfo.valid ? 'green' : 'red'} />
              <Chip label="Header" value={bootInfo.headerVersion ? `v${bootInfo.headerVersion}` : undefined} />
              <Chip label="Android" value={bootInfo.androidVersion} />
              <Chip label="Patch" value={bootInfo.securityPatch} />
              <Chip label="Kernel" value={bootInfo.kernelKB ? `${bootInfo.kernelKB} KB` : undefined} />
              <Chip label="Ramdisk" value={bootInfo.ramdiskKB ? `${bootInfo.ramdiskKB} KB` : undefined} />
              <Chip label="Root" value={bootInfo.root} tone={bootInfo.root.includes('none') ? undefined : 'amber'} />
              <Chip label="Size" value={`${bootInfo.sizeMB} MB`} />
              <div className="col-span-2 mt-1">
                <p className="text-[10px] text-text-muted mono break-all">SHA-256 {bootInfo.sha256}</p>
                <p className="text-[10px] text-text-muted mono break-all">SHA-1&nbsp;&nbsp;&nbsp;{bootInfo.sha1}</p>
              </div>
            </div>
          )}
        </div>

        {/* Fastboot devices */}
        <div className="card p-4 space-y-3">
          <div className="flex items-center justify-between">
            <p className="section-title">Fastboot Devices</p>
            <button onClick={refreshDevices} disabled={loadingDevices} className="btn-ghost text-xs">
              <RefreshCw size={12} className={loadingDevices ? 'animate-spin' : ''} /> Refresh
            </button>
          </div>
          {devices.length === 0 ? (
            <p className="text-text-muted text-sm text-center py-4">
              No fastboot devices. Boot to bootloader:<br />
              <span className="mono text-xs text-text-secondary">adb reboot bootloader</span>
            </p>
          ) : (
            <div className="space-y-2">
              {devices.map(d => (
                <div key={d.serial} className="flex items-center justify-between bg-bg-raised rounded px-3 py-2">
                  <span className="mono text-xs text-text-primary">{d.serial}</span>
                  <span className="badge-green">{d.status}</span>
                </div>
              ))}
            </div>
          )}
        </div>

        {/* Flash partition */}
        <div className="card p-4 space-y-3">
          <p className="section-title">Flash Partition</p>
          <div className="space-y-2">
            <div>
              <label className="text-xs text-text-muted mb-1 block">Partition</label>
              <select className="input text-xs" value={partition} onChange={e => setPartition(e.target.value)}>
                {PARTITIONS.map(p => <option key={p} value={p}>{p}</option>)}
              </select>
            </div>
            <div>
              <label className="text-xs text-text-muted mb-1 block">Image file</label>
              <div className="flex gap-2">
                <input className="input text-xs flex-1 mono" value={selectedFile} readOnly placeholder="No file selected" />
                <button onClick={handleSelectFile} className="btn-ghost text-xs shrink-0">Browse</button>
              </div>
            </div>
            <button onClick={handleFlash} disabled={flashing || !selectedFile} className="btn-danger w-full justify-center">
              <Zap size={14} /> {flashing ? 'Flashing...' : `Flash ${partition}`}
            </button>
          </div>
        </div>

        {/* Getvar */}
        <div className="card p-4 space-y-3">
          <p className="section-title">Fastboot Getvar</p>
          <div className="flex gap-2">
            <input className="input text-xs flex-1" value={getvarKey} onChange={e => setGetvarKey(e.target.value)} placeholder="all" />
            <button onClick={handleGetvar} className="btn-ghost text-xs">Query</button>
          </div>
          {getvarResult && (
            <pre className="bg-bg-raised rounded p-3 text-xs mono text-text-secondary whitespace-pre-wrap max-h-48 overflow-auto">{getvarResult}</pre>
          )}
        </div>

        {/* Sideload */}
        <div className="card p-4 space-y-3">
          <p className="section-title">ADB Sideload</p>
          <p className="text-xs text-text-muted">Sideload a ZIP (OTA update) to a device in sideload mode (recovery → Apply update from ADB).</p>
          <button onClick={handleSideload} className="btn-ghost w-full justify-center text-xs">
            <Zap size={13} /> Select ZIP and Sideload
          </button>
        </div>
      </div>
    </div>
  )
}
