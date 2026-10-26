import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import { AlertTriangle, Anchor, Fingerprint, Link2, Loader2, Plus, SearchX, Trash2, Waypoints } from 'lucide-react'
import { useEffect, useMemo, useState } from 'react'
import { Link, useNavigate, useParams } from 'react-router-dom'
import { toast } from 'sonner'
import { useRulesets, useRuntimeSchema, useStagedEntity } from '@/api/hooks'
import { ApiError } from '@/api/http'
import { qk } from '@/api/queryKeys'
import * as runtime from '@/api/runtime'
import { useRuntimeWrites } from '@/api/writes'
import { useCanEdit } from '@/components/auth/useAccess'
import { EmptyState } from '@/components/EmptyState'
import { TypeNotInLens } from '@/components/home/TypeNotInLens'
import { PageHeader } from '@/components/PageHeader'
import { TypeChip } from '@/components/TypeChip'
import { anchorDeleteWarning, anchorOfText, rulesetsAnchoredAt } from '@/components/rulesets/rulesets'
import { StagedHereStrip } from '@/components/changesets/StagedHereStrip'
import {
  AddRelationDialog,
  type RelationInitial,
} from '@/components/entity/AddRelationDialog'
import { EntityBreadcrumb } from '@/components/entity/EntityBreadcrumb'
import { hierarchyLinks, linkedTypeKey } from '@/components/entity/hierarchy'
import { MiniMap } from '@/components/entity/MiniMap'
import { ParentSection } from '@/components/entity/ParentSection'
import { PropertiesCard } from '@/components/entity/PropertiesCard'
import { RelationSection } from '@/components/entity/RelationSection'
import { stagedFields } from '@/components/entity/stagedFields'
import {
  invalidateNeighborhood,
  neighborCountsKey,
  useChildCounts,
  useNeighborCounts,
} from '@/components/entity/useNeighborCounts'
import { openQuickAdd } from '@/components/quickadd/quickAddBus'
import {
  AlertDialog,
  AlertDialogAction,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
  AlertDialogTrigger,
} from '@/components/ui/alert-dialog'
import { Button } from '@/components/ui/button'
import { Skeleton } from '@/components/ui/skeleton'
import { Tooltip, TooltipContent, TooltipTrigger } from '@/components/ui/tooltip'
import { displayLabel } from '@/lib/displayLabel'
import { usePinnedChangeset } from '@/lib/pinnedChangeset'
import { recordRecent } from '@/lib/recents'

const formatTimestamp = (iso: string) => {
  const date = new Date(iso)
  return Number.isNaN(date.getTime())
    ? iso
    : date.toLocaleString(undefined, { dateStyle: 'medium', timeStyle: 'short' })
}

