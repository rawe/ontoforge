import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import { Link2, Loader2, SearchX, Trash2, Waypoints } from 'lucide-react'
import { useEffect, useMemo, useState } from 'react'
import { Link, useNavigate, useParams } from 'react-router-dom'
import { toast } from 'sonner'
import { useRuntimeSchema } from '@/api/hooks'
import { ApiError } from '@/api/http'
import { qk } from '@/api/queryKeys'
import * as runtime from '@/api/runtime'
import { EmptyState } from '@/components/EmptyState'
import { PageHeader } from '@/components/PageHeader'
import { TypeChip } from '@/components/TypeChip'
import {
  AddRelationDialog,
  type RelationInitial,
} from '@/components/entity/AddRelationDialog'
import { MiniMap } from '@/components/entity/MiniMap'
import { PropertiesCard } from '@/components/entity/PropertiesCard'
import { RelationSection } from '@/components/entity/RelationSection'
import { useNeighborCounts } from '@/components/entity/useNeighborCounts'
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
import { displayLabel } from '@/lib/displayLabel'
import { recordRecent } from '@/lib/recents'

const formatTimestamp = (iso: string) => {
  const date = new Date(iso)
  return Number.isNaN(date.getTime())
    ? iso
    : date.toLocaleString(undefined, { dateStyle: 'medium', timeStyle: 'short' })
}

/** `/w/:lensKey/e/:typeKey/:id` — entity detail (slice S4). */
export function EntityDetailPage() {
  const { lensKey, typeKey, id } = useParams<{
    lensKey: string
    typeKey: string
    id: string
  }>()
  const navigate = useNavigate()
  const queryClient = useQueryClient()
  const schema = useRuntimeSchema(lensKey)

  const entityQuery = useQuery({
    queryKey: qk.entity(lensKey ?? '', typeKey ?? '', id ?? ''),
    queryFn: () => runtime.getEntity(lensKey!, typeKey!, id!),
    enabled: lensKey !== undefined && typeKey !== undefined && id !== undefined,
  })
  const entity = entityQuery.data

  const entityType = schema.data?.entityTypes.find((t) => t.key === typeKey)
  const relationTypes = useMemo(
    () =>
      (schema.data?.relationTypes ?? []).filter(
        (rt) => rt.fromEntityTypeKey === typeKey || rt.toEntityTypeKey === typeKey,
      ),
    [schema.data, typeKey],
  )

  const counts = useNeighborCounts(lensKey ?? '', entity, relationTypes)

  // Record the visit for the palette's recents list.
  useEffect(() => {
    if (lensKey !== undefined && entity !== undefined) {
      recordRecent(lensKey, {
        id: entity._id,
        typeKey: entity._entityTypeKey,
        label: displayLabel(entity),
      })
    }
  }, [lensKey, entity])

  const [addRelation, setAddRelation] = useState<{
    open: boolean
    initial?: RelationInitial
  }>({ open: false })

  const deleteMutation = useMutation({
    mutationFn: () => runtime.deleteEntity(lensKey!, typeKey!, id!),
    onSuccess: () => {
      void queryClient.invalidateQueries({
        queryKey: qk.entities(lensKey!, typeKey!),
      })
      queryClient.removeQueries({ queryKey: qk.entity(lensKey!, typeKey!, id!) })
      toast.success('Entity deleted')
      navigate(`/w/${lensKey}/t/${typeKey}`)
    },
    onError: (err) => {
      toast.error(err instanceof Error ? err.message : 'Failed to delete entity')
    },
  })

  if (lensKey === undefined || typeKey === undefined || id === undefined) return null

  const notFound =
    (entityQuery.error instanceof ApiError && entityQuery.error.status === 404) ||
    (schema.data !== undefined && entityType === undefined)

  if (notFound) {
    return (
      <EmptyState
        icon={SearchX}
        title="Entity not found"
        description={
          entityType === undefined && schema.data !== undefined
            ? `Entity type "${typeKey}" is not part of this lens's scope.`
            : 'This entity does not exist (anymore) in this lens.'
        }
        action={
          <Button variant="outline" size="sm" asChild>
            <Link to={`/w/${lensKey}`}>Back to overview</Link>
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

  const label = displayLabel(entity)
  const explorePath = `/w/${lensKey}/explore?focus=${typeKey}:${entity._id}`

  return (
    <div>
      <PageHeader
        title={label}
        meta={<TypeChip typeKey={typeKey} displayName={entityType.displayName} size="sm" />}
        description={
          <span className="font-mono text-[11.5px]">
            created {formatTimestamp(entity._createdAt)} · updated{' '}
            {formatTimestamp(entity._updatedAt)}
          </span>
        }
        actions={
          <>
            <Button
              variant="outline"
              size="sm"
              disabled={relationTypes.length === 0}
              onClick={() => setAddRelation({ open: true })}
            >
              <Link2 className="size-3.5" />
              Add relation
            </Button>
            <Button variant="outline" size="sm" asChild>
              <Link to={explorePath}>
                <Waypoints className="size-3.5" />
                Open in Explorer
              </Link>
            </Button>
            <AlertDialog>
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
              <AlertDialogContent>
                <AlertDialogHeader>
                  <AlertDialogTitle>Delete “{label}”?</AlertDialogTitle>
                  <AlertDialogDescription>
                    The entity and all of its relations are removed permanently. This
                    cannot be undone.
                  </AlertDialogDescription>
                </AlertDialogHeader>
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
          </>
        }
      />

      <div className="grid items-start gap-6 p-6 lg:grid-cols-[minmax(0,5fr)_minmax(0,7fr)]">
        <PropertiesCard lensKey={lensKey} entityType={entityType} entity={entity} />

        <div className="flex flex-col gap-4">
          {relationTypes.length === 0 ? (
            <section className="rounded-xl border bg-card px-4 py-8 text-center text-[13px] text-muted-foreground">
              No relation types apply to {entityType.displayName}.
            </section>
          ) : (
            relationTypes.map((rt) => (
              <RelationSection
                key={rt.key}
                lensKey={lensKey}
                entity={entity}
                relationType={rt}
                entityTypes={schema.data!.entityTypes}
                count={counts.data?.[rt.key]}
                onAdd={(initial) => setAddRelation({ open: true, initial })}
              />
            ))
          )}

          <MiniMap
            lensKey={lensKey}
            entity={entity}
            relationTypes={relationTypes}
            counts={counts.data}
          />
        </div>
      </div>

      <AddRelationDialog
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
