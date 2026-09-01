import {
  Check,
  ChevronsUpDown,
  Layers,
  LayoutDashboard,
  PanelLeftClose,
  PanelLeftOpen,
  Plus,
  Search,
  Settings2,
  Shapes,
  Sparkles,
  SquareTerminal,
  Waypoints,
} from 'lucide-react'
import { useState, type ComponentType, type ReactNode } from 'react'
import { Link, NavLink, useLocation, useNavigate } from 'react-router-dom'
import { useFeatures, useLenses, useRuntimeSchema } from '@/api/hooks'
import { OntologySwitcher } from '@/components/layout/OntologySwitcher'
import { ThemeToggle } from '@/components/ThemeToggle'
import { TypeDot } from '@/components/TypeChip'
import { Button } from '@/components/ui/button'
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuLabel,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from '@/components/ui/dropdown-menu'
import { Skeleton } from '@/components/ui/skeleton'
import { Tooltip, TooltipContent, TooltipTrigger } from '@/components/ui/tooltip'
import { openQuickAdd } from '@/components/quickadd/quickAddBus'
import { readString, storageKeys, writeString } from '@/lib/storage'
import { cn } from '@/lib/utils'

/* --------------------------------- nav item --------------------------------- */

interface NavItemProps {
  to: string
  label: string
  collapsed: boolean
  icon?: ComponentType<{ className?: string }>
  leading?: ReactNode
  end?: boolean
}

