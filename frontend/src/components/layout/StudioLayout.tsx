import { ArrowLeftRight, ArrowLeft, Layers, Shapes } from 'lucide-react'
import type { ComponentType } from 'react'
import { NavLink, Outlet } from 'react-router-dom'
import { Logo } from '@/components/Logo'
import { ThemeToggle } from '@/components/ThemeToggle'
import { Button } from '@/components/ui/button'
import { readString, storageKeys } from '@/lib/storage'
import { cn } from '@/lib/utils'

function StudioNavItem({
  to,
  label,
  icon: Icon,
  end,
}: {
  to: string
  label: string
  icon: ComponentType<{ className?: string }>
  end?: boolean
}) {
  return (
    <NavLink
      to={to}
      end={end}
      className={({ isActive }) =>
        cn(
          'flex h-7 items-center gap-2.5 rounded-md px-2 text-[13px] font-medium',
          'text-sidebar-foreground/65 transition-colors duration-100',
          'hover:bg-sidebar-accent/60 hover:text-sidebar-foreground',
          'focus-visible:outline-2 focus-visible:outline-ring/60',
          isActive && 'bg-sidebar-accent text-sidebar-foreground',
        )
      }
    >
      <Icon className="size-4 shrink-0" />
      <span className="truncate">{label}</span>
    </NavLink>
  )
}

/** Shell for all `/studio/...` routes — the modeling surface. */
export function StudioLayout() {
  const lastOntology = readString(storageKeys.lastOntology)
  const backTo = lastOntology === null ? '/welcome' : `/w/${lastOntology}`

  return (
    <div className="flex h-dvh overflow-hidden bg-background">
      <aside className="flex h-full w-60 shrink-0 flex-col border-r bg-sidebar text-sidebar-foreground">
        <div className="flex h-13 items-center gap-2 px-3.5">
          <Logo className="size-6 rounded-md" />
          <div className="min-w-0">
            <div className="truncate text-[13px] font-semibold leading-tight">OntoForge</div>
            <div className="text-[10.5px] font-medium uppercase tracking-wider text-primary">
              Studio
            </div>
          </div>
        </div>
        <nav className="flex flex-col gap-0.5 px-2 pt-1" aria-label="Studio">
          <StudioNavItem to="/studio" end label="Schema" icon={Shapes} />
          <StudioNavItem to="/studio/ontologies" label="Ontologies" icon={Layers} />
          <StudioNavItem to="/studio/transfer" label="Transfer" icon={ArrowLeftRight} />
        </nav>
        <div className="flex-1" />
        <div className="flex items-center gap-1 border-t p-2">
          <ThemeToggle />
          <span className="flex-1" />
          <Button variant="ghost" size="sm" asChild>
            <NavLink to={backTo}>
              <ArrowLeft className="size-4" />
              Workbench
            </NavLink>
          </Button>
        </div>
      </aside>
      <main className="min-w-0 flex-1 overflow-y-auto">
        <Outlet />
      </main>
    </div>
  )
}
