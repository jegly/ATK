import {
  LayoutDashboard, FolderOpen, Package, Terminal,
  Zap, Wrench, Settings, Shield,
  ScrollText, Search, Lock, Archive, SlidersHorizontal, ScanSearch, MonitorSmartphone
} from 'lucide-react'
import { useState, useEffect, useMemo, useRef } from 'react'
import type { View } from '../../lib/types'
import type { SidebarPosition } from '../../lib/layout'
import { getHiddenViews, onHiddenViewsChange, getNavOrder, setNavOrder } from '../../lib/featureflags'

interface Props {
  activeView: View
  onViewChange: (v: View) => void
  position: SidebarPosition
  showLabels: boolean
}

interface NavItem { view: View; icon: React.ReactNode; label: string; dividerBefore?: boolean }

const navItems: NavItem[] = [
  { view: 'dashboard',    icon: <LayoutDashboard size={17} />, label: 'Dashboard' },
  { view: 'files',        icon: <FolderOpen size={17} />,      label: 'Files' },
  { view: 'mirror',       icon: <MonitorSmartphone size={17} />, label: 'Screen Mirror' },
  { view: 'packages',     icon: <Package size={17} />,         label: 'Packages' },
  { view: 'debloater',    icon: <Shield size={17} />,          label: 'Debloater' },
  { view: 'shell',        icon: <Terminal size={17} />,        label: 'Shell' },
  { view: 'logcat',       icon: <ScrollText size={17} />,      label: 'Logcat',       dividerBefore: true },
  { view: 'appinspect',   icon: <Search size={17} />,          label: 'App Inspector' },
  { view: 'apkaudit',     icon: <ScanSearch size={17} />,      label: 'APK Audit' },
  { view: 'certs',        icon: <Lock size={17} />,            label: 'Certificates' },
  { view: 'backup',       icon: <Archive size={17} />,         label: 'Backup' },
  { view: 'props',        icon: <SlidersHorizontal size={17}/>, label: 'Prop Editor' },
  { view: 'utilities',    icon: <Wrench size={17} />,          label: 'Utilities',    dividerBefore: true },
  { view: 'flasher',      icon: <Zap size={17} />,             label: 'Flasher' },
]

interface DragProps {
  onDragStart: (e: React.DragEvent) => void
  onDragOver: (e: React.DragEvent) => void
  onDragLeave: () => void
  onDrop: (e: React.DragEvent) => void
  onDragEnd: () => void
  over: boolean
}

