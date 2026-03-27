import { useState, useRef } from 'react'
import { Zap, AlertTriangle, FolderOpen, Check, X, RefreshCw, ChevronDown, ChevronRight } from 'lucide-react'
import { GetFastbootDevices, Reboot } from '../../lib/wails'
import { notify } from '../../lib/notify'
import type { Device } from '../../lib/types'

type StepStatus = 'waiting' | 'running' | 'done' | 'error' | 'skipped'

interface FlashStep {
  id: string
  label: string
  description: string
  status: StepStatus
  output?: string
}

interface FlashOptions {
  wipeData: boolean
  disableVerity: boolean
  disableVerification: boolean
  force: boolean
  flashBothSlots: boolean
}

const DEFAULT_OPTS: FlashOptions = {
  wipeData: true,
  disableVerity: false,
  disableVerification: false,
  force: false,
  flashBothSlots: false,
}

// Parse flash-all.sh lines into structured steps
interface ParsedStep {
  type: 'flash' | 'reboot' | 'update' | 'sleep'
  partition?: string
  file?: string
  wipe?: boolean
}

function parseFlashAllSh(content: string): ParsedStep[] {
  const steps: ParsedStep[] = []
  for (const raw of content.split('\n')) {
    const line = raw.trim()
    if (!line || line.startsWith('#') || line.startsWith('#!/')) continue
    if (!line.startsWith('fastboot')) continue
    const parts = line.split(/\s+/)
    if (parts[1] === 'flash' && parts[2] && parts[3]) {
      steps.push({ type: 'flash', partition: parts[2], file: parts[3] })
    } else if (parts[1] === 'reboot-bootloader') {
      steps.push({ type: 'reboot' })
    } else if (parts[1] === '-w' && parts[2] === 'update') {
      steps.push({ type: 'update', wipe: true, file: parts[3] })
    } else if (parts[1] === 'update') {
      steps.push({ type: 'update', wipe: false, file: parts[2] })
    }
  }
  return steps
}

function buildSteps(parsed: ParsedStep[], opts: FlashOptions): FlashStep[] {
  const steps: FlashStep[] = []
  let rebootCount = 0

  for (const p of parsed) {
    if (p.type === 'flash') {
      const flags: string[] = []
      if (opts.disableVerity) flags.push('--disable-verity')
      if (opts.disableVerification) flags.push('--disable-verification')
      if (opts.force) flags.push('--force')
      if (opts.flashBothSlots) flags.push('--slot all')
      const flagStr = flags.length ? flags.join(' ') + ' ' : ''
      steps.push({
        id: `flash_${p.partition}_${steps.length}`,
        label: `Flash ${p.partition}`,
        description: `fastboot ${flagStr}flash ${p.partition} ${p.file}`,
        status: 'waiting',
      })
    } else if (p.type === 'reboot') {
      rebootCount++
      steps.push({
        id: `reboot_${rebootCount}`,
        label: 'Reboot to bootloader',
        description: 'fastboot reboot-bootloader',
        status: 'waiting',
      })
    } else if (p.type === 'update') {
      const flags: string[] = []
      if (opts.disableVerity) flags.push('--disable-verity')
      if (opts.disableVerification) flags.push('--disable-verification')
      if (opts.force) flags.push('--force')
      const wipeFlag = opts.wipeData ? '-w ' : ''
      const flagStr = flags.length ? flags.join(' ') + ' ' : ''
      steps.push({
        id: 'update_image',
        label: opts.wipeData ? 'Flash image zip (wipe data)' : 'Flash image zip',
        description: `fastboot ${flagStr}${wipeFlag}update ${p.file}`,
        status: 'waiting',
      })
    }
  }

  steps.push({
    id: 'reboot_system',
    label: 'Reboot to system',
    description: 'fastboot reboot',
    status: 'waiting',
  })

  return steps
}

