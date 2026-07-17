import { useMutation, useQueryClient } from '@tanstack/react-query'
import { ArrowRight, ChevronLeft, Loader2, Plus } from 'lucide-react'
import { useMemo, useState } from 'react'
import { toast } from 'sonner'
import { useFeatures } from '@/api/hooks'
import { ApiError } from '@/api/http'
import { qk } from '@/api/queryKeys'
import * as runtime from '@/api/runtime'
import type {
  EntityInstance,
  JsonValue,
  RelationInstance,
  SchemaEntityType,
  SchemaRelationType,
} from '@/api/types'
import { TypeChip } from '@/components/TypeChip'
import { PropertyField } from '@/components/schema/PropertyField'
import { coerceDrafts } from '@/components/schema/propertyDraft'
import { Button } from '@/components/ui/button'
import { Command, CommandItem, CommandList } from '@/components/ui/command'
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from '@/components/ui/dialog'
import {
  invalidateNeighborhood,
} from '@/components/entity/useNeighborCounts'
import { displayLabel } from '@/lib/displayLabel'
import {
  useDebouncedValue,
  useEntitySearch,
} from '@/components/palette/usePaletteSearch'

export type RelationDirection = 'outgoing' | 'incoming'

export interface RelationChoice {
  relationType: SchemaRelationType
  direction: RelationDirection
}

export interface RelationInitial {
  relationType: SchemaRelationType
  /** Omit when ambiguous (self-referential type) — the user picks. */
  direction?: RelationDirection
}

interface AddRelationDialogProps {
  ontologyKey: string
  entity: EntityInstance
  entityLabel: string
  /** Relation types applicable to this entity's type (either endpoint). */
  relationTypes: readonly SchemaRelationType[]
  entityTypes: readonly SchemaEntityType[]
  open: boolean
  onOpenChange: (open: boolean) => void
  /** Preselect a relation type (per-section "Add"); undefined = global flow. */
  initial?: RelationInitial
  /** Notified after a relation was created (e.g. the Explorer adds an edge). */
  onCreated?: (relation: RelationInstance, target: EntityInstance) => void
}

/**
 * Guided add-relation flow: pick a schema-valid relation type (+ direction
 * when ambiguous) → pick or create the target entity → optional relation
 * props → POST. Steps collapse automatically when there is only one choice.
 *
 * The stateful flow only mounts while the dialog is open, so every open
 * starts from a fresh step derived from `initial` / the available options.
 */
export function AddRelationDialog({ open, onOpenChange, ...rest }: AddRelationDialogProps) {
  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      {open && <AddRelationFlow onOpenChange={onOpenChange} {...rest} />}
    </Dialog>
  )
}

