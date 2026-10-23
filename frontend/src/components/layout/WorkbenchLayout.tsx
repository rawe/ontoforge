import { SearchX } from 'lucide-react'
import { useEffect, useState } from 'react'
import { Link, Outlet, useParams } from 'react-router-dom'
import { useLenses, useOntologies, useRuntimeSchema } from '@/api/hooks'
import { ApiError } from '@/api/http'
import { NoAccess } from '@/components/auth/NoAccess'
import { useAccess } from '@/components/auth/useAccess'
import { EmptyState } from '@/components/EmptyState'
import { ChangesetBar } from '@/components/changesets/ChangesetBar'
import { Sidebar } from '@/components/layout/Sidebar'
import { STUDIO_ICON } from '@/components/layout/surfaceTargets'
import { useDocumentTitle } from '@/components/layout/useDocumentTitle'
import { SearchPalette } from '@/components/palette/SearchPalette'
import { QuickAddDialog } from '@/components/quickadd/QuickAddDialog'
import { Button } from '@/components/ui/button'
import { remove, storageKeys, writeString } from '@/lib/storage'

/**
 * Shell for all `/o/:ontologyKey/w/:lensKey/...` routes: sidebar + scrolling
 * content, under the pinned changeset's bar while one is pinned.
 */
export function WorkbenchLayout() {
  const { ontologyKey, lensKey } = useParams<{ ontologyKey: string; lensKey: string }>()
  const schema = useRuntimeSchema(ontologyKey, lensKey)
  const [paletteOpen, setPaletteOpen] = useState(false)

  const notFound = schema.error instanceof ApiError && schema.error.status === 404
  // The lens list tells an unknown ontology (404) from an unknown lens in it.
  const lenses = useLenses(notFound ? ontologyKey : undefined)
  const ontologyMissing = lenses.error instanceof ApiError && lenses.error.status === 404
  const { data: ontologies } = useOntologies()
  const access = useAccess()
  const ontologyName = ontologies?.find((o) => o.key === ontologyKey)?.displayName ?? ontologyKey
  useDocumentTitle(
    schema.data === undefined ? undefined : `${schema.data.lens.name} · Workbench · ${ontologyName}`,
  )

  // Remember the lens only once its schema loaded; the not-found state forgets the remembered lens.
  const loaded = schema.data !== undefined
  useEffect(() => {
    if (ontologyKey === undefined || lensKey === undefined) return
    if (loaded) writeString(storageKeys.lastLens(ontologyKey), lensKey)
    else if (notFound) remove(storageKeys.lastLens(ontologyKey))
  }, [ontologyKey, lensKey, loaded, notFound])

  // Global Cmd/Ctrl+K toggles the search palette from anywhere.
  useEffect(() => {
    const onKeyDown = (e: KeyboardEvent) => {
      if ((e.metaKey || e.ctrlKey) && e.key.toLowerCase() === 'k') {
        e.preventDefault()
        setPaletteOpen((open) => !open)
      }
    }
    window.addEventListener('keydown', onKeyDown)
    return () => window.removeEventListener('keydown', onKeyDown)
  }, [])

  // Programmatic open (e.g. the Explorer canvas' "Search entities" CTA).
  useEffect(() => {
    const onOpen = () => setPaletteOpen(true)
    window.addEventListener('of:open-palette', onOpen)
    return () => window.removeEventListener('of:open-palette', onOpen)
  }, [])

  if (ontologyKey === undefined || lensKey === undefined) return null

  if (!access.canRead(ontologyKey, lensKey)) {
    return (
      <NoAccess
        title="No access to this lens"
        description={`You hold no Reader or Writer role on lens "${lensKey}" of ontology "${ontologyKey}".`}
      />
    )
  }

  if (notFound) {
    // Wait for the lens list before telling the ontology from the lens apart.
    if (lenses.isPending) return null
    return (
      <div className="flex h-dvh items-center justify-center">
        <EmptyState
          icon={SearchX}
          title={ontologyMissing ? 'Ontology not found' : 'Lens not found'}
          description={
            ontologyMissing
              ? `No ontology with key "${ontologyKey}" exists on this server.`
              : `Ontology "${ontologyKey}" has no lens with key "${lensKey}".`
          }
          action={
            <div className="flex flex-wrap justify-center gap-2">
              {!ontologyMissing && access.canDesign(ontologyKey) && (
                <Button asChild size="sm">
                  <Link to={`/o/${ontologyKey}/studio/lenses`}>
                    <STUDIO_ICON className="size-3.5" /> Open its lenses in the Studio
                  </Link>
                </Button>
              )}
              <Button asChild size="sm" variant={ontologyMissing ? 'default' : 'outline'}>
                <Link to="/">Go to ontologies</Link>
              </Button>
            </div>
          }
        />
      </div>
    )
  }

  return (
    <div className="flex h-dvh overflow-hidden bg-background">
      <Sidebar
        ontologyKey={ontologyKey}
        lensKey={lensKey}
        onSearch={() => setPaletteOpen(true)}
      />
      <main className="flex min-w-0 flex-1 flex-col">
        <ChangesetBar ontologyKey={ontologyKey} lensKey={lensKey} />
        <div className="min-h-0 flex-1 overflow-y-auto">
          <Outlet />
        </div>
      </main>
      <SearchPalette
        ontologyKey={ontologyKey}
        lensKey={lensKey}
        open={paletteOpen}
        onOpenChange={setPaletteOpen}
      />
      <QuickAddDialog ontologyKey={ontologyKey} lensKey={lensKey} />
    </div>
  )
}
