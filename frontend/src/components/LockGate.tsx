import { useState } from 'react'
import { Lock } from 'lucide-react'
import { VerifyAppPassword } from '../lib/wails'

// Full-window launch gate. Rendered in place of the app when the lock is
// enabled and the session hasn't been unlocked yet. The backend stores only a
// salted scrypt hash; this just verifies and reveals the UI.
export default function LockGate({ onUnlock }: { onUnlock: () => void }) {
  const [password, setPassword] = useState('')
  const [error, setError]       = useState('')
  const [busy, setBusy]         = useState(false)

  const submit = async (e: React.FormEvent) => {
    e.preventDefault()
    if (!password || busy) return
    setBusy(true)
    setError('')
    try {
      const ok = await VerifyAppPassword(password)
      if (ok) { onUnlock(); return }
      setError('Incorrect password')
      setPassword('')
    } catch (err: any) {
      setError(String(err))
    } finally {
      setBusy(false)
    }
  }

  return (
    <div className="flex h-full items-center justify-center bg-bg-base rounded-[10px]">
      <form onSubmit={submit} className="card p-6 w-80 space-y-4 text-center">
        <div className="flex flex-col items-center gap-2">
          <div className="w-12 h-12 rounded-full bg-bg-raised flex items-center justify-center">
            <Lock size={22} className="text-accent-green" />
          </div>
          <p className="text-sm font-medium text-text-primary">ATK is locked</p>
          <p className="text-xs text-text-muted">Enter your app password to continue</p>
        </div>
        <input
          type="password"
          autoFocus
          className="input text-sm w-full text-center"
          placeholder="Password"
          value={password}
          onChange={e => setPassword(e.target.value)}
        />
        {error && <p className="text-xs text-danger">{error}</p>}
        <button type="submit" disabled={!password || busy} className="btn-primary text-sm w-full justify-center">
          {busy ? 'Unlocking…' : 'Unlock'}
        </button>
      </form>
    </div>
  )
}
