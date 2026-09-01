import { ArrowLeftRight, ArrowLeft, Layers, Shapes } from 'lucide-react'
import type { ComponentType } from 'react'
import { NavLink, Outlet, useParams } from 'react-router-dom'
import { OntologySwitcher } from '@/components/layout/OntologySwitcher'
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

/** Shell for all `/o/:ontologyKey/studio/...` routes — the modeling surface. */
export function StudioLayout() {
  const { ontologyKey } = useParams<{ ontologyKey: string }>()
  if (ontologyKey === undefined) return null

  const base = `/o/${ontologyKey}/studio`
  // Back to this ontology's workbench: its remembered last-used lens, or
  // the start page when none is remembered (a lens-less ontology has no
  // workbench to return to).
  const lastLens = readString(storageKeys.lastLens(ontologyKey))
  const backTo = lastLens === null ? '/' : `/o/${ontologyKey}/w/${lastLens}`

  return (
    <div className="flex h-dvh overflow-hidden bg-background">
      <aside className="flex h-full w-60 shrink-0 flex-col border-r bg-sidebar text-sidebar-foreground">
        <div className="p-2">
          <OntologySwitcher ontologyKey={ontologyKey} surface="studio" />
        </div>
        <div className="px-3.5 pb-1 text-[10.5px] font-medium uppercase tracking-wider text-primary">
          Studio
        </div>
        <nav className="flex flex-col gap-0.5 px-2 pt-1" aria-label="Studio">
          <StudioNavItem to={base} end label="Schema" icon={Shapes} />
          <StudioNavItem to={`${base}/lenses`} label="Lenses" icon={Layers} />
          <StudioNavItem to={`${base}/transfer`} label="Transfer" icon={ArrowLeftRight} />
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
