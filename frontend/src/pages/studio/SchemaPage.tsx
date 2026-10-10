import { lazy, Suspense, useEffect, useState } from 'react'
import { useMutation } from '@tanstack/react-query'
import { Box, PanelTop, Plus, SearchX, ShieldCheck, Waypoints } from 'lucide-react'
import { useParams } from 'react-router-dom'
import * as model from '@/api/model'
import type { ValidationResult } from '@/api/types'
import { EmptyState } from '@/components/EmptyState'
import { PageHeader } from '@/components/PageHeader'
import {
  EntityTypeCreateDialog,
  RelationTypeCreateDialog,
} from '@/components/studio/TypeCreateDialogs'
import { ValidationPanel } from '@/components/studio/ValidationPanel'
import { toastError } from '@/components/studio/lib'
import { CascadeProvider } from '@/components/studio/modeling/CascadeProvider'
import { DeleteProvider } from '@/components/studio/modeling/DeleteDialog'
import { useModelSchema } from '@/components/studio/modeling/useModelSchema'
import { ClassicList } from '@/components/studio/schema/ClassicList'
import { ClassicTypePage } from '@/components/studio/schema/ClassicTypePage'
import type { SchemaView } from '@/components/studio/schema/schemaUrl'
import { SchemaWorkspaceProvider } from '@/components/studio/schema/workspace'
import { useSchemaWorkspace } from '@/components/studio/schema/workspaceContext'
import { Button } from '@/components/ui/button'
import { Skeleton } from '@/components/ui/skeleton'
import { Tabs, TabsList, TabsTrigger } from '@/components/ui/tabs'
import { Tooltip, TooltipContent, TooltipTrigger } from '@/components/ui/tooltip'
import { isPlainKey, isTyping, overlayOpen } from '@/lib/shortcuts'

// React Flow loads only when the graph is shown.
const SchemaCanvas = lazy(() =>
  import('@/components/studio/graph/SchemaCanvas').then((m) => ({ default: m.SchemaCanvas })),
)

/**
 * `/o/:ontologyKey/studio/schema/…` — the schema page: Graph (default) or
 * Classic, one page for every schema address so switching views keeps the
 * shell. View and selection come from the address (`schemaUrl.ts`).
 */
export function SchemaPage() {
  const { ontologyKey } = useParams<{ ontologyKey: string }>()
  if (ontologyKey === undefined) return null
  return (
    <SchemaWorkspaceProvider key={ontologyKey} ontologyKey={ontologyKey}>
      <CascadeProvider>
        <SchemaShell ontologyKey={ontologyKey} />
      </CascadeProvider>
    </SchemaWorkspaceProvider>
  )
}

