import { useState, type ReactNode } from 'react'
import { X } from 'lucide-react'
import { isDismissed, dismiss } from '../lib/dismissible'

interface Props {
  /** Stable unique id - dismissal is remembered against this. */
  id: string
  /** Container classes (background, border, padding, text colour). */
  className?: string
  children: ReactNode
}

/**
 * A banner the user can permanently hide with the ✕ button. The dismissal is
 * remembered across restarts (keyed by `id`). Renders nothing once dismissed.
 */
export default function DismissibleBanner({ id, className = '', children }: Props) {
  const [hidden, setHidden] = useState(() => isDismissed(id))
  if (hidden) return null
  return (
    <div className={`flex items-start gap-2 ${className}`}>
      <div className="flex-1 flex items-start gap-2 min-w-0">{children}</div>
      <button
        onClick={() => { dismiss(id); setHidden(true) }}
        title="Hide this message"
        className="shrink-0 -my-0.5 -mr-1 p-1 rounded opacity-50 hover:opacity-100 transition-opacity"
      >
        <X size={14} />
      </button>
    </div>
  )
}