export default function Sidebar({ activeView, onViewChange, position, showLabels }: Props) {
  const horizontal = position !== 'left'

  const [hidden, setHidden] = useState<string[]>(getHiddenViews())
  useEffect(() => onHiddenViewsChange(setHidden), [])

  // Drag-to-reorder (dock style). Saved order first, then any new defaults.
  const [order, setOrder] = useState<string[]>(getNavOrder())
  const dragRef = useRef<string | null>(null)
  const [overView, setOverView] = useState<string | null>(null)

  const ordered = useMemo(() => {
    const map = new Map(navItems.map(i => [i.view as string, i]))
    const seen = new Set<string>()
    const res: NavItem[] = []
    for (const v of order) {
      const it = map.get(v)
      if (it) { res.push(it); seen.add(v) }
    }
    for (const it of navItems) if (!seen.has(it.view)) res.push(it)
    return res
  }, [order])

  const visibleItems = ordered.filter(i => !hidden.includes(i.view))

  const handleDrop = (target: string) => {
    const from = dragRef.current
    dragRef.current = null
    setOverView(null)
    if (!from || from === target) return
    const base = ordered.map(i => i.view as string)
    const fi = base.indexOf(from)
    const ti = base.indexOf(target)
    if (fi < 0 || ti < 0) return
    base.splice(fi, 1)
    base.splice(ti, 0, from)
    setOrder(base)
    setNavOrder(base)
  }

  const edgeBorder =
    position === 'left' ? 'border-r' : position === 'top' ? 'border-b' : 'border-t'

  const asideCls = horizontal
    ? `${showLabels ? 'h-[68px]' : 'h-[52px]'} w-full flex flex-row items-center bg-bg-surface ${edgeBorder} border-bg-border shrink-0`
    : `${showLabels ? 'w-[84px]' : 'w-[52px]'} flex flex-col bg-bg-surface ${edgeBorder} border-bg-border shrink-0`

  const navCls = horizontal
    ? 'flex-1 flex flex-row items-center justify-center gap-0.5 px-1 overflow-x-auto'
    : 'flex-1 flex flex-col gap-0.5 p-1 pt-1.5 overflow-auto'

  const dividerCls = horizontal ? 'h-7 w-px bg-bg-border mx-1' : 'w-full h-px bg-bg-border my-1'

  const settingsWrapCls = horizontal
    ? 'px-1 h-full flex items-center border-l border-bg-border shrink-0'
    : 'p-1 pb-1.5 border-t border-bg-border shrink-0'

  const btnSizing = !showLabels
    ? 'w-8 h-8'
    : horizontal
      ? 'flex-col gap-1 px-2 py-1.5 min-w-[3.25rem] h-full justify-center'
      : 'flex-col gap-1 px-1 py-1.5 w-full'

  const labelCls = `text-[10px] leading-tight text-center ${horizontal ? 'whitespace-nowrap' : ''}`

  const renderButton = (view: View | 'settings', icon: React.ReactNode, label: string, drag?: DragProps) => {
    const active = activeView === view
    return (
      <button
        draggable={!!drag}
        onDragStart={drag?.onDragStart}
        onDragOver={drag?.onDragOver}
        onDragLeave={drag?.onDragLeave}
        onDrop={drag?.onDrop}
        onDragEnd={drag?.onDragEnd}
        onClick={() => onViewChange(view as View)}
        title={label}
        className={`
          flex items-center justify-center rounded transition-all duration-150 relative
          ${btnSizing}
          ${drag ? 'cursor-grab active:cursor-grabbing' : ''}
          ${drag?.over ? 'ring-1 ring-accent-green ring-inset' : ''}
          ${active
            ? 'bg-accent-green/10 text-accent-green'
            : 'text-text-muted hover:text-text-secondary hover:bg-bg-raised'
          }
        `}
      >
        {icon}
        {showLabels && <span className={labelCls}>{label}</span>}
        {active && (
          horizontal
            ? <span className="absolute bottom-0 left-1/2 -translate-x-1/2 h-0.5 w-5 bg-accent-green rounded-t" />
            : <span className="absolute left-0 top-1/2 -translate-y-1/2 w-0.5 h-5 bg-accent-green rounded-r" />
        )}
      </button>
    )
  }

  return (
    <aside className={asideCls}>
      <nav className={navCls}>
        {visibleItems.map(({ view, icon, label, dividerBefore }, idx) => (
          <div key={view} className={horizontal ? 'flex items-center' : undefined}>
            {dividerBefore && idx > 0 && <div className={dividerCls} />}
            {renderButton(view, icon, label, {
              onDragStart: e => { dragRef.current = view; e.dataTransfer.setData('text/plain', view); e.dataTransfer.effectAllowed = 'move' },
              onDragOver: e => { e.preventDefault(); if (overView !== view) setOverView(view) },
              onDragLeave: () => setOverView(s => (s === view ? null : s)),
              onDrop: e => { e.preventDefault(); handleDrop(view) },
              onDragEnd: () => { dragRef.current = null; setOverView(null) },
              over: overView === view && dragRef.current !== view,
            })}
          </div>
        ))}
      </nav>

      <div className={settingsWrapCls}>
        {renderButton('settings', <Settings size={17} />, 'Settings')}
      </div>
    </aside>
  )
}