/** `/o/:ontologyKey/w/:lensKey/e/:typeKey/:id` — entity detail (slice S4). */
export function EntityDetailPage() {
  const { ontologyKey, lensKey, typeKey, id } = useParams<{
    ontologyKey: string
    lensKey: string
    typeKey: string
    id: string
  }>()
  const navigate = useNavigate()
  const queryClient = useQueryClient()
  const schema = useRuntimeSchema(ontologyKey, lensKey)
  const canEdit = useCanEdit(ontologyKey ?? '', lensKey ?? '')

  const entityQuery = useQuery({
    queryKey: qk.entity(ontologyKey ?? '', lensKey ?? '', typeKey ?? '', id ?? ''),
    queryFn: () => runtime.getEntity(ontologyKey!, lensKey!, typeKey!, id!),
    enabled:
      ontologyKey !== undefined &&
      lensKey !== undefined &&
      typeKey !== undefined &&
      id !== undefined,
  })
  const entity = entityQuery.data

  const entityType = schema.data?.entityTypes.find((t) => t.key === typeKey)
  const nameProperty = entityType?.nameProperty
  const relationTypes = useMemo(
    () =>
      (schema.data?.relationTypes ?? []).filter(
        (rt) => rt.fromEntityTypeKey === typeKey || rt.toEntityTypeKey === typeKey,
      ),
    [schema.data, typeKey],
  )

  const counts = useNeighborCounts(ontologyKey ?? '', lensKey ?? '', entity, relationTypes)

  // The parent relations' sections lead; the ordinary ones follow.
  const hierarchy = useMemo(
    () => hierarchyLinks(relationTypes, typeKey ?? ''),
    [relationTypes, typeKey],
  )
  const ordinaryTypes = useMemo(
    () => relationTypes.filter((rt) => rt.parent === null),
    [relationTypes],
  )
  const childCounts = useChildCounts(ontologyKey ?? '', lensKey ?? '', entity, hierarchy.children)
  // Children the lens hides are unknown here; the server's 409 covers them.
  const hasChildren = Object.values(childCounts.data ?? {}).some((n) => n > 0)

  // The rulesets whose anchor this is: a chip, and a warning before a delete deletes their anchor.
  const rulesets = useRulesets(ontologyKey)
  const anchorOf = useMemo(
    () => rulesetsAnchoredAt(rulesets.data ?? [], typeKey ?? '', id ?? ''),
    [rulesets.data, typeKey, id],
  )

  // While a changeset is pinned: this entity as it leaves it (none on a 404: not stored, or gone).
  const pinned = usePinnedChangeset(ontologyKey ?? '', lensKey ?? '')
  const stagedQuery = useStagedEntity(ontologyKey ?? '', lensKey ?? '', pinned, typeKey ?? '', id ?? '')
  const staged = pinned === null || stagedQuery.data?.object === null ? undefined : stagedQuery.data
  const overlay = useMemo(
    () => (staged === undefined ? undefined : { changesetId: pinned!, fields: stagedFields(staged) }),
    [staged, pinned],
  )

  const pathQuery = useQuery({
    queryKey: qk.path(ontologyKey ?? '', lensKey ?? '', typeKey ?? '', id ?? ''),
    queryFn: () => runtime.getPath(ontologyKey!, lensKey!, typeKey!, id!),
    enabled: entity !== undefined,
  })

  // Record the visit for the palette's recents list.
  useEffect(() => {
    if (ontologyKey !== undefined && lensKey !== undefined && entity !== undefined) {
      recordRecent(ontologyKey, lensKey, {
        id: entity._id,
        typeKey: entity._entityTypeKey,
        label: displayLabel(entity, nameProperty),
      })
    }
  }, [ontologyKey, lensKey, entity, nameProperty])

  const [addRelation, setAddRelation] = useState<{
    open: boolean
    initial?: RelationInitial
  }>({ open: false })

  const writes = useRuntimeWrites(ontologyKey ?? '', lensKey ?? '')
  const deleteMutation = useMutation({
    mutationFn: () => writes.deleteEntity(typeKey!, id!),
    onSuccess: (outcome) => {
      // Staged: the entity still exists live, so the page stays.
      if (outcome.kind === 'staged') {
        writes.toastStaged(outcome)
        return
      }
      void queryClient.invalidateQueries({
        queryKey: qk.entities(ontologyKey!, lensKey!, typeKey!),
      })
      queryClient.removeQueries({ queryKey: qk.entity(ontologyKey!, lensKey!, typeKey!, id!) })
      // The parent's children changed (only its own queries: this entity's would 404).
      const parent = pathQuery.data?.at(-2)
      if (parent !== undefined) {
        void queryClient.invalidateQueries({
          queryKey: qk.neighbors(ontologyKey!, lensKey!, parent.type, parent.id),
        })
        void queryClient.invalidateQueries({
          queryKey: neighborCountsKey(ontologyKey!, lensKey!, parent.type, parent.id),
        })
      }
      // A ruleset whose anchor this was now has a deleted anchor.
      if (anchorOf.length > 0) {
        void queryClient.invalidateQueries({ queryKey: qk.rulesets(ontologyKey!) })
      }
      toast.success('Entity deleted')
      navigate(`/o/${ontologyKey}/w/${lensKey}/t/${typeKey}`)
    },
    onError: (err) => {
      // A 409 "has children": a child appeared since the counts were read.
      if (err instanceof ApiError && err.status === 409) {
        invalidateNeighborhood(queryClient, ontologyKey!, lensKey!, typeKey!, id!)
      }
      toast.error(err instanceof Error ? err.message : 'Failed to delete entity')
    },
  })

  if (ontologyKey === undefined || lensKey === undefined || typeKey === undefined || id === undefined)
    return null

  if (schema.data !== undefined && entityType === undefined) {
    return (
      <div className="mx-auto max-w-xl px-6 py-24">
        <TypeNotInLens ontologyKey={ontologyKey} lensKey={lensKey} typeKey={typeKey} />
        <Button asChild size="sm" variant="link" className="mt-2 px-0">
          <Link to={`/o/${ontologyKey}/w/${lensKey}`}>Back to overview</Link>
        </Button>
      </div>
    )
  }

  if (entityQuery.error instanceof ApiError && entityQuery.error.status === 404) {
    return (
      <EmptyState
        icon={SearchX}
        title="Entity not found"
        description="This entity does not exist (anymore) in this lens."
        action={
          <Button variant="outline" size="sm" asChild>
            <Link to={`/o/${ontologyKey}/w/${lensKey}`}>Back to overview</Link>
          </Button>
        }
        className="py-24"
      />
    )
  }

  if (entityQuery.isError) {
    return (
      <EmptyState
        icon={SearchX}
        title="Failed to load entity"
        description={entityQuery.error.message}
        className="py-24"
      />
    )
  }

  if (entity === undefined || entityType === undefined || schema.data === undefined) {
    return (
      <div>
        <div className="border-b px-6 py-4">
          <div className="flex items-center gap-3">
            <Skeleton className="h-5 w-48" />
            <Skeleton className="h-5 w-20" />
          </div>
          <Skeleton className="mt-2 h-3.5 w-64" />
        </div>
        <div className="grid gap-6 p-6 lg:grid-cols-[minmax(0,5fr)_minmax(0,7fr)]">
          <Skeleton className="h-64 rounded-xl" />
          <div className="space-y-4">
            <Skeleton className="h-32 rounded-xl" />
            <Skeleton className="h-32 rounded-xl" />
          </div>
        </div>
      </div>
    )
  }

  const label = displayLabel(entity, nameProperty)
  const explorePath = `/o/${ontologyKey}/w/${lensKey}/explore?focus=${typeKey}:${entity._id}`

  return (
    <div>
      <PageHeader
        breadcrumb={
          pathQuery.data !== undefined && (
            <EntityBreadcrumb ontologyKey={ontologyKey} lensKey={lensKey} path={pathQuery.data} />
          )
        }
        title={label}
        meta={
          <>
            <TypeChip typeKey={typeKey} displayName={entityType.displayName} size="sm" />
            {entity._identity !== undefined && (
              <span
                className="inline-flex items-center gap-1 rounded-md border px-1.5 py-px font-mono text-[11.5px] text-muted-foreground"
                title={`Identity — ${(entityType.identityProperties ?? []).join(' · ')}`}
              >
                <Fingerprint className="size-3 opacity-60" />
                {entity._identity}
              </span>
            )}
            {anchorOf.length > 0 && (
              <Link
                to={`/o/${ontologyKey}/w/${lensKey}/rulesets`}
                className="inline-flex items-center gap-1 rounded-full border border-(--tc-teal-border) bg-(--tc-teal-bg) px-2 py-0.5 text-[11px] font-medium text-(--tc-teal) hover:underline focus-visible:outline-2 focus-visible:outline-ring/60"
              >
                <Anchor className="size-3" />
                {anchorOfText(anchorOf)}
              </Link>
            )}
            {staged?.deleted && (
              <span className="inline-flex items-center gap-1 rounded-full border border-(--tc-amber-border) bg-(--tc-amber-bg) px-2 py-0.5 text-[11px] font-medium text-(--tc-amber)">
                <Trash2 className="size-3" />
                Deleted in this changeset
              </span>
            )}
          </>
        }
        description={
          <span className="font-mono text-[11.5px]">
            created {formatTimestamp(entity._createdAt)} · updated{' '}
            {formatTimestamp(entity._updatedAt)}
          </span>
        }
        actions={
          <>
            {canEdit && (
              <Button
                variant="outline"
                size="sm"
                disabled={relationTypes.length === 0}
                onClick={() => setAddRelation({ open: true })}
              >
                <Link2 className="size-3.5" />
                Add relation
              </Button>
            )}
            <Button variant="outline" size="sm" asChild>
              <Link to={explorePath}>
                <Waypoints className="size-3.5" />
                Open in Explorer
              </Link>
            </Button>
            {canEdit && (
              <AlertDialog>
                {hasChildren ? (
                  // A disabled button fires no pointer events: the wrapper carries the tooltip.
                  <Tooltip>
                    <TooltipTrigger asChild>
                      <span tabIndex={0} aria-label="Delete its children first">
                        <Button variant="destructive" size="sm" disabled>
                          <Trash2 className="size-3.5" />
                          Delete
                        </Button>
                      </span>
                    </TooltipTrigger>
                    <TooltipContent>Delete its children first</TooltipContent>
                  </Tooltip>
                ) : (
                  <AlertDialogTrigger asChild>
                    <Button variant="destructive" size="sm" disabled={deleteMutation.isPending}>
                      {deleteMutation.isPending ? (
                        <Loader2 className="size-3.5 animate-spin" />
                      ) : (
                        <Trash2 className="size-3.5" />
                      )}
                      Delete
                    </Button>
                  </AlertDialogTrigger>
                )}
                <AlertDialogContent>
                  <AlertDialogHeader>
                    <AlertDialogTitle>Delete “{label}”?</AlertDialogTitle>
                    <AlertDialogDescription>
                      {pinned === null
                        ? 'The entity and all of its relations are removed permanently. This cannot be undone.'
                        : 'The delete is staged into the pinned changeset: nothing is removed until it is committed.'}
                    </AlertDialogDescription>
                  </AlertDialogHeader>
                  {anchorOf.length > 0 && (
                    <p className="flex items-start gap-2 rounded-lg border border-(--tc-amber-border) bg-(--tc-amber-bg) p-3 text-[13px]">
                      <AlertTriangle className="mt-0.5 size-3.5 shrink-0 text-(--tc-amber)" />
                      {anchorDeleteWarning(anchorOf)}
                    </p>
                  )}
                  <AlertDialogFooter>
                    <AlertDialogCancel>Cancel</AlertDialogCancel>
                    <AlertDialogAction
                      onClick={() => deleteMutation.mutate()}
                      className="bg-destructive text-white hover:bg-destructive/90"
                    >
                      Delete
                    </AlertDialogAction>
                  </AlertDialogFooter>
                </AlertDialogContent>
              </AlertDialog>
            )}
          </>
        }
      />

      {staged !== undefined && (
        <StagedHereStrip ontologyKey={ontologyKey} lensKey={lensKey} changesetId={pinned!} object={staged.object!} />
      )}

      <div className="grid items-start gap-6 p-6 lg:grid-cols-[minmax(0,5fr)_minmax(0,7fr)]">
        <PropertiesCard
          ontologyKey={ontologyKey}
          lensKey={lensKey}
          entityType={entityType}
          entity={entity}
          staged={overlay}
        />

        <div className="flex flex-col gap-4">
          {relationTypes.length === 0 ? (
            <section className="rounded-xl border bg-card px-4 py-8 text-center text-[13px] text-muted-foreground">
              No relation types apply to {entityType.displayName}.
            </section>
          ) : (
            <>
              {hierarchy.parents.length > 0 && (
                <ParentSection
                  ontologyKey={ontologyKey}
                  lensKey={lensKey}
                  entity={entity}
                  links={hierarchy.parents}
                  entityTypes={schema.data.entityTypes}
                  onAdd={(initial) => setAddRelation({ open: true, initial })}
                />
              )}
              {hierarchy.children.map((link) => {
                const childType = schema.data!.entityTypes.find(
                  (t) => t.key === linkedTypeKey(link),
                )
                const childTypeName = childType?.displayName ?? linkedTypeKey(link)
                return (
                  <RelationSection
                    key={`children:${link.relationType.key}`}
                    ontologyKey={ontologyKey}
                    lensKey={lensKey}
                    entity={entity}
                    relationType={link.relationType}
                    entityTypes={schema.data!.entityTypes}
                    count={childCounts.data?.[link.relationType.key]}
                    onAdd={(initial) => setAddRelation({ open: true, initial })}
                    childSection={{
                      direction: link.direction,
                      action: canEdit && (
                        <Button
                          variant="outline"
                          size="xs"
                          className="border-(--tc-violet-border) bg-(--tc-violet-bg) text-(--tc-violet) hover:bg-(--tc-violet-bg) hover:text-(--tc-violet)"
                          onClick={() =>
                            openQuickAdd(linkedTypeKey(link), {
                              relationTypeKey: link.relationType.key,
                              typeKey,
                              id: entity._id,
                              label,
                            })
                          }
                        >
                          <Plus className="size-3" />
                          {childTypeName} under {label}
                        </Button>
                      ),
                    }}
                  />
                )
              })}
              {ordinaryTypes.map((rt) => (
                <RelationSection
                  key={rt.key}
                  ontologyKey={ontologyKey}
                  lensKey={lensKey}
                  entity={entity}
                  relationType={rt}
                  entityTypes={schema.data!.entityTypes}
                  count={counts.data?.[rt.key]}
                  onAdd={(initial) => setAddRelation({ open: true, initial })}
                />
              ))}
            </>
          )}

          <MiniMap
            ontologyKey={ontologyKey}
            lensKey={lensKey}
            entity={entity}
            relationTypes={relationTypes}
            counts={counts.data}
          />
        </div>
      </div>

      <AddRelationDialog
        ontologyKey={ontologyKey}
        lensKey={lensKey}
        entity={entity}
        entityLabel={label}
        relationTypes={relationTypes}
        entityTypes={schema.data.entityTypes}
        open={addRelation.open}
        onOpenChange={(open) =>
          setAddRelation((prev) => ({ open, initial: open ? prev.initial : undefined }))
        }
        initial={addRelation.initial}
      />
    </div>
  )
}
