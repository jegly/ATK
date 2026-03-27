import { useState, useCallback } from 'react'
import { Zap, RefreshCw, AlertTriangle } from 'lucide-react'
import { GetFastbootDevices, FlashPartition, FastbootGetVar, SelectFileForFlash, SideloadPackage, SelectFileForInstall } from '../../lib/wails'
import { notify } from '../../lib/notify'
import type { Device } from '../../lib/types'

const PARTITIONS = [
  'boot', 'recovery', 'system', 'vendor', 'userdata',
  'dtbo', 'vbmeta', 'super', 'product', 'odm', 'radio'
]

export default function ViewFlasher() {
  const [devices, setDevices] = useState<Device[]>([])
  const [loadingDevices, setLoadingDevices] = useState(false)
  const [partition, setPartition] = useState('boot')
  const [selectedFile, setSelectedFile] = useState('')
  const [flashing, setFlashing] = useState(false)
  const [getvarKey, setGetvarKey] = useState('all')
  const [getvarResult, setGetvarResult] = useState('')

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
    if (!confirm(`Flash ${selectedFile} to ${partition}?\n\nThis will overwrite the ${partition} partition. Make sure you know what you're doing.`)) return

    setFlashing(true)
    const id = notify.loading(`Flashing ${partition}...`)
    try {
      const out = await FlashPartition(partition, selectedFile)
      notify.dismiss(id)
      notify.success(out || `${partition} flashed successfully`)
    } catch (e: any) {
      notify.dismiss(id)
      notify.error(e)
    } finally {
      setFlashing(false)
    }
  }

  const handleGetvar = async () => {
    try {
      const out = await FastbootGetVar(getvarKey)
      setGetvarResult(out)
    } catch (e: any) {
      setGetvarResult(String(e))
    }
  }

  const handleSideload = async () => {
    const path = await SelectFileForInstall()
    if (!path) return
    if (!confirm('Sideload requires device to be in sideload mode (adb sideload). Continue?')) return
    const id = notify.loading('Sideloading...')
    try {
      const out = await SideloadPackage(path)
      notify.dismiss(id)
      notify.success(out || 'Sideload complete')
    } catch (e: any) {
      notify.dismiss(id)
      notify.error(e)
    }
  }

  return (
    <div className="p-4 space-y-4 h-full overflow-auto">
      <h1 className="text-base font-medium text-text-primary">Flasher</h1>

      {/* Warning */}
      <div className="flex items-start gap-3 bg-warn/5 border border-warn/20 rounded-lg px-4 py-3">
        <AlertTriangle size={16} className="text-warn shrink-0 mt-0.5" />
        <div className="text-xs text-warn/90">
          <p className="font-medium mb-1">Fastboot operations are destructive and irreversible.</p>
          <p className="text-warn/70">Wrong partition or wrong image = bricked device. Only partition names in the safe list are permitted. Make sure your device bootloader is unlocked before flashing.</p>
        </div>
      </div>

      <div className="grid grid-cols-1 xl:grid-cols-2 gap-4">
        {/* Fastboot devices */}
        <div className="card p-4 space-y-3">
          <div className="flex items-center justify-between">
            <p className="section-title">Fastboot Devices</p>
            <button onClick={refreshDevices} disabled={loadingDevices} className="btn-ghost text-xs">
              <RefreshCw size={12} className={loadingDevices ? 'animate-spin' : ''} />
              Refresh
            </button>
          </div>
          {devices.length === 0 ? (
            <p className="text-text-muted text-sm text-center py-4">
              No fastboot devices. Boot device to bootloader with:<br />
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
              <select
                className="input text-xs"
                value={partition}
                onChange={e => setPartition(e.target.value)}
              >
                {PARTITIONS.map(p => (
                  <option key={p} value={p}>{p}</option>
                ))}
              </select>
            </div>
            <div>
              <label className="text-xs text-text-muted mb-1 block">Image file</label>
              <div className="flex gap-2">
                <input
                  className="input text-xs flex-1 mono"
                  value={selectedFile}
                  readOnly
                  placeholder="No file selected"
                />
                <button onClick={handleSelectFile} className="btn-ghost text-xs shrink-0">Browse</button>
              </div>
            </div>
            <button
              onClick={handleFlash}
              disabled={flashing || !selectedFile || devices.length === 0}
              className="btn-danger w-full justify-center"
            >
              <Zap size={14} />
              {flashing ? 'Flashing...' : `Flash ${partition}`}
            </button>
            {devices.length === 0 && (
              <p className="text-text-muted text-xs text-center">Connect a device in fastboot mode to flash</p>
            )}
          </div>
        </div>

        {/* Getvar */}
        <div className="card p-4 space-y-3">
          <p className="section-title">Fastboot Getvar</p>
          <div className="flex gap-2">
            <input
              className="input text-xs flex-1"
              value={getvarKey}
              onChange={e => setGetvarKey(e.target.value)}
              placeholder="all"
            />
            <button onClick={handleGetvar} className="btn-ghost text-xs">Query</button>
          </div>
          {getvarResult && (
            <pre className="bg-bg-raised rounded p-3 text-xs mono text-text-secondary whitespace-pre-wrap max-h-48 overflow-auto">
              {getvarResult}
            </pre>
          )}
        </div>

        {/* Sideload */}
        <div className="card p-4 space-y-3">
          <p className="section-title">ADB Sideload</p>
          <p className="text-xs text-text-muted">
            Sideload a ZIP (OTA update) to a device in sideload mode. Boot to recovery then select "Apply update from ADB".
          </p>
          <button onClick={handleSideload} className="btn-ghost w-full justify-center text-xs">
            <Zap size={13} /> Select ZIP and Sideload
          </button>
        </div>
      </div>
    </div>
  )
}
