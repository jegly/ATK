import {
  LayoutDashboard, FolderOpen, Package, Terminal,
  Zap, Wrench, Settings, Radio, Shield, Smartphone,
  ScrollText, Search, Lock, Archive, SlidersHorizontal
} from 'lucide-react'
import type { View } from '../../lib/types'

interface Props {
  activeView: View
  onViewChange: (v: View) => void
}

const navItems: { view: View; icon: React.ReactNode; label: string; dividerBefore?: boolean }[] = [
  { view: 'dashboard',    icon: <LayoutDashboard size={17} />, label: 'Dashboard' },
  { view: 'files',        icon: <FolderOpen size={17} />,      label: 'Files' },
  { view: 'packages',     icon: <Package size={17} />,         label: 'Packages' },
  { view: 'debloater',    icon: <Shield size={17} />,          label: 'Debloater' },
  { view: 'shell',        icon: <Terminal size={17} />,        label: 'Shell' },
  { view: 'logcat',       icon: <ScrollText size={17} />,      label: 'Logcat',       dividerBefore: true },
  { view: 'appinspect',   icon: <Search size={17} />,          label: 'App Inspector' },
  { view: 'certs',        icon: <Lock size={17} />,            label: 'Certificates' },
  { view: 'backup',       icon: <Archive size={17} />,         label: 'Backup' },
  { view: 'props',        icon: <SlidersHorizontal size={17}/>, label: 'Prop Editor' },
  { view: 'utilities',    icon: <Wrench size={17} />,          label: 'Utilities',    dividerBefore: true },
  { view: 'flasher',      icon: <Zap size={17} />,             label: 'Flasher' },
  { view: 'pixelflasher', icon: <Smartphone size={17} />,      label: 'Pixel Flash' },
]

export default function Sidebar({ activeView, onViewChange }: Props) {
  return (
    <aside className="w-[52px] flex flex-col bg-bg-surface border-r border-bg-border shrink-0">
      <div className="h-12 flex items-center justify-center border-b border-bg-border shrink-0">
        <Radio size={18} className="text-accent-green" />
      </div>

      <nav className="flex-1 flex flex-col gap-0.5 p-1 pt-1.5 overflow-auto">
        {navItems.map(({ view, icon, label, dividerBefore }) => (
          <div key={view}>
            {dividerBefore && <div className="w-full h-px bg-bg-border my-1" />}
            <button
              onClick={() => onViewChange(view)}
              title={label}
              className={`
                w-full flex items-center justify-center h-8 rounded
                transition-all duration-150 relative
                ${activeView === view
                  ? 'bg-accent-green/10 text-accent-green'
                  : 'text-text-muted hover:text-text-secondary hover:bg-bg-raised'
                }
              `}
            >
              {icon}
              {activeView === view && (
                <span className="absolute left-0 top-1/2 -translate-y-1/2 w-0.5 h-5 bg-accent-green rounded-r" />
              )}
            </button>
          </div>
        ))}
      </nav>

      <div className="p-1 pb-1.5 border-t border-bg-border shrink-0">
        <button
          onClick={() => onViewChange('settings')}
          title="Settings"
          className={`
            w-full flex items-center justify-center h-8 rounded transition-all duration-150
            ${activeView === 'settings'
              ? 'bg-accent-green/10 text-accent-green'
              : 'text-text-muted hover:text-text-secondary hover:bg-bg-raised'
            }
          `}
        >
          <Settings size={17} />
        </button>
      </div>
    </aside>
  )
}