function AddRelationFlow({
  ontologyKey,
  entity,
  entityLabel,
  relationTypes,
  entityTypes,
  onOpenChange,
  initial,
  onCreated,
}: Omit<AddRelationDialogProps, 'open'>) {
  const queryClient = useQueryClient()
  const { data: features } = useFeatures()
  const myTypeKey = entity._entityTypeKey

  const options = useMemo<RelationChoice[]>(() => {
    const source = initial !== undefined
      ? relationTypes.filter((rt) => rt.key === initial.relationType.key)
      : relationTypes
    return source.flatMap((rt) => {
      const opts: RelationChoice[] = []
      if (rt.fromEntityTypeKey === myTypeKey) opts.push({ relationType: rt, direction: 'outgoing' })
      if (rt.toEntityTypeKey === myTypeKey) opts.push({ relationType: rt, direction: 'incoming' })
      return opts
    })
  }, [relationTypes, initial, myTypeKey])

  const [choice, setChoice] = useState<RelationChoice | null>(() => {
    if (initial?.direction !== undefined) {
      return { relationType: initial.relationType, direction: initial.direction }
    }
    return options.length === 1 ? options[0]! : null
  })
  const [target, setTarget] = useState<EntityInstance | null>(null)
  const [creatingNew, setCreatingNew] = useState(false)
  const [targetQuery, setTargetQuery] = useState('')
  const [relDrafts, setRelDrafts] = useState<Record<string, string>>({})
  const [relErrors, setRelErrors] = useState<Record<string, string>>({})
  const [newDrafts, setNewDrafts] = useState<Record<string, string>>({})
  const [newErrors, setNewErrors] = useState<Record<string, string>>({})
  const [formError, setFormError] = useState<string | null>(null)

  const relationType = choice?.relationType
  const targetTypeKey =
    choice === null
      ? undefined
      : choice.direction === 'outgoing'
        ? choice.relationType.toEntityTypeKey
        : choice.relationType.fromEntityTypeKey
  const targetType = entityTypes.find((t) => t.key === targetTypeKey)

  const step: 'type' | 'target' | 'create' | 'props' =
    choice === null ? 'type' : target === null ? (creatingNew ? 'create' : 'target') : 'props'

  /* -------------------------------- searching -------------------------------- */

  const debouncedQuery = useDebouncedValue(targetQuery.trim(), 250)
  const targetSearch = useEntitySearch({
    ontologyKey,
    q: debouncedQuery,
    typeKey: targetTypeKey,
    semantic: features?.semanticSearch === true,
    allTypeKeys: [],
    enabled: step === 'target' && targetTypeKey !== undefined,
  })

  /* -------------------------------- mutations -------------------------------- */

  const createRelationMutation = useMutation({
    mutationFn: (vars: { target: EntityInstance; props: Record<string, JsonValue> }) => {
      const fromEntityId = choice!.direction === 'outgoing' ? entity._id : vars.target._id
      const toEntityId = choice!.direction === 'outgoing' ? vars.target._id : entity._id
      return runtime.createRelation(ontologyKey, choice!.relationType.key, {
        fromEntityId,
        toEntityId,
        ...vars.props,
      })
    },
    onSuccess: (created, vars) => {
      onCreated?.(created, vars.target)
      invalidateNeighborhood(queryClient, ontologyKey, myTypeKey, entity._id)
      invalidateNeighborhood(
        queryClient,
        ontologyKey,
        vars.target._entityTypeKey,
        vars.target._id,
      )
      toast.success(
        `${choice!.relationType.displayName}: linked to ${displayLabel(vars.target)}`,
      )
      onOpenChange(false)
    },
    onError: (err, vars) => {
      setTarget(vars.target) // stay on (or return to) the props step
      if (err instanceof ApiError) {
        const fields = err.fieldErrors
        if (fields !== undefined) {
          setRelErrors(fields)
          const endpointError = fields.fromEntityId ?? fields.toEntityId
          setFormError(endpointError ?? null)
        } else {
          setFormError(err.message)
        }
      } else {
        setFormError(err instanceof Error ? err.message : 'Failed to create relation')
      }
    },
  })

  const createEntityMutation = useMutation({
    mutationFn: (props: Record<string, JsonValue>) =>
      runtime.createEntity(ontologyKey, targetTypeKey!, props),
    onSuccess: (created) => {
      void queryClient.invalidateQueries({
        queryKey: qk.entities(ontologyKey, created._entityTypeKey),
      })
      toast.success(`${targetType?.displayName ?? 'Entity'} created`)
      setCreatingNew(false)
      pickTarget(created)
    },
    onError: (err) => {
      if (err instanceof ApiError && err.fieldErrors !== undefined) {
        setNewErrors(err.fieldErrors)
      } else {
        setFormError(err instanceof Error ? err.message : 'Failed to create entity')
      }
    },
  })

  const pending = createRelationMutation.isPending || createEntityMutation.isPending

  const pickTarget = (picked: EntityInstance) => {
    setFormError(null)
    setRelErrors({})
    if ((relationType?.properties.length ?? 0) === 0) {
      // No relation props to fill in — create right away, staying on the
      // picker (onError moves to the props step for a retry with context).
      createRelationMutation.mutate({ target: picked, props: {} })
    } else {
      setTarget(picked)
    }
  }

  const submitProps = () => {
    if (target === null || relationType === undefined) return
    const result = coerceDrafts(relationType.properties, relDrafts)
    setRelErrors(result.errors)
    if (!result.ok) return
    createRelationMutation.mutate({ target, props: result.values })
  }

  const submitNewEntity = () => {
    if (targetType === undefined) return
    const result = coerceDrafts(targetType.properties, newDrafts)
    setNewErrors(result.errors)
    if (!result.ok) return
    createEntityMutation.mutate(result.values)
  }

  /* --------------------------------- rendering -------------------------------- */

  const typeNameOf = (key: string) =>
    entityTypes.find((t) => t.key === key)?.displayName ?? key

  const pathSummary =
    choice !== null && targetTypeKey !== undefined ? (
      <span className="inline-flex flex-wrap items-center gap-1.5">
        {choice.direction === 'outgoing' ? (
          <>
            <span className="max-w-40 truncate font-medium text-foreground">{entityLabel}</span>
            <ArrowRight className="size-3.5" />
            <span>{choice.relationType.displayName}</span>
            <ArrowRight className="size-3.5" />
            <TypeChip typeKey={targetTypeKey} displayName={typeNameOf(targetTypeKey)} size="sm" />
          </>
        ) : (
          <>
            <TypeChip typeKey={targetTypeKey} displayName={typeNameOf(targetTypeKey)} size="sm" />
            <ArrowRight className="size-3.5" />
            <span>{choice.relationType.displayName}</span>
            <ArrowRight className="size-3.5" />
            <span className="max-w-40 truncate font-medium text-foreground">{entityLabel}</span>
          </>
        )}
      </span>
    ) : (
      'Pick how this entity should be connected.'
    )

  const backToType = options.length > 1 && initial?.direction === undefined

  return (
    <DialogContent className="sm:max-w-md">
        <DialogHeader>
          <DialogTitle>
            {step === 'create'
              ? `New ${targetType?.displayName ?? 'entity'}`
              : 'Add relation'}
          </DialogTitle>
          <DialogDescription asChild>
            <div>{pathSummary}</div>
          </DialogDescription>
        </DialogHeader>

        {step === 'type' && (
          <div className="flex flex-col gap-1.5">
            {options.length === 0 && (
              <p className="py-4 text-center text-[13px] text-muted-foreground">
                No relation types apply to this entity type.
              </p>
            )}
            {options.map((option) => {
              const rt = option.relationType
              const otherKey =
                option.direction === 'outgoing' ? rt.toEntityTypeKey : rt.fromEntityTypeKey
              // "This" entity renders as its label so the two directions of a
              // self-referential type are distinguishable.
              const me = (
                <span className="max-w-32 truncate font-medium">{entityLabel}</span>
              )
              const other = (
                <TypeChip typeKey={otherKey} displayName={typeNameOf(otherKey)} size="sm" />
              )
              return (
                <button
                  key={`${rt.key}:${option.direction}`}
                  type="button"
                  onClick={() => setChoice(option)}
                  className="flex items-center gap-1.5 rounded-lg border px-3 py-2 text-left text-[13px] transition-colors hover:bg-muted/60 focus-visible:outline-2 focus-visible:outline-ring/60"
                >
                  {option.direction === 'outgoing' ? me : other}
                  <ArrowRight className="size-3.5 shrink-0 text-muted-foreground" />
                  <span className="text-muted-foreground">{rt.displayName}</span>
                  <ArrowRight className="size-3.5 shrink-0 text-muted-foreground" />
                  {option.direction === 'outgoing' ? other : me}
                </button>
              )
            })}
          </div>
        )}

        {step === 'target' && targetType !== undefined && (
          <div className="space-y-2">
            <Command shouldFilter={false} className="rounded-lg border">
              <div className="flex items-center gap-2 border-b px-3">
                {targetSearch.isFetching ? (
                  <Loader2 className="size-4 shrink-0 animate-spin opacity-50" />
                ) : (
                  <TypeChip
                    typeKey={targetType.key}
                    displayName={targetType.displayName}
                    size="sm"
                  />
                )}
                <input
                  autoFocus
                  value={targetQuery}
                  onChange={(e) => setTargetQuery(e.target.value)}
                  placeholder={`Search ${targetType.displayName}…`}
                  className="h-9 w-full bg-transparent text-sm outline-hidden placeholder:text-muted-foreground"
                />
              </div>
              <CommandList className="max-h-52">
                <CommandItem
                  value="__create__"
                  onSelect={() => {
                    setCreatingNew(true)
                    setNewErrors({})
                    setFormError(null)
                  }}
                >
                  <Plus className="size-4 text-muted-foreground" />
                  New connected {targetType.displayName}…
                </CommandItem>
                {(targetSearch.data ?? []).map(({ entity: candidate, score }) => (
                  <CommandItem
                    key={candidate._id}
                    value={`target:${candidate._id}`}
                    disabled={pending}
                    onSelect={() => pickTarget(candidate)}
                  >
                    <span className="min-w-0 flex-1 truncate">{displayLabel(candidate)}</span>
                    {score !== undefined && (
                      <span className="font-mono text-[10px] text-muted-foreground">
                        {Math.round(score * 100)}%
                      </span>
                    )}
                  </CommandItem>
                ))}
                {!targetSearch.isFetching &&
                  (targetSearch.data?.length ?? 0) === 0 && (
                    <div className="px-4 py-4 text-center text-[13px] text-muted-foreground">
                      {debouncedQuery === ''
                        ? `No ${targetType.displayName} entities yet.`
                        : `No ${targetType.displayName} matches “${debouncedQuery}”.`}
                    </div>
                  )}
              </CommandList>
            </Command>
            {pending && (
              <p className="flex items-center gap-2 text-[13px] text-muted-foreground">
                <Loader2 className="size-3.5 animate-spin" /> Creating relation…
              </p>
            )}
          </div>
        )}

        {step === 'create' && targetType !== undefined && (
          <div className="space-y-3">
            {targetType.properties.length === 0 && (
              <p className="text-[13px] text-muted-foreground">
                {targetType.displayName} has no properties — it will be created empty.
              </p>
            )}
            {targetType.properties.map((property) => (
              <PropertyField
                key={property.key}
                property={property}
                idPrefix="new-target"
                draft={newDrafts[property.key] ?? ''}
                onDraftChange={(draft) =>
                  setNewDrafts((prev) => ({ ...prev, [property.key]: draft }))
                }
                error={newErrors[property.key]}
                disabled={pending}
              />
            ))}
          </div>
        )}

        {step === 'props' && relationType !== undefined && (
          <div className="space-y-3">
            <p className="text-[13px] text-muted-foreground">
              Linking{' '}
              <span className="font-medium text-foreground">
                {target !== null ? displayLabel(target) : ''}
              </span>
              {relationType.properties.length > 0
                ? ' — relation properties (optional unless marked):'
                : '…'}
            </p>
            {relationType.properties.map((property) => (
              <PropertyField
                key={property.key}
                property={property}
                idPrefix="rel"
                draft={relDrafts[property.key] ?? ''}
                onDraftChange={(draft) =>
                  setRelDrafts((prev) => ({ ...prev, [property.key]: draft }))
                }
                error={relErrors[property.key]}
                disabled={pending}
              />
            ))}
          </div>
        )}

        {formError !== null && (
          <p className="text-[13px] text-destructive">{formError}</p>
        )}

        <DialogFooter className="gap-2 sm:justify-between">
          <div>
            {step === 'target' && backToType && (
              <Button variant="ghost" size="sm" disabled={pending} onClick={() => setChoice(null)}>
                <ChevronLeft className="size-3.5" /> Back
              </Button>
            )}
            {step === 'create' && (
              <Button variant="ghost" size="sm" disabled={pending} onClick={() => setCreatingNew(false)}>
                <ChevronLeft className="size-3.5" /> Back
              </Button>
            )}
            {step === 'props' && (
              <Button variant="ghost" size="sm" disabled={pending} onClick={() => setTarget(null)}>
                <ChevronLeft className="size-3.5" /> Back
              </Button>
            )}
          </div>
          <div className="flex gap-2">
            <Button variant="outline" size="sm" disabled={pending} onClick={() => onOpenChange(false)}>
              Cancel
            </Button>
            {step === 'create' && (
              <Button size="sm" disabled={pending} onClick={submitNewEntity}>
                {createEntityMutation.isPending && (
                  <Loader2 className="size-3.5 animate-spin" />
                )}
                Create &amp; select
              </Button>
            )}
            {step === 'props' && (
              <Button size="sm" disabled={pending} onClick={submitProps}>
                {createRelationMutation.isPending && (
                  <Loader2 className="size-3.5 animate-spin" />
                )}
                Create relation
              </Button>
            )}
          </div>
        </DialogFooter>
      </DialogContent>
  )
}
