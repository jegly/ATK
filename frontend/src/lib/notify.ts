// Simple toast state management - used with sonner
import { toast } from 'sonner'

export const notify = {
  success: (msg: string) => toast.success(msg, { duration: 3000 }),
  error: (msg: string) => toast.error(msg, { duration: 5000 }),
  info: (msg: string) => toast(msg, { duration: 3000 }),
  loading: (msg: string) => toast.loading(msg),
  dismiss: (id?: string | number) => toast.dismiss(id),
}
