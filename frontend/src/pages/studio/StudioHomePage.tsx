import { useMemo, useState } from 'react'
import { useMutation, useQueries, useQuery } from '@tanstack/react-query'
import {
  ArrowRight,
  Box,
  List,
  Plus,
  ShieldCheck,
  Waypoints,
  Workflow,
} from 'lucide-react'
import { Link, useParams } from 'react-router-dom'
import * as model from '@/api/model'
import { qk } from '@/api/queryKeys'
import type { EntityType, RelationType, ValidationResult } from '@/api/types'
import { EmptyState } from '@/components/EmptyState'
import { PageHeader } from '@/components/PageHeader'
import { TypeChip, TypeDot } from '@/components/TypeChip'
import { SchemaDiagram } from '@/components/studio/SchemaDiagram'
import {
  EntityTypeCreateDialog,
  RelationTypeCreateDialog,
} from '@/components/studio/TypeCreateDialogs'
import { ValidationPanel } from '@/components/studio/ValidationPanel'
import { toastError } from '@/components/studio/lib'
import { Button } from '@/components/ui/button'
import { Skeleton } from '@/components/ui/skeleton'
import { Tabs, TabsList, TabsTrigger } from '@/components/ui/tabs'

function usePropertyCounts(
  ontologyKey: string | undefined,
  kind: 'entity-types' | 'relation-types',
  ids: string[],
) {
  return useQueries({
    queries: ids.map((id) => ({
      queryKey: qk.model(ontologyKey ?? '', kind, id, 'properties'),
      queryFn: () => model.listProperties(ontologyKey!, kind, id),
      enabled: ontologyKey !== undefined,
    })),
    combine: (results) => {
      const counts: Record<string, number> = {}
      results.forEach((r, i) => {
        const id = ids[i]
        if (r.data !== undefined && id !== undefined) counts[id] = r.data.length
      })
      return counts
    },
  })
}

function propCountLabel(count: number | undefined) {
  if (count === undefined) return null
  return (
    <span className="text-xs text-muted-foreground">
      {count} {count === 1 ? 'property' : 'properties'}
    </span>
  )
}

function EntityTypeCard({
  ontologyKey,
  type,
  propCount,
}: {
  ontologyKey: string
  type: EntityType
  propCount?: number
}) {
  return (
    <Link
      to={`/o/${ontologyKey}/studio/entity-types/${type.entityTypeId}`}
      className="block rounded-xl border bg-card p-3.5 transition-colors duration-150 hover:border-ring/40 focus-visible:outline-2 focus-visible:outline-ring/60"
    >
      <div className="flex items-center gap-2">
        <TypeChip typeKey={type.key} displayName={type.displayName} size="sm" />
        <span className="truncate font-mono text-[11px] text-muted-foreground">
          {type.key}
        </span>
        <span className="ml-auto shrink-0">{propCountLabel(propCount)}</span>
      </div>
      <p className="mt-1.5 line-clamp-2 text-[13px] text-muted-foreground">
        {type.description ?? 'No description.'}
      </p>
    </Link>
  )
}

function RelationTypeCard({
  ontologyKey,
  type,
  propCount,
}: {
  ontologyKey: string
  type: RelationType
  propCount?: number
}) {
  return (
    <Link
      to={`/o/${ontologyKey}/studio/relation-types/${type.relationTypeId}`}
      className="block rounded-xl border bg-card p-3.5 transition-colors duration-150 hover:border-ring/40 focus-visible:outline-2 focus-visible:outline-ring/60"
    >
      <div className="flex items-center gap-2">
        <TypeChip typeKey={type.key} displayName={type.displayName} size="sm" />
        <span className="truncate font-mono text-[11px] text-muted-foreground">
          {type.key}
        </span>
        <span className="ml-auto shrink-0">{propCountLabel(propCount)}</span>
      </div>
      <div className="mt-1.5 flex items-center gap-1.5 text-[12px]">
        <TypeDot typeKey={type.sourceEntityTypeKey} />
        <span className="font-mono text-muted-foreground">{type.sourceEntityTypeKey}</span>
        <ArrowRight className="size-3 text-muted-foreground/60" />
        <TypeDot typeKey={type.targetEntityTypeKey} />
        <span className="font-mono text-muted-foreground">{type.targetEntityTypeKey}</span>
      </div>
      {type.description !== null && (
        <p className="mt-1 line-clamp-1 text-[13px] text-muted-foreground">
          {type.description}
        </p>
      )}
    </Link>
  )
}

