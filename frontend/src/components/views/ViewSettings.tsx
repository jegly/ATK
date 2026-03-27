import { useState, useEffect } from 'react'
import { Shield, RefreshCw, Check, AlertTriangle } from 'lucide-react'
import { GetBinaryInfo, SetAdbPath, SetFastbootPath } from '../../lib/wails'
import { notify } from '../../lib/notify'

export default function ViewSettings() {
  const [binaryInfo, setBinaryInfo] = useState<Record<string, string>>({})
  const [loading, setLoading] = useState(false)
  const [adbPath, setAdbPath] = useState('')
  const [fastbootPath, setFastbootPath] = useState('')

  const loadBinaryInfo = async () => {
    setLoading(true)
    try {
      const info = await GetBinaryInfo()
      setBinaryInfo(info)
    } catch (e: any) {
      notify.error(e)
    } finally {
      setLoading(false)
    }
  }

  useEffect(() => { loadBinaryInfo() }, [])

  const handleSetAdb = async () => {
    try {
      await SetAdbPath(adbPath)
      notify.success('ADB path updated')
      loadBinaryInfo()
    } catch (e: any) {
      notify.error(e)
    }
  }

  const handleSetFastboot = async () => {
    try {
      await SetFastbootPath(fastbootPath)
      notify.success('Fastboot path updated')
      loadBinaryInfo()
    } catch (e: any) {
      notify.error(e)
    }
  }

  return (
    <div className="p-4 space-y-4 h-full overflow-auto max-w-2xl">
      <h1 className="text-base font-medium text-text-primary">Settings</h1>

      {/* Binary trust section */}
      <div className="card p-4 space-y-4">
        <div className="flex items-center justify-between">
          <div className="flex items-center gap-2">
            <Shield size={14} className="text-accent-green" />
            <p className="section-title">Binary Verification</p>
          </div>
          <button onClick={loadBinaryInfo} disabled={loading} className="btn-ghost text-xs">
            <RefreshCw size={12} className={loading ? 'animate-spin' : ''} />
            Refresh
          </button>
        </div>

        <div className="bg-accent-green/5 border border-accent-green/20 rounded p-3 text-xs text-text-secondary space-y-1">
          <p className="text-accent-green font-medium flex items-center gap-1.5">
            <Check size={12} /> ATK uses YOUR system ADB/Fastboot — no bundled binaries
          </p>
          <p>
            By default ATK uses whatever <span className="mono">adb</span> and <span className="mono">fastboot</span> are on your PATH (installed via <span className="mono">apt install adb fastboot</span> or Android SDK). You can verify the SHA-256 hashes below against Google's published platform-tools checksums.
          </p>
        </div>

        {/* Binary info display */}
        {Object.entries(binaryInfo).map(([name, info]) => (
          <div key={name} className="space-y-1">
            <p className="text-xs font-medium text-text-secondary uppercase tracking-wide">{name}</p>
            <pre className="bg-bg-raised rounded p-3 text-xs mono text-text-muted whitespace-pre-wrap break-all border border-bg-border">
              {info}
            </pre>
          </div>
        ))}

        <div className="text-xs text-text-muted space-y-1">
          <p className="flex items-center gap-1.5">
            <AlertTriangle size={11} className="text-warn shrink-0" />
            Verify SHA-256 against Google's official platform-tools:
          </p>
          <p className="mono pl-4">https://developer.android.com/tools/releases/platform-tools</p>
        </div>
      </div>

      {/* Custom binary paths */}
      <div className="card p-4 space-y-4">
        <p className="section-title">Custom Binary Paths</p>
        <p className="text-xs text-text-muted">
          Override the auto-detected binary paths. Leave empty to use system PATH. Changes take effect immediately.
        </p>

        <div className="space-y-3">
          <div>
            <label className="text-xs text-text-muted mb-1.5 block">ADB binary path</label>
            <div className="flex gap-2">
              <input
                className="input text-xs flex-1 mono"
                placeholder="/usr/bin/adb  (or leave blank for auto-detect)"
                value={adbPath}
                onChange={e => setAdbPath(e.target.value)}
              />
              <button onClick={handleSetAdb} disabled={!adbPath} className="btn-ghost text-xs shrink-0">
                Set
              </button>
            </div>
          </div>

          <div>
            <label className="text-xs text-text-muted mb-1.5 block">Fastboot binary path</label>
            <div className="flex gap-2">
              <input
                className="input text-xs flex-1 mono"
                placeholder="/usr/bin/fastboot  (or leave blank for auto-detect)"
                value={fastbootPath}
                onChange={e => setFastbootPath(e.target.value)}
              />
              <button onClick={handleSetFastboot} disabled={!fastbootPath} className="btn-ghost text-xs shrink-0">
                Set
              </button>
            </div>
          </div>
        </div>
      </div>

      {/* About */}
      <div className="card p-4 space-y-2">
        <p className="section-title">About</p>
        <div className="text-xs text-text-muted space-y-1">
          <p>ATK (Android Toolkit) — an all-in-one ADB GUI for Android power users and bug hunters</p>
          <p>All commands use discrete argument passing — no shell string building, no injection vectors</p>
          <p>Built with Wails v2 (Go + React) · github.com/jegly/ATK</p>
        </div>
      </div>
    </div>
  )
}
