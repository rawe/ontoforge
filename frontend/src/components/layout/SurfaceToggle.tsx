import type { ComponentType, ReactNode } from 'react'
import { Link } from 'react-router-dom'
import { Tooltip, TooltipContent, TooltipTrigger } from '@/components/ui/tooltip'
import { cn } from '@/lib/utils'
import {
  STUDIO_ICON,
  WORKBENCH_ICON,
  useStudioTarget,
  useWorkbenchTarget,
  type Target,
} from './surfaceTargets'

/* --------------------------------- toggle ---------------------------------- */

function Segment({
  label,
  icon: Icon,
  active,
  target,
  collapsed,
}: {
  label: string
  icon: ComponentType<{ className?: string }>
  active: boolean
  target: Target | null
  collapsed: boolean
}) {
  const className = cn(
    'flex h-7 items-center justify-center gap-1.5 rounded-md text-[12.5px] font-medium',
    'transition-colors duration-100 focus-visible:outline-2 focus-visible:outline-ring/60',
    active
      ? 'bg-primary text-primary-foreground shadow-xs'
      : 'text-sidebar-foreground/65 hover:bg-sidebar-accent hover:text-sidebar-foreground',
    target?.unavailable && 'opacity-60',
    collapsed && 'size-8',
  )
  const content = (
    <>
      <Icon className="size-3.5 shrink-0" />
      {!collapsed && label}
    </>
  )
  const element =
    active || target === null ? (
      // The current surface, or the other one while its target still resolves.
      <span
        className={className}
        aria-current={active ? 'true' : undefined}
        aria-disabled={active ? undefined : 'true'}
        aria-label={collapsed ? label : undefined}
      >
        {content}
      </span>
    ) : (
      <Link
        to={target.to}
        state={target.state}
        className={className}
        aria-label={collapsed ? label : undefined}
      >
        {content}
      </Link>
    )
  if ((active && !collapsed) || (!active && target === null)) return element
  return (
    <Tooltip>
      <TooltipTrigger asChild>{element}</TooltipTrigger>
      <TooltipContent side={collapsed ? 'right' : 'bottom'}>
        {active ? `${label} — you are here` : target?.hint}
      </TooltipContent>
    </Tooltip>
  )
}

/**
 * The Studio | Workbench switch beneath the ontology switcher of both
 * sidebars: the current surface is filled, the other one leads to its
 * equivalent of the current page.
 */
export function SurfaceToggle(
  props: { ontologyKey: string; collapsed: boolean } & (
    | { surface: 'studio' }
    | { surface: 'workbench'; lensKey: string }
  ),
) {
  return props.surface === 'studio' ? (
    <StudioSideToggle ontologyKey={props.ontologyKey} collapsed={props.collapsed} />
  ) : (
    <WorkbenchSideToggle
      ontologyKey={props.ontologyKey}
      lensKey={props.lensKey}
      collapsed={props.collapsed}
    />
  )
}

function StudioSideToggle({ ontologyKey, collapsed }: { ontologyKey: string; collapsed: boolean }) {
  const workbench = useWorkbenchTarget(ontologyKey)
  return (
    <ToggleFrame collapsed={collapsed}>
      <Segment label="Studio" icon={STUDIO_ICON} active target={null} collapsed={collapsed} />
      <Segment
        label="Workbench"
        icon={WORKBENCH_ICON}
        active={false}
        target={workbench}
        collapsed={collapsed}
      />
    </ToggleFrame>
  )
}

function WorkbenchSideToggle({
  ontologyKey,
  lensKey,
  collapsed,
}: {
  ontologyKey: string
  lensKey: string
  collapsed: boolean
}) {
  const studio = useStudioTarget(ontologyKey, lensKey)
  return (
    <ToggleFrame collapsed={collapsed}>
      <Segment label="Studio" icon={STUDIO_ICON} active={false} target={studio} collapsed={collapsed} />
      <Segment label="Workbench" icon={WORKBENCH_ICON} active target={null} collapsed={collapsed} />
    </ToggleFrame>
  )
}

function ToggleFrame({ collapsed, children }: { collapsed: boolean; children: ReactNode }) {
  return (
    <div
      role="group"
      aria-label="Surface"
      className={cn(
        'rounded-lg bg-sidebar-accent/50 p-0.5',
        collapsed ? 'flex flex-col items-center gap-0.5' : 'grid grid-cols-2 gap-0.5',
      )}
    >
      {children}
    </div>
  )
}