export default function ViewPixelFlasher() {
  const [devices, setDevices]         = useState<Device[]>([])
  const [loadingDevices, setLoading]  = useState(false)
  const [factoryZip, setFactoryZip]   = useState('')
  const [opts, setOpts]               = useState<FlashOptions>(DEFAULT_OPTS)
  const [parsedSteps, setParsedSteps] = useState<ParsedStep[]>([])
  const [steps, setSteps]             = useState<FlashStep[]>([])
  const [flashing, setFlashing]       = useState(false)
  const [done, setDone]               = useState(false)
  const [showAdvanced, setShowAdvanced] = useState(false)
  const [log, setLog]                 = useState<string[]>([])
  const logRef                        = useRef<HTMLDivElement>(null)

  const addLog = (msg: string) => {
    setLog(prev => [...prev, `${new Date().toLocaleTimeString()} ${msg}`])
    setTimeout(() => logRef.current?.scrollTo(0, logRef.current.scrollHeight), 50)
  }

  const updateStep = (id: string, status: StepStatus, output?: string) =>
    setSteps(prev => prev.map(s => s.id === id ? { ...s, status, output } : s))

  const refreshDevices = async () => {
    setLoading(true)
    try {
      const devs = await GetFastbootDevices()
      setDevices(devs || [])
    } catch (e: any) {
      notify.error(e)
    } finally {
      setLoading(false)
    }
  }

  const handleSelectZip = async () => {
    try {
      // @ts-ignore
      const path: string = await window['go']['main']['App']['SelectFileForFlash']()
      if (!path) return
      setFactoryZip(path)
      setSteps([])
      setParsedSteps([])
      setLog([])
      setDone(false)
      // Read flash-all.sh from inside the zip using Go backend
      try {
        // @ts-ignore
        const content: string = await window['go']['main']['App']['ReadFileFromZip'](path, 'flash-all.sh')
        if (content) {
          const parsed = parseFlashAllSh(content)
          setParsedSteps(parsed)
          setSteps(buildSteps(parsed, opts))
          addLog(`Parsed flash-all.sh: ${parsed.length} steps found`)
        } else {
          addLog('Warning: flash-all.sh not found in zip — is this a valid Pixel factory image?')
        }
      } catch {
        addLog('Could not read flash-all.sh from zip. Make sure this is an extracted factory image folder or valid zip.')
      }
    } catch (e: any) {
      notify.error('Could not open file dialog')
    }
  }

  const updateOpts = (newOpts: FlashOptions) => {
    setOpts(newOpts)
    if (parsedSteps.length > 0) {
      setSteps(buildSteps(parsedSteps, newOpts))
    }
  }

  const runFastboot = async (args: string): Promise<string> => {
    // @ts-ignore
    return await window['go']['main']['App']['RunAdbHostCommand']('fastboot ' + args) as string
  }

  const sleep = (ms: number) => new Promise(r => setTimeout(r, ms))

  const waitForFastboot = async (timeoutMs = 45000): Promise<boolean> => {
    const start = Date.now()
    while (Date.now() - start < timeoutMs) {
      try {
        const devs = await GetFastbootDevices()
        if (devs && devs.length > 0) return true
      } catch {}
      await sleep(2000)
    }
    return false
  }

  const startFlash = async () => {
    if (!factoryZip) { notify.error('Select a factory image zip first'); return }
    if (devices.length === 0) { notify.error('No fastboot device detected — boot to bootloader first'); return }
    if (parsedSteps.length === 0) { notify.error('No flash steps parsed — check the factory image zip'); return }

    const flags: string[] = []
    if (opts.disableVerity) flags.push('--disable-verity')
    if (opts.disableVerification) flags.push('--disable-verification')
    if (opts.force) flags.push('--force')
    if (opts.flashBothSlots) flags.push('--slot all')
    const flagSummary = flags.length ? flags.join(' ') : 'none'

    if (!confirm(
      `Flash Pixel factory image?\n\n` +
      `File: ${factoryZip}\n` +
      `Wipe userdata: ${opts.wipeData ? 'YES — all data erased' : 'No'}\n` +
      `Extra flags: ${flagSummary}\n\n` +
      `This is irreversible. Confirm you have the correct image for your device.`
    )) return

    const freshSteps = buildSteps(parsedSteps, opts)
    setSteps(freshSteps)
    setLog([])
    setFlashing(true)
    setDone(false)

    // Extract zip directory for file references
    const zipDir = factoryZip.substring(0, factoryZip.lastIndexOf('/'))

    try {
      for (const step of freshSteps) {
        updateStep(step.id, 'running')
        addLog(`→ ${step.description}`)

        if (step.id === 'reboot_system') {
          try {
            await runFastboot('reboot')
            addLog('Device rebooting to system...')
            updateStep(step.id, 'done')
          } catch (e: any) {
            updateStep(step.id, 'error', String(e))
            addLog(`ERROR: ${e}`)
          }
          continue
        }

        if (step.id.startsWith('reboot_')) {
          try {
            await runFastboot('reboot-bootloader')
            addLog('Waiting for device to return to fastboot...')
            await sleep(5000)
            const back = await waitForFastboot()
            if (!back) throw new Error('Device did not return to fastboot within 45s')
            addLog('Device back in fastboot')
            updateStep(step.id, 'done')
          } catch (e: any) {
            updateStep(step.id, 'error', String(e))
            addLog(`ERROR: ${e}`)
            setFlashing(false)
            return
          }
          continue
        }

        if (step.id === 'update_image') {
          // fastboot update uses the image-*.zip inside the factory zip
          // The file path in flash-all.sh is relative — resolve against zip dir
          const parsed = parsedSteps.find(p => p.type === 'update')
          const imageZipName = parsed?.file || ''
          const imageZipPath = `${zipDir}/${imageZipName}`
          const flags2: string[] = []
          if (opts.disableVerity) flags2.push('--disable-verity')
          if (opts.disableVerification) flags2.push('--disable-verification')
          if (opts.force) flags2.push('--force')
          const wipeFlag = opts.wipeData ? '-w ' : ''
          const flagStr = flags2.length ? flags2.join(' ') + ' ' : ''
          const cmd = `${flagStr}${wipeFlag}update ${imageZipPath}`
          try {
            const out = await runFastboot(cmd)
            addLog(out || 'Image flashed')
            updateStep(step.id, 'done', out)
          } catch (e: any) {
            updateStep(step.id, 'error', String(e))
            addLog(`ERROR: ${e}`)
            setFlashing(false)
            return
          }
          continue
        }

        // Regular flash step
        if (step.id.startsWith('flash_')) {
          const parsed = parsedSteps.find(p => p.type === 'flash' &&
            step.label === `Flash ${p.partition}`)
          const fileName = parsed?.file || ''
          const filePath = `${zipDir}/${fileName}`
          const flags2: string[] = []
          if (opts.disableVerity) flags2.push('--disable-verity')
          if (opts.disableVerification) flags2.push('--disable-verification')
          if (opts.force) flags2.push('--force')
          if (opts.flashBothSlots) flags2.push('--slot all')
          const flagStr = flags2.length ? flags2.join(' ') + ' ' : ''
          const partition = parsed?.partition || ''
          const cmd = `${flagStr}flash ${partition} ${filePath}`
          try {
            const out = await runFastboot(cmd)
            addLog(out || `${partition} flashed`)
            updateStep(step.id, 'done', out)
          } catch (e: any) {
            // Some partitions may not exist on all devices — skip with warning
            addLog(`WARN: ${partition}: ${e} — skipping`)
            updateStep(step.id, 'skipped', String(e))
          }
          continue
        }
      }

      addLog('✓ Flash complete!')
      setDone(true)
      notify.success('Flash complete — device is rebooting')
    } catch (e: any) {
      addLog(`FATAL: ${e}`)
      notify.error(`Flash failed: ${e}`)
    } finally {
      setFlashing(false)
    }
  }

  const statusIcon = (s: StepStatus) => {
    switch (s) {
      case 'done':    return <Check size={13} className="text-accent-green" />
      case 'error':   return <X size={13} className="text-danger" />
      case 'skipped': return <span className="text-text-muted text-xs font-mono">—</span>
      case 'running': return <div className="w-3 h-3 border border-accent-green border-t-transparent rounded-full animate-spin" />
      default:        return <div className="w-3 h-3 rounded-full border border-bg-border" />
    }
  }

  return (
    <div className="flex flex-col h-full overflow-auto p-4 space-y-4">
      <h1 className="text-base font-medium text-text-primary">Pixel Factory Flash</h1>

      {/* Warning */}
      <div className="flex items-start gap-3 bg-danger/5 border border-danger/20 rounded-lg px-4 py-3 shrink-0">
        <AlertTriangle size={16} className="text-danger shrink-0 mt-0.5" />
        <div className="text-xs text-danger/90 space-y-1">
          <p className="font-medium">This will completely overwrite your device firmware.</p>
          <p className="text-danger/70">
            Download the correct factory image for your Pixel from{' '}
            <span className="mono">developers.google.com/android/images</span>.
            Extract the outer zip first — then select the inner factory zip (e.g.{' '}
            <span className="mono">cheetah-ap2a.240905.003-factory-*.zip</span>).
            Bootloader must be unlocked.
          </p>
        </div>
      </div>

      <div className="grid grid-cols-1 xl:grid-cols-2 gap-4">
        {/* Left: config */}
        <div className="space-y-4">
          {/* Device */}
          <div className="card p-4 space-y-3">
            <div className="flex items-center justify-between">
              <p className="section-title">Fastboot Device</p>
              <button onClick={refreshDevices} disabled={loadingDevices} className="btn-ghost text-xs">
                <RefreshCw size={11} className={loadingDevices ? 'animate-spin' : ''} /> Refresh
              </button>
            </div>
            {devices.length === 0 ? (
              <p className="text-xs text-text-muted bg-bg-raised rounded px-3 py-2">
                No device in fastboot — run: <span className="mono">adb reboot bootloader</span>
              </p>
            ) : (
              <div className="bg-bg-raised rounded px-3 py-2 mono text-xs text-accent-green">
                {devices[0].serial} — {devices[0].status}
              </div>
            )}
          </div>

          {/* Factory image */}
          <div className="card p-4 space-y-3">
            <p className="section-title">Factory Image Zip</p>
            <p className="text-xs text-text-muted">
              Extract the outer zip from Google, then select the inner <span className="mono">device-build-factory-*.zip</span>
            </p>
            <div className="flex gap-2">
              <input
                className="input text-xs flex-1 mono"
                value={factoryZip}
                readOnly
                placeholder="Select factory image zip..."
              />
              <button onClick={handleSelectZip} className="btn-ghost text-xs shrink-0">
                <FolderOpen size={13} /> Browse
              </button>
            </div>
            {parsedSteps.length > 0 && (
              <p className="text-xs text-accent-green flex items-center gap-1.5">
                <Check size={12} /> flash-all.sh parsed — {parsedSteps.length} steps detected
              </p>
            )}
          </div>

          {/* Flash options */}
          <div className="card p-4 space-y-3">
            <p className="section-title">Flash Options</p>

            <label className="flex items-start gap-3 cursor-pointer">
              <input type="checkbox" checked={opts.wipeData}
                onChange={e => updateOpts({ ...opts, wipeData: e.target.checked })}
                className="accent-accent-green mt-0.5" />
              <div>
                <p className="text-xs text-text-primary">Wipe userdata <span className="badge-red ml-1">Recommended for bug hunting</span></p>
                <p className="text-xs text-text-muted">Adds <span className="mono">-w</span> to fastboot update — clean state</p>
              </div>
            </label>

            {/* Advanced toggle */}
            <button
              onClick={() => setShowAdvanced(v => !v)}
              className="flex items-center gap-1.5 text-xs text-text-muted hover:text-text-secondary transition-colors"
            >
              {showAdvanced ? <ChevronDown size={12} /> : <ChevronRight size={12} />}
              Advanced options
            </button>

            {showAdvanced && (
              <div className="space-y-2 pl-2 border-l border-bg-border">
                <label className="flex items-start gap-3 cursor-pointer">
                  <input type="checkbox" checked={opts.disableVerity}
                    onChange={e => updateOpts({ ...opts, disableVerity: e.target.checked })}
                    className="accent-accent-green mt-0.5" />
                  <div>
                    <p className="text-xs text-text-primary">Disable verity <span className="badge-yellow ml-1">For Magisk/root</span></p>
                    <p className="text-xs text-text-muted">Adds <span className="mono">--disable-verity</span> to all flash commands</p>
                  </div>
                </label>

                <label className="flex items-start gap-3 cursor-pointer">
                  <input type="checkbox" checked={opts.disableVerification}
                    onChange={e => updateOpts({ ...opts, disableVerification: e.target.checked })}
                    className="accent-accent-green mt-0.5" />
                  <div>
                    <p className="text-xs text-text-primary">Disable verification <span className="badge-yellow ml-1">For Magisk/root</span></p>
                    <p className="text-xs text-text-muted">Adds <span className="mono">--disable-verification</span> — usually paired with disable verity</p>
                  </div>
                </label>

                <label className="flex items-start gap-3 cursor-pointer">
                  <input type="checkbox" checked={opts.force}
                    onChange={e => updateOpts({ ...opts, force: e.target.checked })}
                    className="accent-accent-green mt-0.5" />
                  <div>
                    <p className="text-xs text-text-primary">Force flash <span className="badge-red ml-1">Dangerous</span></p>
                    <p className="text-xs text-text-muted">
                      Adds <span className="mono">--force</span> — bypasses anti-rollback protection.
                      Use only when downgrading. Can brick if used incorrectly.
                    </p>
                  </div>
                </label>

                <label className="flex items-start gap-3 cursor-pointer">
                  <input type="checkbox" checked={opts.flashBothSlots}
                    onChange={e => updateOpts({ ...opts, flashBothSlots: e.target.checked })}
                    className="accent-accent-green mt-0.5" />
                  <div>
                    <p className="text-xs text-text-primary">Flash both slots <span className="badge-yellow ml-1">A/B devices</span></p>
                    <p className="text-xs text-text-muted">Adds <span className="mono">--slot all</span> — flashes both A and B slots</p>
                  </div>
                </label>
              </div>
            )}

            {/* Command preview */}
            {parsedSteps.length > 0 && (
              <div className="bg-bg-base rounded p-2 border border-bg-border">
                <p className="text-xs text-text-muted mb-1">Command preview:</p>
                {(() => {
                  const flags: string[] = []
                  if (opts.disableVerity) flags.push('--disable-verity')
                  if (opts.disableVerification) flags.push('--disable-verification')
                  if (opts.force) flags.push('--force')
                  const flagStr = flags.length ? flags.join(' ') + ' ' : ''
                  const wipe = opts.wipeData ? '-w ' : ''
                  return (
                    <p className="mono text-xs text-accent-green break-all">
                      fastboot {flagStr}flash bootloader bootloader-*.img<br/>
                      fastboot reboot-bootloader<br/>
                      fastboot {flagStr}flash radio radio-*.img<br/>
                      fastboot reboot-bootloader<br/>
                      fastboot {flagStr}{wipe}update image-*.zip
                    </p>
                  )
                })()}
              </div>
            )}

            <button
              onClick={startFlash}
              disabled={flashing || !factoryZip || devices.length === 0 || parsedSteps.length === 0}
              className="btn-danger w-full justify-center"
            >
              <Zap size={14} />
              {flashing ? 'Flashing...' : 'Start Flash'}
            </button>

            {done && (
              <div className="flex items-center gap-2 text-accent-green text-xs bg-accent-green/10 rounded px-3 py-2">
                <Check size={13} /> Flash complete — device rebooting
              </div>
            )}
          </div>
        </div>

        {/* Right: steps + log */}
        <div className="space-y-4">
          {/* Steps */}
          <div className="card p-4 space-y-2">
            <p className="section-title">
              Flash Steps {steps.length > 0 ? `(${steps.length})` : '— select a factory zip to populate'}
            </p>
            {steps.length === 0 && (
              <p className="text-xs text-text-muted text-center py-4">
                Select a factory image zip to see the flash sequence
              </p>
            )}
            <div className="space-y-1 max-h-80 overflow-auto">
              {steps.map(step => (
                <div
                  key={step.id}
                  className={`flex items-start gap-3 px-3 py-2 rounded transition-colors ${
                    step.status === 'running' ? 'bg-accent-green/5 border border-accent-green/20' :
                    step.status === 'error'   ? 'bg-danger/5 border border-danger/20' :
                    step.status === 'done'    ? 'bg-bg-raised' : ''
                  }`}
                >
                  <div className="mt-0.5 shrink-0">{statusIcon(step.status)}</div>
                  <div className="flex-1 min-w-0">
                    <p className={`text-xs font-medium ${
                      step.status === 'running' ? 'text-accent-green' :
                      step.status === 'error'   ? 'text-danger' :
                      step.status === 'done'    ? 'text-text-primary' : 'text-text-muted'
                    }`}>
                      {step.label}
                    </p>
                    <p className="mono text-xs text-text-muted truncate">{step.description}</p>
                    {step.output && step.status === 'error' && (
                      <p className="mono text-xs text-danger mt-0.5 truncate">{step.output}</p>
                    )}
                  </div>
                </div>
              ))}
            </div>
          </div>

          {/* Log */}
          {log.length > 0 && (
            <div className="card p-4 space-y-2">
              <p className="section-title">Flash Log</p>
              <div
                ref={logRef}
                className="bg-bg-base rounded p-3 h-48 overflow-auto mono text-xs space-y-0.5 border border-bg-border"
              >
                {log.map((line, i) => (
                  <div key={i} className={
                    line.includes('ERROR') || line.includes('FATAL') ? 'text-danger' :
                    line.includes('WARN') ? 'text-warn' :
                    line.includes('✓') ? 'text-accent-green' :
                    'text-text-secondary'
                  }>
                    {line}
                  </div>
                ))}
              </div>
            </div>
          )}
        </div>
      </div>
    </div>
  )
}
