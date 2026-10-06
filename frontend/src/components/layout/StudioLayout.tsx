import { ArrowLeftRight, ArrowLeft, Layers, Search, SearchX, Shapes } from 'lucide-react'
import { useEffect, type ComponentType } from 'react'
import { Link, NavLink, Outlet, useParams } from 'react-router-dom'
import { useFeatures, useLenses } from '@/api/hooks'
import { ApiError } from '@/api/http'
import { EmptyState } from '@/components/EmptyState'
import { OntologySwitcher } from '@/components/layout/OntologySwitcher'
import { ThemeToggle } from '@/components/ThemeToggle'
import { Button } from '@/components/ui/button'
import { readString, remove, storageKeys } from '@/lib/storage'
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
  const { data: features } = useFeatures()
  // The lens list answers 404 for an unknown ontology and validates the remembered lens.
  const lenses = useLenses(ontologyKey)
  const notFound = lenses.error instanceof ApiError && lenses.error.status === 404
  const remembered = ontologyKey === undefined ? null : readString(storageKeys.lastLens(ontologyKey))
  // A remembered lens that no longer exists (deleted, or never valid) is forgotten, not offered.
  const stale = remembered !== null && (notFound || (lenses.data !== undefined && !lenses.data.some((l) => l.key === remembered)))
  useEffect(() => {
    if (ontologyKey !== undefined && stale) remove(storageKeys.lastLens(ontologyKey))
  }, [ontologyKey, stale])

  if (ontologyKey === undefined) return null

  if (notFound) {
    return (
      <div className="flex h-dvh items-center justify-center">
        <EmptyState
          icon={SearchX}
          title="Ontology not found"
          description={`No ontology with key "${ontologyKey}" exists on this server.`}
          action={
            <Button asChild size="sm">
              <Link to="/">Go to ontologies</Link>
            </Button>
          }
        />
      </div>
    )
  }

  const base = `/o/${ontologyKey}/studio`
  // Back to this ontology's workbench: its remembered last-used lens, or
  // the start page when none is remembered (a lens-less ontology has no
  // workbench to return to).
  const backTo = remembered === null || stale ? '/' : `/o/${ontologyKey}/w/${remembered}`

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
          {/* Optimistic: hidden only once the server reports no search indices. */}
          {features?.searchIndices !== false && (
            <StudioNavItem to={`${base}/search`} label="Search" icon={Search} />
          )}
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
