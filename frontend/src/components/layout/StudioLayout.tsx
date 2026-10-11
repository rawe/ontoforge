import { ArrowLeftRight, ArrowLeft, Layers, Search, SearchX, Shapes } from 'lucide-react'
import { useEffect } from 'react'
import { Link, NavLink, Outlet, useParams } from 'react-router-dom'
import { useLenses } from '@/api/hooks'
import { ApiError } from '@/api/http'
import { EmptyState } from '@/components/EmptyState'
import { OntologySwitcher } from '@/components/layout/OntologySwitcher'
import { useSidebarCollapsed } from '@/components/layout/sidebarCollapsed'
import { NavItem, SidebarToggle } from '@/components/layout/SidebarItems'
import { ThemeToggle } from '@/components/ThemeToggle'
import { Button } from '@/components/ui/button'
import { Tooltip, TooltipContent, TooltipTrigger } from '@/components/ui/tooltip'
import { readString, remove, storageKeys } from '@/lib/storage'
import { cn } from '@/lib/utils'

/** Shell for all `/o/:ontologyKey/studio/...` routes — the modeling surface. */
export function StudioLayout() {
  const { ontologyKey } = useParams<{ ontologyKey: string }>()
  const { collapsed } = useSidebarCollapsed()
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
      <aside
        className={cn(
          'flex h-full shrink-0 flex-col border-r bg-sidebar text-sidebar-foreground',
          'transition-[width] duration-200 ease-in-out',
          collapsed ? 'w-13' : 'w-60',
        )}
      >
        <div className={cn('p-2', collapsed && 'px-1.5')}>
          <OntologySwitcher ontologyKey={ontologyKey} surface="studio" collapsed={collapsed} />
        </div>
        {collapsed ? (
          <div className="mx-3.5 mb-1 border-t" />
        ) : (
          <div className="px-3.5 pb-1 text-[10.5px] font-medium uppercase tracking-wider text-primary">
            Studio
          </div>
        )}
        <nav className={cn('flex flex-col gap-0.5 px-2 pt-1', collapsed && 'px-1.5')} aria-label="Studio">
          <NavItem to={`${base}/schema`} label="Schema" icon={Shapes} collapsed={collapsed} />
          <NavItem to={`${base}/lenses`} label="Lenses" icon={Layers} collapsed={collapsed} />
          <NavItem to={`${base}/search`} label="Search" icon={Search} collapsed={collapsed} />
          <NavItem to={`${base}/transfer`} label="Transfer" icon={ArrowLeftRight} collapsed={collapsed} />
        </nav>
        <div className="flex-1" />
        <div
          className={cn(
            'flex items-center gap-1 border-t p-2',
            collapsed ? 'flex-col px-1.5' : 'flex-row',
          )}
        >
          <SidebarToggle />
          <ThemeToggle />
          {collapsed ? (
            <Tooltip>
              <TooltipTrigger asChild>
                <Button variant="ghost" size="icon-sm" asChild>
                  <NavLink to={backTo} aria-label="Workbench">
                    <ArrowLeft className="size-4" />
                  </NavLink>
                </Button>
              </TooltipTrigger>
              <TooltipContent side="right">Workbench</TooltipContent>
            </Tooltip>
          ) : (
            <>
              <span className="flex-1" />
              <Button variant="ghost" size="sm" asChild>
                <NavLink to={backTo}>
                  <ArrowLeft className="size-4" />
                  Workbench
                </NavLink>
              </Button>
            </>
          )}
        </div>
      </aside>
      <main className="min-w-0 flex-1 overflow-y-auto">
        <Outlet />
      </main>
    </div>
  )
}