/** `/o/:ontologyKey/studio` — schema overview: type lists, diagram toggle, validation. */
export function StudioHomePage() {
  const { ontologyKey } = useParams<{ ontologyKey: string }>()
  const [view, setView] = useState<'list' | 'diagram'>('list')
  const [validation, setValidation] = useState<ValidationResult | null>(null)
  const [createEntityOpen, setCreateEntityOpen] = useState(false)
  const [createRelationOpen, setCreateRelationOpen] = useState(false)

  const entityTypesQuery = useQuery({
    queryKey: qk.model(ontologyKey ?? '', 'entity-types'),
    queryFn: () => model.listEntityTypes(ontologyKey!),
    enabled: ontologyKey !== undefined,
  })
  const relationTypesQuery = useQuery({
    queryKey: qk.model(ontologyKey ?? '', 'relation-types'),
    queryFn: () => model.listRelationTypes(ontologyKey!),
    enabled: ontologyKey !== undefined,
  })
  const entityTypes = entityTypesQuery.data
  const relationTypes = relationTypesQuery.data

  const entityIds = useMemo(
    () => (entityTypes ?? []).map((t) => t.entityTypeId),
    [entityTypes],
  )
  const relationIds = useMemo(
    () => (relationTypes ?? []).map((t) => t.relationTypeId),
    [relationTypes],
  )
  const entityPropCounts = usePropertyCounts(ontologyKey, 'entity-types', entityIds)
  const relationPropCounts = usePropertyCounts(ontologyKey, 'relation-types', relationIds)

  const validate = useMutation({
    mutationFn: () => model.validateSchema(ontologyKey!),
    onSuccess: setValidation,
    onError: toastError,
  })

  if (ontologyKey === undefined) return null

  const loading = entityTypesQuery.isPending || relationTypesQuery.isPending
  const empty =
    entityTypes !== undefined &&
    relationTypes !== undefined &&
    entityTypes.length === 0 &&
    relationTypes.length === 0

  return (
    <div className="flex h-full flex-col">
      <PageHeader
        title="Schema"
        description="This ontology's entity types, relation types and their properties."
        actions={
          <>
            <Tabs value={view} onValueChange={(v) => setView(v as 'list' | 'diagram')}>
              <TabsList>
                <TabsTrigger value="list">
                  <List className="size-3.5" /> List
                </TabsTrigger>
                <TabsTrigger value="diagram">
                  <Waypoints className="size-3.5" /> Diagram
                </TabsTrigger>
              </TabsList>
            </Tabs>
            <Button
              variant="outline"
              size="sm"
              onClick={() => validate.mutate()}
              disabled={validate.isPending}
            >
              <ShieldCheck className="size-3.5" />
              {validate.isPending ? 'Validating…' : 'Validate'}
            </Button>
            <Button size="sm" onClick={() => setCreateEntityOpen(true)}>
              <Plus className="size-3.5" /> Entity type
            </Button>
            <Button size="sm" variant="secondary" onClick={() => setCreateRelationOpen(true)}>
              <Plus className="size-3.5" /> Relation type
            </Button>
          </>
        }
      />

      <div className="flex min-h-0 flex-1 flex-col gap-4 p-6">
        {validation !== null && (
          <ValidationPanel result={validation} onDismiss={() => setValidation(null)} />
        )}

        {loading && (
          <div className="grid gap-6 lg:grid-cols-2">
            <div className="space-y-3">
              <Skeleton className="h-5 w-32" />
              <Skeleton className="h-20 rounded-xl" />
              <Skeleton className="h-20 rounded-xl" />
            </div>
            <div className="space-y-3">
              <Skeleton className="h-5 w-32" />
              <Skeleton className="h-20 rounded-xl" />
              <Skeleton className="h-20 rounded-xl" />
            </div>
          </div>
        )}

        {!loading && empty && (
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
        )}

        {!loading && !empty && view === 'diagram' && (
          <div className="min-h-0 flex-1">
            <SchemaDiagram
              ontologyKey={ontologyKey}
              entityTypes={entityTypes ?? []}
              relationTypes={relationTypes ?? []}
            />
          </div>
        )}

        {!loading && !empty && view === 'list' && (
          <div className="grid items-start gap-6 lg:grid-cols-2">
            <section className="space-y-2.5">
              <h2 className="flex items-center gap-2 text-[13px] font-semibold">
                <Box className="size-4 text-muted-foreground" />
                Entity types
                <span className="font-normal text-muted-foreground">
                  {entityTypes?.length ?? 0}
                </span>
              </h2>
              {(entityTypes ?? []).map((t) => (
                <EntityTypeCard
                  key={t.entityTypeId}
                  ontologyKey={ontologyKey}
                  type={t}
                  propCount={entityPropCounts[t.entityTypeId]}
                />
              ))}
              {entityTypes !== undefined && entityTypes.length === 0 && (
                <p className="rounded-xl border border-dashed p-4 text-[13px] text-muted-foreground">
                  No entity types yet.
                </p>
              )}
            </section>
            <section className="space-y-2.5">
              <h2 className="flex items-center gap-2 text-[13px] font-semibold">
                <Workflow className="size-4 text-muted-foreground" />
                Relation types
                <span className="font-normal text-muted-foreground">
                  {relationTypes?.length ?? 0}
                </span>
              </h2>
              {(relationTypes ?? []).map((t) => (
                <RelationTypeCard
                  key={t.relationTypeId}
                  ontologyKey={ontologyKey}
                  type={t}
                  propCount={relationPropCounts[t.relationTypeId]}
                />
              ))}
              {relationTypes !== undefined && relationTypes.length === 0 && (
                <p className="rounded-xl border border-dashed p-4 text-[13px] text-muted-foreground">
                  No relation types yet. Relations connect two entity types.
                </p>
              )}
            </section>
          </div>
        )}
      </div>

      <EntityTypeCreateDialog
        ontologyKey={ontologyKey}
        open={createEntityOpen}
        onOpenChange={setCreateEntityOpen}
      />
      <RelationTypeCreateDialog
        ontologyKey={ontologyKey}
        open={createRelationOpen}
        onOpenChange={setCreateRelationOpen}
        entityTypes={entityTypes ?? []}
      />
    </div>
  )
}
