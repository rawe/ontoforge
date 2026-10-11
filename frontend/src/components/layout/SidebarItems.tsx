import { PanelLeftClose, PanelLeftOpen } from 'lucide-react'
import type { ComponentType, ReactNode } from 'react'
import { Link, useLocation } from 'react-router-dom'
import { Button } from '@/components/ui/button'
import { Tooltip, TooltipContent, TooltipTrigger } from '@/components/ui/tooltip'
import { cn } from '@/lib/utils'
import { useSidebarCollapsed, useSidebarShortcut } from './sidebarCollapsed'

/** Pieces shared by the Workbench and the Studio sidebar. */

interface NavItemProps {
  to: string
  label: string
  collapsed: boolean
  icon?: ComponentType<{ className?: string }>
  leading?: ReactNode
  end?: boolean
}

export function NavItem({ to, label, collapsed, icon: Icon, leading, end }: NavItemProps) {
  // Active state is computed manually (instead of NavLink's className
  // function) because Radix's Slot (TooltipTrigger asChild) stringifies a
  // function-valued className when merging props.
  const { pathname } = useLocation()
  const isActive = end ? pathname === to : pathname === to || pathname.startsWith(`${to}/`)
  const link = (
    <Link
      to={to}
      aria-current={isActive ? 'page' : undefined}
      aria-label={collapsed ? label : undefined}
      className={cn(
        'flex h-7 items-center gap-2.5 rounded-md px-2 text-[13px] font-medium',
        'text-sidebar-foreground/65 transition-colors duration-100',
        'hover:bg-sidebar-accent/60 hover:text-sidebar-foreground',
        'focus-visible:outline-2 focus-visible:outline-ring/60',
        isActive && 'bg-sidebar-accent text-sidebar-foreground',
        collapsed && 'justify-center px-0',
      )}
    >
      {Icon !== undefined ? <Icon className="size-4 shrink-0" /> : leading}
      {!collapsed && <span className="truncate">{label}</span>}
    </Link>
  )
  if (!collapsed) return link
  return (
    <Tooltip>
      <TooltipTrigger asChild>{link}</TooltipTrigger>
      <TooltipContent side="right">{label}</TooltipContent>
    </Tooltip>
  )
}

/** The footer's collapse button; it also registers the `[` key for its surface. */
export function SidebarToggle() {
  const { collapsed, toggle } = useSidebarCollapsed()
  useSidebarShortcut()
  const label = collapsed ? 'Expand sidebar' : 'Collapse sidebar'
  return (
    <Tooltip>
      <TooltipTrigger asChild>
        <Button variant="ghost" size="icon-sm" aria-label={label} onClick={toggle}>
          {collapsed ? <PanelLeftOpen className="size-4" /> : <PanelLeftClose className="size-4" />}
        </Button>
      </TooltipTrigger>
      <TooltipContent side={collapsed ? 'right' : 'top'}>{label} ([)</TooltipContent>
    </Tooltip>
  )
}
