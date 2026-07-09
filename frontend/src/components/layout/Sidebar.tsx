import {
  LayoutDashboard, FolderOpen, Package, PackagePlus, Terminal,
  Zap, Wrench, Settings, Shield,
  ScrollText, Search, Lock, Archive, SlidersHorizontal, ScanSearch, MonitorSmartphone, Rocket, HardDriveDownload
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
  { view: 'apkinstaller', icon: <PackagePlus size={17} />,     label: 'APK Installer' },
  { view: 'debloater',    icon: <Shield size={17} />,          label: 'Debloater' },
  { view: 'shell',        icon: <Terminal size={17} />,        label: 'Shell' },
  { view: 'logcat',       icon: <ScrollText size={17} />,      label: 'Logcat',       dividerBefore: true },
  { view: 'appinspect',   icon: <Search size={17} />,          label: 'App Inspector' },
  { view: 'intentlab',    icon: <Rocket size={17} />,          label: 'Intent Lab' },
  { view: 'apkaudit',     icon: <ScanSearch size={17} />,      label: 'APK Audit' },
  { view: 'certs',        icon: <Lock size={17} />,            label: 'Certificates' },
  { view: 'backup',       icon: <Archive size={17} />,         label: 'Backup' },
  { view: 'props',        icon: <SlidersHorizontal size={17}/>, label: 'Prop Editor' },
  { view: 'utilities',    icon: <Wrench size={17} />,          label: 'Utilities',    dividerBefore: true },
  { view: 'flasher',      icon: <Zap size={17} />,             label: 'Flasher' },
  { view: 'gsiloader',    icon: <HardDriveDownload size={17} />, label: 'GSI Loader' },
]

// Floor for progressive label shrinking in the horizontal sidebar - below
// this, text becomes illegible, so labels hide outright instead.
const MIN_LABEL_SCALE = 0.65

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

  // When horizontal (top/bottom sidebar), labels can make the row wider than
  // the window - rather than forcing a horizontal scrollbar, shrink label text
  // progressively as space gets tight (labelScale 1 -> MIN_LABEL_SCALE), and
  // only hide labels outright once even minimum-size text wouldn't fit.
  // `measureRef` is an offscreen clone always rendered WITH full-size labels
  // at natural width; comparing its scrollWidth against the real nav's
  // clientWidth (which itself doesn't change as labelScale changes) avoids
  // the flip-flop you'd get measuring the visible, already-shrunk row.
  const navRef = useRef<HTMLElement>(null)
  const measureRef = useRef<HTMLDivElement>(null)
  const [labelScale, setLabelScale] = useState(1)
  const effectiveShowLabels = showLabels && (!horizontal || labelScale > 0)

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

  useEffect(() => {
    if (!horizontal || !showLabels) { setLabelScale(1); return }
    const nav = navRef.current
    const measure = measureRef.current
    if (!nav || !measure) return
    const check = () => {
      const ratio = measure.scrollWidth > 0 ? nav.clientWidth / measure.scrollWidth : 1
      setLabelScale(ratio >= 1 ? 1 : ratio >= MIN_LABEL_SCALE ? ratio : 0)
    }
    check()
    const ro = new ResizeObserver(check)
    ro.observe(nav)
    return () => ro.disconnect()
  }, [horizontal, showLabels, visibleItems])

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
    ? `${effectiveShowLabels ? 'h-[68px]' : 'h-[52px]'} w-full flex flex-row items-center bg-bg-surface ${edgeBorder} border-bg-border shrink-0`
    : `${effectiveShowLabels ? 'w-[84px]' : 'w-[52px]'} flex flex-col bg-bg-surface ${edgeBorder} border-bg-border shrink-0`

  const navCls = horizontal
    ? 'flex-1 flex flex-row items-center justify-center gap-0.5 px-1 overflow-x-auto'
    : 'flex-1 flex flex-col gap-0.5 p-1 pt-1.5 overflow-auto'

  const dividerCls = horizontal ? 'h-7 w-px bg-bg-border mx-1' : 'w-full h-px bg-bg-border my-1'

  const settingsWrapCls = horizontal
    ? 'px-1 h-full flex items-center border-l border-bg-border shrink-0'
    : 'p-1 pb-1.5 border-t border-bg-border shrink-0'

  const btnSizing = !effectiveShowLabels
    ? 'w-8 h-8'
    : horizontal
      ? 'flex-col gap-1 px-2 py-1.5 h-full justify-center'
      : 'flex-col gap-1 px-1 py-1.5 w-full'

  const labelCls = `leading-tight text-center ${horizontal ? 'whitespace-nowrap' : ''}`

  // Horizontal-only: button width and label font-size both track labelScale,
  // so shrinking text actually reclaims row space instead of just looking smaller.
  const btnStyle: React.CSSProperties | undefined =
    horizontal && effectiveShowLabels ? { minWidth: `${3.25 * labelScale}rem` } : undefined
  const labelStyle: React.CSSProperties = { fontSize: `${10 * labelScale}px` }

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
        style={btnStyle}
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
        {effectiveShowLabels && <span className={labelCls} style={labelStyle}>{label}</span>}
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
      {horizontal && showLabels && (
        <div ref={measureRef} aria-hidden="true" className="fixed -top-[9999px] left-0 flex flex-row items-center gap-0.5 px-1 pointer-events-none">
          {visibleItems.map(({ view, icon, label, dividerBefore }, idx) => (
            <div key={view} className="flex items-center">
              {dividerBefore && idx > 0 && <div className={dividerCls} />}
              <div className="flex flex-col items-center justify-center gap-1 px-2 py-1.5 min-w-[3.25rem] h-[68px]">
                {icon}
                <span className="text-[10px] leading-tight text-center whitespace-nowrap">{label}</span>
              </div>
            </div>
          ))}
          <div className="w-px h-7 bg-bg-border mx-1" />
          <div className="flex flex-col items-center justify-center gap-1 px-2 py-1.5 min-w-[3.25rem] h-[68px]">
            <Settings size={17} />
            <span className="text-[10px] leading-tight text-center whitespace-nowrap">Settings</span>
          </div>
        </div>
      )}
      <nav ref={navRef} className={navCls}>
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
