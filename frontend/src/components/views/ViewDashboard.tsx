import { useState, useEffect, useCallback } from 'react'
import { RefreshCw, Wifi, WifiOff, RotateCcw, Shield, Cpu, Battery, HardDrive, Monitor } from 'lucide-react'
import {
  GetDevices, GetDeviceInfo, EnableWirelessAdb,
  ConnectWirelessAdb, DisconnectWirelessAdb, Reboot
} from '../../lib/wails'
import { notify } from '../../lib/notify'
import type { Device, DeviceInfo } from '../../lib/types'

export default function ViewDashboard() {
  const [devices, setDevices] = useState<Device[]>([])
  const [info, setInfo] = useState<DeviceInfo | null>(null)
  const [loading, setLoading] = useState(false)
  const [infoLoading, setInfoLoading] = useState(false)
  const [wirelessIp, setWirelessIp] = useState('')
  const [wirelessPort, setWirelessPort] = useState('5555')

  const refreshDevices = useCallback(async () => {
    setLoading(true)
    try {
      const devs = await GetDevices()
      setDevices(devs || [])
    } catch (e: any) {
      notify.error(e)
    } finally {
      setLoading(false)
    }
  }, [])

  const loadDeviceInfo = useCallback(async () => {
    setInfoLoading(true)
    setInfo(null)
    try {
      const i = await GetDeviceInfo()
      setInfo(i)
    } catch (e: any) {
      notify.error(e)
    } finally {
      setInfoLoading(false)
    }
  }, [])

  useEffect(() => {
    refreshDevices()
  }, [refreshDevices])

  const handleEnableWireless = async () => {
    const id = notify.loading('Enabling wireless ADB...')
    try {
      const out = await EnableWirelessAdb(wirelessPort)
      notify.dismiss(id)
      notify.success(out || 'Wireless ADB enabled')
    } catch (e: any) {
      notify.dismiss(id)
      notify.error(e)
    }
  }

  const handleConnect = async () => {
    if (!wirelessIp) { notify.error('Enter an IP address'); return }
    const id = notify.loading(`Connecting to ${wirelessIp}:${wirelessPort}...`)
    try {
      const out = await ConnectWirelessAdb(wirelessIp, wirelessPort)
      notify.dismiss(id)
      notify.success(out)
      refreshDevices()
    } catch (e: any) {
      notify.dismiss(id)
      notify.error(e)
    }
  }

  const handleDisconnect = async () => {
    if (!wirelessIp) { notify.error('Enter an IP address'); return }
    const id = notify.loading('Disconnecting...')
    try {
      const out = await DisconnectWirelessAdb(wirelessIp, wirelessPort)
      notify.dismiss(id)
      notify.success(out)
      refreshDevices()
    } catch (e: any) {
      notify.dismiss(id)
      notify.error(e)
    }
  }

  const handleReboot = async (mode: string) => {
    const label = mode || 'system'
    const id = notify.loading(`Rebooting to ${label}...`)
    try {
      await Reboot(mode)
      notify.dismiss(id)
      notify.success(`Reboot to ${label} initiated`)
    } catch (e: any) {
      notify.dismiss(id)
      notify.error(e)
    }
  }

  const connectedDevices = devices.filter(d => d.status === 'device')

  return (
    <div className="p-4 space-y-4 h-full overflow-auto">
      {/* Header */}
      <div className="flex items-center justify-between">
        <h1 className="text-base font-medium text-text-primary">Dashboard</h1>
        <button onClick={refreshDevices} disabled={loading} className="btn-ghost text-xs">
          <RefreshCw size={13} className={loading ? 'animate-spin' : ''} />
          Refresh
        </button>
      </div>

      <div className="grid grid-cols-1 xl:grid-cols-3 gap-4">
        {/* Device List */}
        <div className="card p-4 space-y-3">
          <p className="section-title">Connected Devices</p>
          {devices.length === 0 ? (
            <div className="text-center py-6">
              <p className="text-text-muted text-sm">No devices detected</p>
              <p className="text-text-muted text-xs mt-1">Connect a device with USB debugging enabled</p>
            </div>
          ) : (
            <div className="space-y-2">
              {devices.map(d => (
                <div key={d.serial} className="flex items-center justify-between bg-bg-raised rounded px-3 py-2">
                  <div>
                    <p className="mono text-text-primary text-xs">{d.serial}</p>
                    <p className="text-text-muted text-xs mt-0.5">{d.status}</p>
                  </div>
                  <span className={`status-dot ${d.status === 'device' ? 'status-dot-green' : 'status-dot-red'}`} />
                </div>
              ))}
            </div>
          )}

          {connectedDevices.length > 0 && (
            <button onClick={loadDeviceInfo} disabled={infoLoading} className="btn-ghost w-full text-xs justify-center">
              {infoLoading ? <span className="animate-spin">↻</span> : null}
              {infoLoading ? 'Loading...' : 'Load Device Info'}
            </button>
          )}
        </div>

        {/* Device Info */}
        <div className="card p-4 space-y-3 xl:col-span-2">
          <p className="section-title">Device Information</p>
          {!info && !infoLoading && (
            <div className="text-center py-6">
              <p className="text-text-muted text-sm">Select a device and click "Load Device Info"</p>
            </div>
          )}
          {infoLoading && (
            <div className="text-center py-6">
              <div className="w-6 h-6 border-2 border-accent-green border-t-transparent rounded-full animate-spin mx-auto mb-2" />
              <p className="text-text-muted text-sm">Fetching device details...</p>
            </div>
          )}
          {info && (
            <div className="grid grid-cols-2 gap-x-6 gap-y-2">
              {[
                { label: 'Model',           value: `${info.brand} ${info.model}` },
                { label: 'Codename',        value: info.codename },
                { label: 'Android',         value: info.androidVersion },
                { label: 'Build',           value: info.buildNumber },
                { label: 'Serial',          value: info.serial,          mono: true },
                { label: 'CPU Arch',        value: info.cpuArch },
                { label: 'RAM',             value: info.ramTotal,        icon: <Cpu size={12} /> },
                { label: 'Storage',         value: info.storageInfo,     icon: <HardDrive size={12} /> },
                { label: 'Battery',         value: info.batteryLevel,    icon: <Battery size={12} /> },
                { label: 'Screen',          value: info.screenResolution,icon: <Monitor size={12} /> },
                { label: 'IP Address',      value: info.ipAddress },
                { label: 'Uptime',          value: info.uptime },
                { label: 'Root',            value: info.rootStatus,      icon: <Shield size={12} /> },
                { label: 'Bootloader',      value: info.bootloaderStatus },
                { label: 'Security Patch',  value: info.securityPatch },
                { label: 'Kernel',          value: info.kernelVersion,   mono: true },
                { label: 'Baseband',        value: info.basebandVersion, mono: true },
              ].map(({ label, value, mono, icon }) => (
                <div key={label} className="flex items-start gap-2 min-w-0">
                  <span className="text-text-muted text-xs w-28 shrink-0 pt-0.5">{label}</span>
                  <span className={`text-xs text-text-primary truncate flex items-center gap-1 ${mono ? 'font-mono' : ''}`}>
                    {icon && <span className="text-text-muted">{icon}</span>}
                    {value || 'N/A'}
                  </span>
                </div>
              ))}
            </div>
          )}
        </div>
      </div>

      <div className="grid grid-cols-1 xl:grid-cols-2 gap-4">
        {/* Wireless ADB */}
        <div className="card p-4 space-y-3">
          <p className="section-title">Wireless ADB</p>
          <div className="space-y-2">
            <div className="flex gap-2">
              <input
                className="input"
                placeholder="192.168.1.x"
                value={wirelessIp}
                onChange={e => setWirelessIp(e.target.value)}
              />
              <input
                className="input w-24 shrink-0"
                placeholder="5555"
                value={wirelessPort}
                onChange={e => setWirelessPort(e.target.value)}
              />
            </div>
            <div className="flex gap-2">
              <button onClick={handleEnableWireless} className="btn-ghost flex-1 justify-center text-xs">
                <Wifi size={13} /> Enable TCP/IP
              </button>
              <button onClick={handleConnect} className="btn-primary flex-1 justify-center text-xs">
                <Wifi size={13} /> Connect
              </button>
              <button onClick={handleDisconnect} className="btn-ghost flex-1 justify-center text-xs">
                <WifiOff size={13} /> Disconnect
              </button>
            </div>
          </div>
        </div>

        {/* Reboot */}
        <div className="card p-4 space-y-3">
          <p className="section-title">Reboot Options</p>
          <div className="grid grid-cols-2 gap-2">
            {[
              { label: 'System',     mode: '',           cls: 'btn-ghost' },
              { label: 'Recovery',   mode: 'recovery',   cls: 'btn-warn' },
              { label: 'Bootloader', mode: 'bootloader', cls: 'btn-warn' },
              { label: 'Fastboot',   mode: 'fastboot',   cls: 'btn-ghost' },
            ].map(({ label, mode, cls }) => (
              <button
                key={label}
                onClick={() => handleReboot(mode)}
                className={`${cls} justify-center text-xs`}
              >
                <RotateCcw size={13} /> {label}
              </button>
            ))}
          </div>
        </div>
      </div>
    </div>
  )
}
