// Custom frameless title bar. The window is Frameless (main.go), which on GTK
// also removes the native title (so no app name shows). This thin bar provides
// the drag region via Wails' `--wails-draggable:drag` CSS hint, plus macOS-style
// traffic-light controls tinted in Catppuccin pastels. No app name by design.

import { requestQuitConfirm } from '../../lib/quitgate'

// Runtime is injected by Wails on window['runtime'] (same access pattern as
// ViewLogcat.tsx); guarded with ?. so a browser dev session won't crash.
const rt = () => (window as any)['runtime']

function TrafficLight({ color, hover, title, onClick }: {
  color: string; hover: string; title: string; onClick: () => void
}) {
  return (
    <button
      onClick={onClick}
      title={title}
      style={{ backgroundColor: color }}
      className={`w-3 h-3 rounded-full transition-colors ${hover}`}
    />
  )
}

export default function TitleBar() {
  return (
    <div
      className="titlebar h-8 shrink-0 flex items-center gap-2 px-3 bg-bg-surface border-b border-bg-border"
      style={{ '--wails-draggable': 'drag' } as React.CSSProperties}
    >
      {/* Catppuccin Frappé: green #a6d189, peach/yellow #e5c890, red #e78284.
          Right-aligned (ml-auto), close at the far edge. */}
      <div className="flex items-center gap-2 ml-auto" style={{ '--wails-draggable': 'no-drag' } as React.CSSProperties}>
        <TrafficLight color="#e5c890" hover="hover:brightness-110" title="Minimise" onClick={() => rt()?.WindowMinimise?.()} />
        <TrafficLight color="#a6d189" hover="hover:brightness-110" title="Maximise" onClick={() => rt()?.WindowToggleMaximise?.()} />
        <TrafficLight color="#e78284" hover="hover:brightness-110" title="Close"    onClick={requestQuitConfirm} />
      </div>
    </div>
  )
}
