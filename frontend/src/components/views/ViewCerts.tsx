import { useState, useEffect } from 'react'
import { Shield, RefreshCw, Plus, Trash2, AlertTriangle, Check, Lock } from 'lucide-react'
import { ListSystemCerts, ListUserCerts, InstallUserCert, RemoveUserCert, SelectCertFile } from '../../lib/wails'
import { notify } from '../../lib/notify'
import type { CertInfo } from '../../lib/types'

export default function ViewCerts() {
  const [systemCerts, setSystemCerts]   = useState<CertInfo[]>([])
  const [userCerts, setUserCerts]       = useState<CertInfo[]>([])
  const [loading, setLoading]           = useState(false)
  const [activeTab, setActiveTab]       = useState<'user' | 'system'>('user')

  const load = async () => {
    setLoading(true)
    try {
      const [sys, usr] = await Promise.all([ListSystemCerts(), ListUserCerts()])
      setSystemCerts(sys || [])
      setUserCerts(usr || [])
    } catch (e: any) {
      notify.error(e)
    } finally {
      setLoading(false)
    }
  }

  useEffect(() => { load() }, [])

  const installCert = async () => {
    try {
      const path = await SelectCertFile()
      if (!path) return
      const id = notify.loading('Installing certificate...')
      const out = await InstallUserCert(path)
      notify.dismiss(id)
      notify.success(out)
      load()
    } catch (e: any) {
      notify.error(e)
    }
  }

  const removeCert = async (cert: CertInfo) => {
    if (!confirm(`Remove certificate:\n${cert.subject || cert.filename}?`)) return
    try {
      const out = await RemoveUserCert(cert.filename)
      notify.success(out)
      load()
    } catch (e: any) {
      notify.error(e)
    }
  }

  const certs = activeTab === 'user' ? userCerts : systemCerts

  return (
    <div className="flex flex-col h-full overflow-hidden">
      {/* Header */}
      <div className="border-b border-bg-border px-4 py-2 flex items-center gap-3 shrink-0">
        <Lock size={14} className="text-accent-green" />
        <span className="text-xs text-text-secondary">
          {userCerts.length} user certs · {systemCerts.length} system certs
        </span>
        <div className="flex-1" />
        <button onClick={installCert} className="btn-primary text-xs">
          <Plus size={12} /> Install User CA
        </button>
        <button onClick={load} disabled={loading} className="btn-ghost text-xs">
          <RefreshCw size={12} className={loading ? 'animate-spin' : ''} /> Refresh
        </button>
      </div>

      {/* Burp/MITM info banner */}
      <div className="border-b border-bg-border/50 bg-accent-green/5 px-4 py-2 shrink-0">
        <div className="flex items-start gap-2">
          <Shield size={13} className="text-accent-green shrink-0 mt-0.5" />
          <div className="text-xs text-text-secondary space-y-0.5">
            <p className="font-medium text-accent-green">HTTPS Interception Setup (Burp Suite / mitmproxy)</p>
            <p>1. Export your proxy CA cert as DER/PEM  2. Click "Install User CA" above  3. Set device proxy to your machine IP  4. For Android 7+ apps with pinning — use Magisk TrustUserCerts module or patch the APK</p>
          </div>
        </div>
      </div>

      {/* Tabs */}
      <div className="border-b border-bg-border flex shrink-0">
        {(['user', 'system'] as const).map(tab => (
          <button
            key={tab}
            onClick={() => setActiveTab(tab)}
            className={`px-4 py-2 text-xs border-b-2 transition-colors ${
              activeTab === tab
                ? 'border-accent-green text-accent-green'
                : 'border-transparent text-text-muted hover:text-text-secondary'
            }`}
          >
            {tab === 'user' ? `User Certificates (${userCerts.length})` : `System Certificates (${systemCerts.length})`}
          </button>
        ))}
      </div>

      {/* Warning for user certs */}
      {activeTab === 'user' && (
        <div className="border-b border-warn/20 bg-warn/5 px-4 py-2 flex items-start gap-2 shrink-0">
          <AlertTriangle size={13} className="text-warn shrink-0 mt-0.5" />
          <p className="text-xs text-warn/80">
            <span className="font-medium">Android 7+ restricts user certs</span> — apps targeting API 24+ won't trust them by default.
            Use <span className="mono">TrustUserCerts</span> Magisk module or recompile the app's network security config to include user certs.
          </p>
        </div>
      )}

      {/* Cert list */}
      <div className="flex-1 overflow-auto">
        {loading && (
          <div className="flex items-center justify-center h-32">
            <div className="w-5 h-5 border-2 border-accent-green border-t-transparent rounded-full animate-spin" />
          </div>
        )}

        {!loading && certs.length === 0 && (
          <div className="flex flex-col items-center justify-center h-32 gap-2 text-text-muted">
            <Lock size={24} className="opacity-30" />
            <p className="text-sm">
              {activeTab === 'user' ? 'No user-installed certificates' : 'No system certificates found'}
            </p>
          </div>
        )}

        {certs.map(cert => (
          <div key={cert.filename} className="border-b border-bg-border/50 px-4 py-3 flex items-start gap-3 hover:bg-bg-raised transition-colors">
            <Shield size={14} className="text-accent-green shrink-0 mt-0.5" />
            <div className="flex-1 min-w-0">
              <div className="flex items-center gap-2 flex-wrap">
                <span className="text-xs font-medium text-text-primary truncate">
                  {cert.subject || cert.filename}
                </span>
                {cert.isUser && <span className="badge-yellow">user</span>}
                {cert.isSystem && <span className="badge-gray">system</span>}
              </div>
              {cert.issuer && <p className="text-xs text-text-muted mt-0.5">Issuer: {cert.issuer}</p>}
              {cert.expiry && <p className="text-xs text-text-muted">Expires: {cert.expiry}</p>}
              {cert.fingerprint && (
                <p className="mono text-xs text-text-muted mt-0.5 break-all">{cert.fingerprint}</p>
              )}
              <p className="mono text-xs text-text-muted">{cert.filename}</p>
            </div>
            {cert.isUser && (
              <button
                onClick={() => removeCert(cert)}
                className="btn-danger text-xs py-1 px-2 shrink-0"
                title="Remove certificate"
              >
                <Trash2 size={11} />
              </button>
            )}
          </div>
        ))}
      </div>
    </div>
  )
}