function NavItem({ to, label, collapsed, icon: Icon, leading, end }: NavItemProps) {
  // Active state is computed manually (instead of NavLink's className
  // function) because Radix's Slot (TooltipTrigger asChild) stringifies a
  // function-valued className when merging props.
  const { pathname } = useLocation()
  const isActive = end ? pathname === to : pathname === to || pathname.startsWith(`${to}/`)
  const link = (
    <Link
      to={to}
      aria-current={isActive ? 'page' : undefined}
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

/* ----------------------------- lens switcher ----------------------------- */

function LensSwitcher({
  ontologyKey,
  lensKey,
  collapsed,
}: {
  ontologyKey: string
  lensKey: string
  collapsed: boolean
}) {
  const navigate = useNavigate()
  const { data: lenses } = useLenses(ontologyKey)
  const current = lenses?.find((o) => o.key === lensKey)

  return (
    <DropdownMenu>
      <DropdownMenuTrigger asChild>
        <button
          className={cn(
            'flex h-8 w-full items-center gap-2 rounded-lg px-1.5 text-left',
            'transition-colors duration-100 hover:bg-sidebar-accent/60',
            'focus-visible:outline-2 focus-visible:outline-ring/60',
            collapsed && 'justify-center px-0',
          )}
          aria-label="Switch lens"
        >
          <Layers className="size-4 shrink-0 text-muted-foreground" />
          {!collapsed && (
            <>
              <span className="min-w-0 flex-1">
                <span className="block truncate text-[13px] font-medium leading-tight">
                  {current?.name ?? lensKey}
                </span>
              </span>
              <ChevronsUpDown className="size-3.5 shrink-0 text-muted-foreground" />
            </>
          )}
        </button>
      </DropdownMenuTrigger>
      <DropdownMenuContent align="start" className="w-60">
        <DropdownMenuLabel className="text-[11px] uppercase tracking-wide text-muted-foreground">
          Lens
        </DropdownMenuLabel>
        {(lenses ?? []).map((o) => (
          <DropdownMenuItem
            key={o.lensId}
            onSelect={() => {
              writeString(storageKeys.lastLens(ontologyKey), o.key)
              navigate(`/o/${ontologyKey}/w/${o.key}`)
            }}
            className="gap-2"
          >
            <span className="min-w-0 flex-1">
              <span className="block truncate text-[13px]">{o.name}</span>
              <span className="block truncate font-mono text-[10.5px] text-muted-foreground">
                {o.key}
              </span>
            </span>
            {o.key === lensKey && <Check className="size-4 shrink-0" />}
          </DropdownMenuItem>
        ))}
        <DropdownMenuSeparator />
        <DropdownMenuItem onSelect={() => navigate('/')} className="gap-2">
          <Settings2 className="size-4" />
          Manage…
        </DropdownMenuItem>
      </DropdownMenuContent>
    </DropdownMenu>
  )
}

/* ---------------------------------- sidebar ---------------------------------- */

export function Sidebar({
  ontologyKey,
  lensKey,
  onSearch,
}: {
  ontologyKey: string
  lensKey: string
  /** Opens the Cmd+K search palette (provided by WorkbenchLayout). */
  onSearch?: () => void
}) {
  const [collapsed, setCollapsed] = useState(
    () => readString(storageKeys.sidebar) === 'collapsed',
  )
  const { data: features } = useFeatures()
  const schema = useRuntimeSchema(ontologyKey, lensKey)

  const toggle = () => {
    setCollapsed((prev) => {
      writeString(storageKeys.sidebar, prev ? 'expanded' : 'collapsed')
      return !prev
    })
  }

  const base = `/o/${ontologyKey}/w/${lensKey}`

  return (
    <aside
      className={cn(
        'flex h-full shrink-0 flex-col border-r bg-sidebar text-sidebar-foreground',
        'transition-[width] duration-200 ease-in-out',
        collapsed ? 'w-13' : 'w-60',
      )}
    >
      <div className={cn('flex flex-col gap-1 p-2', collapsed && 'px-1.5')}>
        <OntologySwitcher
          ontologyKey={ontologyKey}
          surface="workbench"
          collapsed={collapsed}
        />
        <LensSwitcher ontologyKey={ontologyKey} lensKey={lensKey} collapsed={collapsed} />
      </div>

      {onSearch !== undefined && (
        <div className={cn('px-2 pb-1', collapsed && 'px-1.5')}>
          {(() => {
            const trigger = (
              <button
                type="button"
                onClick={onSearch}
                aria-label="Search (Cmd+K)"
                className={cn(
                  'flex h-7 w-full items-center gap-2 rounded-md border border-input/60 px-2',
                  'text-[13px] text-muted-foreground transition-colors duration-100',
                  'hover:bg-sidebar-accent/60 hover:text-sidebar-foreground',
                  'focus-visible:outline-2 focus-visible:outline-ring/60',
                  collapsed && 'justify-center border-transparent px-0',
                )}
              >
                <Search className="size-3.5 shrink-0" />
                {!collapsed && (
                  <>
                    <span className="flex-1 text-left">Search…</span>
                    <kbd className="rounded border bg-muted px-1 font-mono text-[10px]">
                      ⌘K
                    </kbd>
                  </>
                )}
              </button>
            )
            if (!collapsed) return trigger
            return (
              <Tooltip>
                <TooltipTrigger asChild>{trigger}</TooltipTrigger>
                <TooltipContent side="right">Search ⌘K</TooltipContent>
              </Tooltip>
            )
          })()}
        </div>
      )}

      <div className={cn('px-2 pb-1', collapsed && 'px-1.5')}>
        {(() => {
          const trigger = (
            <button
              type="button"
              onClick={() => openQuickAdd()}
              aria-label="New entity (c)"
              className={cn(
                'flex h-7 w-full items-center gap-2 rounded-md border border-input/60 px-2',
                'text-[13px] text-muted-foreground transition-colors duration-100',
                'hover:bg-sidebar-accent/60 hover:text-sidebar-foreground',
                'focus-visible:outline-2 focus-visible:outline-ring/60',
                collapsed && 'justify-center border-transparent px-0',
              )}
            >
              <Plus className="size-3.5 shrink-0" />
              {!collapsed && (
                <>
                  <span className="flex-1 text-left">New entity</span>
                  <kbd className="rounded border bg-muted px-1 font-mono text-[10px]">c</kbd>
                </>
              )}
            </button>
          )
          if (!collapsed) return trigger
          return (
            <Tooltip>
              <TooltipTrigger asChild>{trigger}</TooltipTrigger>
              <TooltipContent side="right">New entity — c</TooltipContent>
            </Tooltip>
          )
        })()}
      </div>

      <nav
        className={cn('flex flex-col gap-0.5 px-2 pt-1', collapsed && 'px-1.5')}
        aria-label="Workbench"
      >
        <NavItem to={base} end label="Home" icon={LayoutDashboard} collapsed={collapsed} />
        <NavItem to={`${base}/explore`} label="Explore" icon={Waypoints} collapsed={collapsed} />
        <NavItem to={`${base}/query`} label="Query" icon={SquareTerminal} collapsed={collapsed} />
        {features?.ai !== false && (
          <NavItem to={`${base}/ai`} label="AI" icon={Sparkles} collapsed={collapsed} />
        )}
      </nav>

      <div
        className={cn(
          'mt-4 flex min-h-0 flex-1 flex-col gap-0.5 overflow-y-auto px-2 pb-2',
          collapsed && 'px-1.5',
        )}
      >
        {!collapsed && (
          <div className="px-2 pb-1 text-[10.5px] font-semibold uppercase tracking-wider text-muted-foreground">
            Data
          </div>
        )}
        {collapsed && <div className="mx-2 mb-1 border-t" />}
        {schema.isPending && (
          <div className={cn('space-y-1.5 px-2 py-1', collapsed && 'px-1')}>
            <Skeleton className="h-4 w-full" />
            <Skeleton className="h-4 w-4/5" />
            <Skeleton className="h-4 w-3/5" />
          </div>
        )}
        {schema.data?.entityTypes.map((t) => (
          <NavItem
            key={t.key}
            to={`${base}/t/${t.key}`}
            label={t.displayName}
            leading={<TypeDot typeKey={t.key} className={cn(collapsed && 'size-2.5')} />}
            collapsed={collapsed}
          />
        ))}
        {schema.data !== undefined && schema.data.entityTypes.length === 0 && !collapsed && (
          <p className="px-2 py-1 text-xs text-muted-foreground">
            No entity types in scope.
          </p>
        )}
      </div>

      <div
        className={cn(
          'flex items-center gap-1 border-t p-2',
          collapsed ? 'flex-col px-1.5' : 'flex-row',
        )}
      >
        <Tooltip>
          <TooltipTrigger asChild>
            <Button
              variant="ghost"
              size="icon-sm"
              aria-label={collapsed ? 'Expand sidebar' : 'Collapse sidebar'}
              onClick={toggle}
            >
              {collapsed ? (
                <PanelLeftOpen className="size-4" />
              ) : (
                <PanelLeftClose className="size-4" />
              )}
            </Button>
          </TooltipTrigger>
          <TooltipContent side={collapsed ? 'right' : 'top'}>
            {collapsed ? 'Expand' : 'Collapse'}
          </TooltipContent>
        </Tooltip>
        <ThemeToggle />
        {!collapsed && <span className="flex-1" />}
        <Tooltip>
          <TooltipTrigger asChild>
            <Button variant="ghost" size={collapsed ? 'icon-sm' : 'sm'} asChild>
              <NavLink to={`/o/${ontologyKey}/studio`} aria-label="Open Studio">
                <Shapes className="size-4" />
                {!collapsed && 'Studio'}
              </NavLink>
            </Button>
          </TooltipTrigger>
          <TooltipContent side={collapsed ? 'right' : 'top'}>
            Schema Studio
          </TooltipContent>
        </Tooltip>
      </div>
    </aside>
  )
}
