import { ArrowRight, Layers, Plus } from 'lucide-react'
import { Link, useNavigate } from 'react-router-dom'
import { useOntologies, useOntologyScope, useRuntimeSchema } from '@/api/hooks'
import { EmptyState } from '@/components/EmptyState'
import { Logo } from '@/components/Logo'
import { Badge } from '@/components/ui/badge'
import { Button } from '@/components/ui/button'
import { Skeleton } from '@/components/ui/skeleton'
import { storageKeys, writeString } from '@/lib/storage'
import type { Ontology } from '@/api/types'

function OntologyCard({ ontology }: { ontology: Ontology }) {
  const navigate = useNavigate()
  const schema = useRuntimeSchema(ontology.key)
  const scope = useOntologyScope(ontology.ontologyId)

  return (
    <button
      onClick={() => {
        writeString(storageKeys.lastOntology, ontology.key)
        navigate(`/w/${ontology.key}`)
      }}
      className="group flex flex-col gap-3 rounded-xl border bg-card p-5 text-left transition-all duration-150 hover:border-ring/40 hover:shadow-[0_0_0_3px] hover:shadow-ring/10 focus-visible:outline-2 focus-visible:outline-ring/60"
    >
      <div className="flex w-full items-start justify-between gap-3">
        <div className="min-w-0">
          <div className="truncate text-sm font-semibold tracking-tight">{ontology.name}</div>
          <div className="mt-0.5 truncate font-mono text-[11px] text-muted-foreground">
            {ontology.key}
          </div>
        </div>
        <ArrowRight className="mt-1 size-4 shrink-0 text-muted-foreground opacity-0 transition-all duration-150 group-hover:translate-x-0.5 group-hover:opacity-100" />
      </div>
      {ontology.description !== null && ontology.description !== '' && (
        <p className="line-clamp-2 text-[13px] leading-snug text-muted-foreground">
          {ontology.description}
        </p>
      )}
      <div className="mt-auto flex items-center gap-2 pt-1">
        {schema.data === undefined ? (
          <Skeleton className="h-5 w-32" />
        ) : (
          <>
            <Badge variant="secondary" className="font-normal">
              {schema.data.entityTypes.length} entity{' '}
              {schema.data.entityTypes.length === 1 ? 'type' : 'types'}
            </Badge>
            <Badge variant="secondary" className="font-normal">
              {schema.data.relationTypes.length} relation{' '}
              {schema.data.relationTypes.length === 1 ? 'type' : 'types'}
            </Badge>
            {scope.data !== undefined && (
              <Badge variant="outline" className="ml-auto font-normal text-muted-foreground">
                {scope.data.scoped ? 'Scoped' : 'Unscoped'}
              </Badge>
            )}
          </>
        )}
      </div>
    </button>
  )
}

/** `/welcome` — ontology picker; the app's first impression. */
export function WelcomePage() {
  const { data: ontologies, isPending, isError, error } = useOntologies()

  return (
    <div className="flex min-h-dvh flex-col items-center bg-background px-6 py-16">
      <div className="w-full max-w-3xl">
        <div className="flex flex-col items-center gap-4 text-center">
          <Logo className="size-14 rounded-2xl shadow-lg shadow-primary/10" />
          <div>
            <h1 className="text-2xl font-semibold tracking-tight">OntoForge</h1>
            <p className="mt-1.5 text-sm text-muted-foreground">
              Pick an ontology to open its workbench — a lens over your knowledge graph.
            </p>
          </div>
        </div>

        <div className="mt-12">
          {isPending && (
            <div className="grid gap-4 sm:grid-cols-2">
              <Skeleton className="h-36 rounded-xl" />
              <Skeleton className="h-36 rounded-xl" />
            </div>
          )}

          {isError && (
            <EmptyState
              icon={Layers}
              title="Could not load ontologies"
              description={error.message}
              action={
                <Button size="sm" variant="outline" onClick={() => location.reload()}>
                  Retry
                </Button>
              }
            />
          )}

          {ontologies !== undefined && ontologies.length === 0 && (
            <EmptyState
              icon={Layers}
              title="No ontologies yet"
              description="Create your first ontology in the Studio to start modeling and capturing knowledge."
              action={
                <Button size="sm" asChild>
                  <Link to="/studio/ontologies">
                    <Plus className="size-4" />
                    Create ontology
                  </Link>
                </Button>
              }
            />
          )}

          {ontologies !== undefined && ontologies.length > 0 && (
            <div className="grid gap-4 sm:grid-cols-2">
              {ontologies.map((o) => (
                <OntologyCard key={o.ontologyId} ontology={o} />
              ))}
              <Link
                to="/studio/ontologies"
                className="flex min-h-36 flex-col items-center justify-center gap-2 rounded-xl border border-dashed p-5 text-muted-foreground transition-colors duration-150 hover:border-ring/40 hover:text-foreground focus-visible:outline-2 focus-visible:outline-ring/60"
              >
                <Plus className="size-5" />
                <span className="text-[13px] font-medium">Create ontology</span>
              </Link>
            </div>
          )}
        </div>

        <p className="mt-16 text-center text-xs text-muted-foreground">
          Schema and data live together in one graph database · manage the global schema in the{' '}
          <Link to="/studio" className="font-medium text-foreground/80 underline-offset-4 hover:underline">
            Studio
          </Link>
        </p>
      </div>
    </div>
  )
}