function SchemaShell({ ontologyKey }: { ontologyKey: string }) {
  const { view, selection, select, switchView } = useSchemaWorkspace()
  const schema = useModelSchema(ontologyKey)
  const [validation, setValidation] = useState<ValidationResult | null>(null)
  const [createEntityOpen, setCreateEntityOpen] = useState(false)
  const [createRelationOpen, setCreateRelationOpen] = useState(false)

  const validate = useMutation({
    mutationFn: () => model.validateSchema(ontologyKey),
    onSuccess: setValidation,
    onError: toastError,
  })

  // `V` switches Graph ⇄ Classic from either view, like the tabs.
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if ((e.key !== 'v' && e.key !== 'V') || e.shiftKey || e.repeat || !isPlainKey(e)) return
      if (e.defaultPrevented || isTyping() || overlayOpen(e)) return
      e.preventDefault()
      switchView(view === 'graph' ? 'classic' : 'graph')
    }
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  }, [view, switchView])

  const loaded = !schema.isPending && schema.error === null
  const empty = loaded && schema.entityTypes.length === 0 && schema.relationTypes.length === 0
  // A type page reports its own loading and not-found states.
  const typePage = view === 'classic' && selection !== null

  let body
  if (typePage) {
    body = <ClassicTypePage key={`${selection.kind}:${selection.key}`} kind={selection.kind} typeKey={selection.key} />
  } else if (schema.isPending) {
    body = <BodySkeleton />
  } else if (schema.error !== null) {
    body = (
      <EmptyState
        icon={SearchX}
        title="Failed to load schema"
        description={schema.error.message}
        className="py-24"
      />
    )
  } else if (empty) {
    body = (
      <EmptyState
        icon={Box}
        title="No types yet"
        description="Create your first entity type — relation types connect entity types afterwards."
        action={
          <Button onClick={() => setCreateEntityOpen(true)}>
            <Plus className="size-4" /> New entity type
          </Button>
        }
      />
    )
  } else if (view === 'classic') {
    body = <ClassicList />
  } else {
    body = (
      <Suspense fallback={null}>
        <SchemaCanvas />
      </Suspense>
    )
  }

  return (
    <DeleteProvider
      ontologyKey={ontologyKey}
      onDeleted={(target, type) => {
        if (
          target.what === 'type' &&
          selection !== null &&
          selection.kind === type.kind &&
          selection.key === type.key
        ) {
          select(null)
        }
      }}
      onShowType={(type) => select({ kind: type.kind, key: type.key })}
    >
      <div className="flex h-full flex-col">
        <PageHeader
          title="Schema"
          description="Entity types, relation types and their properties of this ontology. Every change is live."
          actions={
            <>
              {view === 'classic' && (
                <>
                  <Button size="sm" onClick={() => setCreateEntityOpen(true)}>
                    <Plus className="size-3.5" /> Entity type
                  </Button>
                  <Button size="sm" variant="secondary" onClick={() => setCreateRelationOpen(true)}>
                    <Plus className="size-3.5" /> Relation type
                  </Button>
                </>
              )}
              <Button
                variant="outline"
                size="sm"
                onClick={() => validate.mutate()}
                disabled={validate.isPending}
              >
                <ShieldCheck className="size-3.5" />
                {validate.isPending ? 'Validating…' : 'Validate'}
              </Button>
              <ViewTabs view={view} onChange={switchView} />
            </>
          }
        />
        {validation !== null && (
          <div className="border-b px-6 py-4">
            <ValidationPanel result={validation} onDismiss={() => setValidation(null)} />
          </div>
        )}
        <div className="flex min-h-0 flex-1">
          <div className={view === 'classic' ? 'min-w-0 flex-1 overflow-y-auto' : 'min-w-0 flex-1'}>
            {body}
          </div>
        </div>
      </div>

      <EntityTypeCreateDialog
        ontologyKey={ontologyKey}
        open={createEntityOpen}
        onOpenChange={setCreateEntityOpen}
        onCreated={(created) => select({ kind: 'entity-types', key: created.key })}
      />
      <RelationTypeCreateDialog
        ontologyKey={ontologyKey}
        open={createRelationOpen}
        onOpenChange={setCreateRelationOpen}
        onCreated={(created) => select({ kind: 'relation-types', key: created.key })}
        entityTypes={schema.entityTypes}
      />
    </DeleteProvider>
  )
}

function ViewTabs({ view, onChange }: { view: SchemaView; onChange: (view: SchemaView) => void }) {
  return (
    <Tabs value={view} activationMode="manual" onValueChange={(v) => onChange(v as SchemaView)}>
      <TabsList>
        <Tooltip>
          <TooltipTrigger asChild>
            <TabsTrigger value="graph">
              <Waypoints className="size-3.5" /> Graph
            </TabsTrigger>
          </TooltipTrigger>
          <TooltipContent side="bottom">Graph view · switch with V</TooltipContent>
        </Tooltip>
        <Tooltip>
          <TooltipTrigger asChild>
            <TabsTrigger value="classic">
              <PanelTop className="size-3.5" /> Classic
            </TabsTrigger>
          </TooltipTrigger>
          <TooltipContent side="bottom">Classic view · switch with V</TooltipContent>
        </Tooltip>
      </TabsList>
    </Tabs>
  )
}

function BodySkeleton() {
  return (
    <div className="grid gap-6 p-6 lg:grid-cols-2">
      {[0, 1].map((i) => (
        <div key={i} className="space-y-3">
          <Skeleton className="h-5 w-32" />
          <Skeleton className="h-20 rounded-xl" />
          <Skeleton className="h-20 rounded-xl" />
        </div>
      ))}
    </div>
  )
}
