import { useState, useEffect } from 'react'
import { Shield, RefreshCw, Check, AlertTriangle, Palette, Lock } from 'lucide-react'
import { GetBinaryInfo, SetAdbPath, SetFastbootPath, AppLockStatus, SetAppPassword, DisableAppLock, SetRequireForDanger } from '../../lib/wails'
import { notify } from '../../lib/notify'
import { refreshAppLockStatus } from '../../lib/applock'
import { applyTheme, getTheme, THEMES, type Theme } from '../../lib/theme'
import { getCustomAccent, setCustomAccent, getCustomFont, setCustomFont, FONT_OPTIONS } from '../../lib/appearance'
import { getSidebarPosition, setSidebarPosition, SIDEBAR_POSITIONS, getSidebarLabels, setSidebarLabels, type SidebarPosition } from '../../lib/layout'
import { getRootTools, setRootTools, getHiddenViews, setHiddenViews, TOGGLEABLE_VIEWS, getMuteNoDevice, setMuteNoDevice } from '../../lib/featureflags'
import { resetDismissed } from '../../lib/dismissible'

export default function ViewSettings() {
  const [binaryInfo, setBinaryInfo] = useState<Record<string, string>>({})
  const [loading, setLoading] = useState(false)
  const [adbPath, setAdbPath] = useState('')
  const [fastbootPath, setFastbootPath] = useState('')
  const [theme, setTheme] = useState<Theme>(getTheme())
  const [sidebarPos, setSidebarPos] = useState<SidebarPosition>(getSidebarPosition())
  const [sidebarLabels, setSidebarLabelsState] = useState<boolean>(getSidebarLabels())
  const [rootTools, setRootToolsState] = useState<boolean>(getRootTools())

  const [customAccent, setCustomAccentState] = useState<string>(getCustomAccent())
  const [customFont, setCustomFontState] = useState<string>(getCustomFont())

  const changeTheme = (t: Theme) => { setTheme(t); applyTheme(t) }
  const changeAccent = (hex: string | null) => { setCustomAccentState(hex || ''); setCustomAccent(hex) }
  const changeFont = (id: string) => { setCustomFontState(id); setCustomFont(id || null) }
  const changeSidebarPos = (p: SidebarPosition) => { setSidebarPos(p); setSidebarPosition(p) }
  const changeSidebarLabels = (on: boolean) => { setSidebarLabelsState(on); setSidebarLabels(on) }
  const changeRootTools = (on: boolean) => { setRootToolsState(on); setRootTools(on) }

  // App lock
  const [lock, setLock] = useState({ enabled: false, requireForDanger: false })
  const [pwCurrent, setPwCurrent] = useState('')
  const [pwNew, setPwNew] = useState('')
  const [pwConfirm, setPwConfirm] = useState('')
  const [lockBusy, setLockBusy] = useState(false)

  useEffect(() => { AppLockStatus().then(setLock).catch(() => {}) }, [])

  const reloadLock = async () => {
    try { setLock(await AppLockStatus()) } catch {}
    await refreshAppLockStatus() // keep the live danger-gate cache in sync
  }

  const savePassword = async () => {
    if (pwNew.length < 4) { notify.error('Password must be at least 4 characters'); return }
    if (pwNew !== pwConfirm) { notify.error('Passwords do not match'); return }
    setLockBusy(true)
    try {
      await SetAppPassword(lock.enabled ? pwCurrent : '', pwNew)
      notify.success(lock.enabled ? 'Password changed' : 'App lock enabled')
      setPwCurrent(''); setPwNew(''); setPwConfirm('')
      await reloadLock()
    } catch (e: any) { notify.error(e) } finally { setLockBusy(false) }
  }

  const removeLock = async () => {
    if (!confirm('Remove the app password? ATK will open without prompting.')) return
    setLockBusy(true)
    try {
      await DisableAppLock(pwCurrent)
      notify.success('App lock removed')
      setPwCurrent(''); setPwNew(''); setPwConfirm('')
      await reloadLock()
    } catch (e: any) { notify.error(e) } finally { setLockBusy(false) }
  }

  const toggleDanger = async (on: boolean) => {
    if (!pwCurrent) { notify.error('Enter your current password above to change this'); return }
    setLockBusy(true)
    try {
      await SetRequireForDanger(pwCurrent, on)
      notify.success(on ? 'Destructive actions now require the password' : 'Re-auth on destructive actions turned off')
      setPwCurrent('')
      await reloadLock()
    } catch (e: any) { notify.error(e) } finally { setLockBusy(false) }
  }

  const [hidden, setHiddenState] = useState<string[]>(getHiddenViews())
  const [muteND, setMuteND] = useState<boolean>(getMuteNoDevice())
  const changeMuteND = (on: boolean) => { setMuteND(on); setMuteNoDevice(on) }
  const toggleFeature = (view: string) => {
    const next = hidden.includes(view) ? hidden.filter(v => v !== view) : [...hidden, view]
    setHiddenState(next); setHiddenViews(next)
  }

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

      {/* Appearance / theme */}
      <div className="card p-4 space-y-3">
        <div className="flex items-center gap-2">
          <Palette size={14} className="text-accent-green" />
          <p className="section-title">Appearance</p>
        </div>
        <p className="text-xs text-text-muted">Choose a colour theme. Applies instantly and is remembered.</p>
        <div className="grid grid-cols-3 gap-2">
          {THEMES.map(t => (
            <button
              key={t.id}
              onClick={() => changeTheme(t.id)}
              className={`text-left rounded border p-3 transition-colors ${
                theme === t.id
                  ? 'border-accent-green bg-accent-green/10'
                  : 'border-bg-border hover:bg-bg-raised'
              }`}
            >
              <div className="flex items-center justify-between">
                <span className="text-xs font-medium text-text-primary">{t.label}</span>
                {theme === t.id && <Check size={12} className="text-accent-green" />}
              </div>
              {/* Swatch preview: base · surface · accent · text */}
              <div className="flex gap-1 mt-2" aria-hidden="true">
                {t.swatch.map((c, i) => (
                  <span
                    key={i}
                    className="h-4 flex-1 rounded-sm border border-black/10"
                    style={{ backgroundColor: c }}
                  />
                ))}
              </div>
              <p className="text-xs text-text-muted mt-1.5 leading-snug">{t.hint}</p>
            </button>
          ))}
        </div>

        {/* Custom accent colour + font — system-wide overrides on top of the theme */}
        <div className="pt-1 grid grid-cols-2 gap-4">
          <div>
            <p className="text-xs text-text-muted mb-1.5">Custom accent colour (overrides the theme accent everywhere)</p>
            <div className="flex items-center gap-2">
              <input
                type="color"
                value={customAccent || '#a6d189'}
                onChange={e => changeAccent(e.target.value)}
                className="h-8 w-12 rounded border border-bg-border bg-bg-raised cursor-pointer p-0.5"
                title="Pick a custom accent colour"
              />
              <span className="mono text-xs text-text-secondary">{customAccent || 'theme default'}</span>
              {customAccent && (
                <button onClick={() => changeAccent(null)} className="btn-ghost text-xs ml-auto">Reset</button>
              )}
            </div>
          </div>
          <div>
            <p className="text-xs text-text-muted mb-1.5">Font (applied app-wide)</p>
            <select
              className="input text-xs w-full"
              value={customFont}
              onChange={e => changeFont(e.target.value)}
            >
              {FONT_OPTIONS.map(f => <option key={f.id} value={f.id}>{f.label}</option>)}
            </select>
          </div>
        </div>

        <p className="text-xs text-text-muted pt-1">Sidebar position. Applies instantly and is remembered.</p>
        <div className="grid grid-cols-3 gap-2">
          {SIDEBAR_POSITIONS.map(p => (
            <button
              key={p.id}
              onClick={() => changeSidebarPos(p.id)}
              className={`text-left rounded border p-3 transition-colors ${
                sidebarPos === p.id
                  ? 'border-accent-green bg-accent-green/10'
                  : 'border-bg-border hover:bg-bg-raised'
              }`}
            >
              <div className="flex items-center justify-between">
                <span className="text-xs font-medium text-text-primary">{p.label}</span>
                {sidebarPos === p.id && <Check size={12} className="text-accent-green" />}
              </div>
              <p className="text-xs text-text-muted mt-1 leading-snug">{p.hint}</p>
            </button>
          ))}
        </div>

        <div className="flex items-center justify-between pt-1">
          <div className="pr-3">
            <p className="text-xs font-medium text-text-primary">Show navigation labels</p>
            <p className="text-xs text-text-muted">Display the name under each sidebar icon (e.g. Dashboard, Files).</p>
          </div>
          <button
            onClick={() => changeSidebarLabels(!sidebarLabels)}
            role="switch"
            aria-checked={sidebarLabels}
            title="Toggle navigation labels"
            className={`relative h-5 w-9 rounded-full transition-colors shrink-0 ${
              sidebarLabels ? 'bg-accent-green' : 'bg-bg-border'
            }`}
          >
            <span
              className={`absolute top-0.5 h-4 w-4 rounded-full bg-bg-surface shadow transition-all ${
                sidebarLabels ? 'left-[18px]' : 'left-0.5'
              }`}
            />
          </button>
        </div>

        <div className="flex items-center justify-between pt-1">
          <div className="pr-3">
            <p className="text-xs font-medium text-text-primary">Mute "no device" pop-ups</p>
            <p className="text-xs text-text-muted">Hide error toasts about a missing / offline / unauthorized device while browsing.</p>
          </div>
          <button
            onClick={() => changeMuteND(!muteND)}
            role="switch"
            aria-checked={muteND}
            className={`relative h-5 w-9 rounded-full transition-colors shrink-0 ${muteND ? 'bg-accent-green' : 'bg-bg-border'}`}
          >
            <span className={`absolute top-0.5 h-4 w-4 rounded-full bg-bg-surface shadow transition-all ${muteND ? 'left-[18px]' : 'left-0.5'}`} />
          </button>
        </div>

        <div className="flex items-center justify-between pt-1">
          <p className="text-xs text-text-muted">Restore warnings you've hidden with the ✕ button.</p>
          <button
            onClick={() => { resetDismissed(); notify.success('Hidden warnings restored — reopen views to see them') }}
            className="btn-ghost text-xs shrink-0"
          >
            Show hidden warnings
          </button>
        </div>
      </div>

      {/* Sidebar features kill-switch */}
      <div className="card p-4 space-y-3">
        <div className="flex items-center gap-2">
          <Palette size={14} className="text-accent-green" />
          <p className="section-title">Sidebar Features</p>
        </div>
        <p className="text-xs text-text-muted">Turn off the tools you don't use to declutter the sidebar. Settings always stays.</p>
        <div className="grid grid-cols-2 gap-x-4 gap-y-2">
          {TOGGLEABLE_VIEWS.map(f => {
            const on = !hidden.includes(f.view)
            return (
              <div key={f.view} className="flex items-center justify-between gap-2">
                <span className="text-xs text-text-secondary">{f.label}</span>
                <button
                  onClick={() => toggleFeature(f.view)}
                  role="switch"
                  aria-checked={on}
                  className={`relative h-5 w-9 rounded-full transition-colors shrink-0 ${on ? 'bg-accent-green' : 'bg-bg-border'}`}
                >
                  <span className={`absolute top-0.5 h-4 w-4 rounded-full bg-bg-surface shadow transition-all ${on ? 'left-[18px]' : 'left-0.5'}`} />
                </button>
              </div>
            )
          })}
        </div>
      </div>

      {/* App lock / security */}
      <div className="card p-4 space-y-4">
        <div className="flex items-center gap-2">
          <Lock size={14} className="text-accent-green" />
          <p className="section-title">App Lock</p>
          {lock.enabled && <span className="badge-green text-xs">enabled</span>}
        </div>
        <p className="text-xs text-text-muted">
          Require a password to open ATK. Stored only as a salted scrypt hash — never the password itself.
          <br />
          <span className="text-warn">Note:</span> this gates the ATK app so it can't be driven into flashing
          or uninstalling without the password. It can't stop a compromised computer from running{' '}
          <span className="mono">adb</span>/<span className="mono">fastboot</span> directly, outside ATK — nothing
          running as your user can.
        </p>

        {/* Current password (needed to change/remove or toggle re-auth when a lock exists) */}
        {lock.enabled && (
          <input
            type="password"
            className="input text-xs w-full"
            placeholder="Current password"
            value={pwCurrent}
            onChange={e => setPwCurrent(e.target.value)}
          />
        )}

        {/* Set / change password */}
        <div className="grid grid-cols-2 gap-2">
          <input
            type="password"
            className="input text-xs w-full"
            placeholder={lock.enabled ? 'New password' : 'Password'}
            value={pwNew}
            onChange={e => setPwNew(e.target.value)}
          />
          <input
            type="password"
            className="input text-xs w-full"
            placeholder="Confirm password"
            value={pwConfirm}
            onChange={e => setPwConfirm(e.target.value)}
          />
        </div>
        <div className="flex gap-2">
          <button onClick={savePassword} disabled={lockBusy} className="btn-primary text-xs">
            {lock.enabled ? 'Change password' : 'Enable app lock'}
          </button>
          {lock.enabled && (
            <button onClick={removeLock} disabled={lockBusy} className="btn-ghost text-xs text-danger">
              Remove app lock
            </button>
          )}
        </div>

        {/* Optional: re-auth before destructive actions */}
        {lock.enabled && (
          <div className="flex items-center justify-between gap-3 pt-2 border-t border-bg-border/50">
            <div>
              <p className="text-xs font-medium text-text-primary">Require password for destructive actions</p>
              <p className="text-xs text-text-muted mt-0.5">
                Re-prompt before flashing, uninstalling/debloating, and Magisk installs. Enter your current
                password above first. Stays unlocked for a few minutes after each confirmation.
              </p>
            </div>
            <button
              onClick={() => toggleDanger(!lock.requireForDanger)}
              role="switch"
              aria-checked={lock.requireForDanger}
              disabled={lockBusy}
              className={`relative h-5 w-9 rounded-full transition-colors shrink-0 ${lock.requireForDanger ? 'bg-accent-green' : 'bg-bg-border'}`}
            >
              <span className={`absolute top-0.5 h-4 w-4 rounded-full bg-bg-surface shadow transition-all ${lock.requireForDanger ? 'left-[18px]' : 'left-0.5'}`} />
            </button>
          </div>
        )}
      </div>

      {/* Advanced / root tools */}
      <div className="card p-4 space-y-3">
        <div className="flex items-center gap-2">
          <AlertTriangle size={14} className="text-warn" />
          <p className="section-title">Advanced</p>
        </div>
        <div className="flex items-center justify-between gap-3">
          <div>
            <p className="text-xs font-medium text-text-primary">Enable rooting tools (Magisk patching)</p>
            <p className="text-xs text-text-muted mt-0.5">Adds a Magisk boot-patching panel to the Flasher for rooting. Off by default — these operations can wipe or brick a device if misused.</p>
          </div>
          <button
            onClick={() => changeRootTools(!rootTools)}
            role="switch"
            aria-checked={rootTools}
            className={`relative h-5 w-9 rounded-full transition-colors shrink-0 ${rootTools ? 'bg-accent-green' : 'bg-bg-border'}`}
          >
            <span className={`absolute top-0.5 h-4 w-4 rounded-full bg-bg-surface shadow transition-all ${rootTools ? 'left-[18px]' : 'left-0.5'}`} />
          </button>
        </div>
      </div>

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
