import { ArrowLeftRight, Layers, Search, SearchX, Shapes, ShieldCheck } from 'lucide-react'
import { useEffect } from 'react'
import { Link, Outlet, useParams } from 'react-router-dom'
import { AssistantPanelHost, AssistantPanelToggle } from '@/assistants'
import { useLenses, useOntologies } from '@/api/hooks'
import { ApiError } from '@/api/http'
import { NoAccess } from '@/components/auth/NoAccess'
import { useAccess } from '@/components/auth/useAccess'
import { EmptyState } from '@/components/EmptyState'
import { OntologySwitcher } from '@/components/layout/OntologySwitcher'
import { useSidebarCollapsed } from '@/components/layout/sidebarCollapsed'
import { NavItem, SidebarToggle } from '@/components/layout/SidebarItems'
import { SurfaceToggle } from '@/components/layout/SurfaceToggle'
import { useDocumentTitle } from '@/components/layout/useDocumentTitle'
import { ThemeToggle } from '@/components/ThemeToggle'
import { UserMenu } from '@/components/auth/UserMenu'
import { Button } from '@/components/ui/button'
import { readString, remove, storageKeys } from '@/lib/storage'
import { cn } from '@/lib/utils'

/** Shell for all `/o/:ontologyKey/studio/...` routes — the modeling surface, with the assistant panel beside it. */
export function StudioLayout() {
  const { ontologyKey } = useParams<{ ontologyKey: string }>()
  const { collapsed } = useSidebarCollapsed()
  const access = useAccess()
  // The lens list answers 404 for an unknown ontology and validates the remembered lens.
  const lenses = useLenses(ontologyKey)
  const notFound = lenses.error instanceof ApiError && lenses.error.status === 404
  const remembered = ontologyKey === undefined ? null : readString(storageKeys.lastLens(ontologyKey))
  // A remembered lens that no longer exists (deleted, or never valid) is forgotten, not offered.
  const stale = remembered !== null && (notFound || (lenses.data !== undefined && !lenses.data.some((l) => l.key === remembered)))
  useEffect(() => {
    if (ontologyKey !== undefined && stale) remove(storageKeys.lastLens(ontologyKey))
  }, [ontologyKey, stale])
  const { data: ontologies } = useOntologies()
  const ontology = ontologies?.find((o) => o.key === ontologyKey)
  useDocumentTitle(ontology === undefined ? undefined : `Studio · ${ontology.displayName ?? ontology.key}`)

  if (ontologyKey === undefined) return null

  if (!access.canDesign(ontologyKey)) {
    return (
      <NoAccess
        title="No access to the Studio"
        description={`Designing ontology "${ontologyKey}" needs its Ontology Administrator role.`}
      />
    )
  }

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

  return (
    <div className="relative flex h-dvh overflow-hidden bg-background">
      <AssistantPanelHost binding={{ ontologyKey, lensKey: null }}>
        <aside
          className={cn(
            'flex h-full shrink-0 flex-col border-r bg-sidebar text-sidebar-foreground',
            'transition-[width] duration-200 ease-in-out',
            collapsed ? 'w-13' : 'w-60',
          )}
        >
          <div className={cn('flex flex-col gap-1.5 p-2', collapsed && 'px-1.5')}>
            <OntologySwitcher ontologyKey={ontologyKey} surface="studio" collapsed={collapsed} />
            <SurfaceToggle ontologyKey={ontologyKey} surface="studio" collapsed={collapsed} />
          </div>
          <nav className={cn('flex flex-col gap-0.5 px-2 pt-1', collapsed && 'px-1.5')} aria-label="Studio">
            <NavItem to={`${base}/schema`} label="Schema" icon={Shapes} collapsed={collapsed} />
            <NavItem to={`${base}/lenses`} label="Lenses" icon={Layers} collapsed={collapsed} />
            <NavItem to={`${base}/search`} label="Search" icon={Search} collapsed={collapsed} />
            <NavItem to={`${base}/transfer`} label="Transfer" icon={ArrowLeftRight} collapsed={collapsed} />
            {access.authentication && (
              <NavItem to={`${base}/access`} label="Access" icon={ShieldCheck} collapsed={collapsed} />
            )}
          </nav>
          <div className="flex-1" />
          <div className={cn('px-2 pb-2 empty:hidden', collapsed && 'px-1.5')}>
            <AssistantPanelToggle collapsed={collapsed} />
          </div>
          <div
            className={cn(
              'flex items-center gap-1 border-t p-2',
              collapsed ? 'flex-col px-1.5' : 'flex-row',
            )}
          >
            <SidebarToggle />
            <ThemeToggle />
            <UserMenu />
          </div>
        </aside>
        <main className="min-w-0 flex-1 overflow-y-auto">
          <Outlet />
        </main>
      </AssistantPanelHost>
    </div>
  )
}
