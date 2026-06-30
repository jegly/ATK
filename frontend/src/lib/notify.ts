// Simple toast state management - used with sonner
import { toast } from 'sonner'

// When the user enables "mute no-device pop-ups" (Settings), swallow error
// toasts that are just about a missing/offline/unauthorized device.
function mutedNoDevice(msg: string): boolean {
  if (localStorage.getItem('atk-mute-nodevice') !== '1') return false
  const s = msg.toLowerCase()
  return s.includes('no device') || s.includes('no devices/emulators') ||
    s.includes('offline') || s.includes('unauthorized') || s.includes('device not found')
}

export const notify = {
  success: (msg: string) => toast.success(msg, { duration: 3000 }),
  error: (msg: string) => {
    const s = String(msg)
    if (mutedNoDevice(s)) return
    return toast.error(s, { duration: 5000 })
  },
  info: (msg: string) => toast(msg, { duration: 3000 }),
  loading: (msg: string) => toast.loading(msg),
  dismiss: (id?: string | number) => toast.dismiss(id),
}
