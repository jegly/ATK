import { useEffect, useState } from 'react'
import { ShieldAlert } from 'lucide-react'
import { _registerDangerHost, tryUnlockDanger, type DangerRequest } from '../lib/applock'

// Modal host for the destructive-action re-auth prompt. Mounted once in App.tsx.
// ensureDangerUnlocked() (lib/applock) drives it: when a destructive action
// needs re-auth, it hands us a request whose `resolve` we call with the outcome.
export default function DangerGate() {
  const [req, setReq]         = useState<DangerRequest | null>(null)
  const [password, setPassword] = useState('')
  const [error, setError]     = useState('')
  const [busy, setBusy]       = useState(false)

  useEffect(() => _registerDangerHost(r => {
    setPassword('')
    setError('')
    setReq(r)
  }), [])

  if (!req) return null

  const close = (ok: boolean) => {
    req.resolve(ok)
    setReq(null)
  }

  const submit = async (e: React.FormEvent) => {
    e.preventDefault()
    if (!password || busy) return
    setBusy(true)
    setError('')
    try {
      const ok = await tryUnlockDanger(password)
      if (ok) { close(true); return }
      setError('Incorrect password')
      setPassword('')
    } catch (err: any) {
      setError(String(err))
    } finally {
      setBusy(false)
    }
  }

  return (
    <div
      className="fixed inset-0 z-50 flex items-center justify-center bg-black/50"
      onMouseDown={e => { if (e.target === e.currentTarget) close(false) }}
    >
      <form onSubmit={submit} className="card p-5 w-80 space-y-4">
        <div className="flex items-center gap-2">
          <ShieldAlert size={18} className="text-warn shrink-0" />
          <p className="text-sm font-medium text-text-primary">Confirm with password</p>
        </div>
        <p className="text-xs text-text-muted">
          This is a destructive action. Re-enter your app password to continue. You won't be
          asked again for a few minutes.
        </p>
        <input
          type="password"
          autoFocus
          className="input text-sm w-full"
          placeholder="App password"
          value={password}
          onChange={e => setPassword(e.target.value)}
        />
        {error && <p className="text-xs text-danger">{error}</p>}
        <div className="flex gap-2 justify-end">
          <button type="button" onClick={() => close(false)} className="btn-ghost text-xs">Cancel</button>
          <button type="submit" disabled={!password || busy} className="btn-primary text-xs">
            {busy ? 'Verifying…' : 'Confirm'}
          </button>
        </div>
      </form>
    </div>
  )
}
