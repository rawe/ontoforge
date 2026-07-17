import { SearchX } from 'lucide-react'
import { useEffect, useState } from 'react'
import { Link, Outlet, useParams } from 'react-router-dom'
import { useRuntimeSchema } from '@/api/hooks'
import { ApiError } from '@/api/http'
import { EmptyState } from '@/components/EmptyState'
import { Sidebar } from '@/components/layout/Sidebar'
import { SearchPalette } from '@/components/palette/SearchPalette'
import { QuickAddDialog } from '@/components/quickadd/QuickAddDialog'
import { Button } from '@/components/ui/button'
import { remove, storageKeys, writeString } from '@/lib/storage'

/** Shell for all `/w/:ontologyKey/...` routes: sidebar + scrolling content. */
export function WorkbenchLayout() {
  const { ontologyKey } = useParams<{ ontologyKey: string }>()
  const schema = useRuntimeSchema(ontologyKey)
  const [paletteOpen, setPaletteOpen] = useState(false)

  const notFound = schema.error instanceof ApiError && schema.error.status === 404

  useEffect(() => {
    if (ontologyKey !== undefined && !notFound) {
      writeString(storageKeys.lastOntology, ontologyKey)
    }
  }, [ontologyKey, notFound])

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

  if (ontologyKey === undefined) return null

  if (notFound) {
    return (
      <div className="flex h-dvh items-center justify-center">
        <EmptyState
          icon={SearchX}
          title="Ontology not found"
          description={`No ontology with key "${ontologyKey}" exists on this server.`}
          action={
            <Button asChild size="sm" onClick={() => remove(storageKeys.lastOntology)}>
              <Link to="/welcome">Pick an ontology</Link>
            </Button>
          }
        />
      </div>
    )
  }

  return (
    <div className="flex h-dvh overflow-hidden bg-background">
      <Sidebar ontologyKey={ontologyKey} onSearch={() => setPaletteOpen(true)} />
      <main className="min-w-0 flex-1 overflow-y-auto">
        <Outlet />
      </main>
      <SearchPalette
        ontologyKey={ontologyKey}
        open={paletteOpen}
        onOpenChange={setPaletteOpen}
      />
      <QuickAddDialog ontologyKey={ontologyKey} />
    </div>
  )
}
