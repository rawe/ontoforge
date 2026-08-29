import { useMutation, useQueryClient } from '@tanstack/react-query'
import { ArrowRight, ChevronLeft, Loader2 } from 'lucide-react'
import { useMemo, useState } from 'react'
import { toast } from 'sonner'
import { ApiError } from '@/api/http'
import * as runtime from '@/api/runtime'
import type {
  EntityInstance,
  RelationInstance,
  SchemaEntityType,
  SchemaRelationType,
} from '@/api/types'
import { TypeChip } from '@/components/TypeChip'
import { invalidateNeighborhood } from '@/components/entity/useNeighborCounts'
import { PropertyField } from '@/components/schema/PropertyField'
import { coerceDrafts } from '@/components/schema/propertyDraft'
import { Button } from '@/components/ui/button'
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from '@/components/ui/dialog'
import { displayLabel } from '@/lib/displayLabel'
import { connectOptions, type ConnectOption } from './workingSet'

export interface ConnectPair {
  source: EntityInstance
  target: EntityInstance
}

interface ConnectDialogProps {
  lensKey: string
  pair: ConnectPair | null
  entityTypes: readonly SchemaEntityType[]
  relationTypes: readonly SchemaRelationType[]
  onClose: () => void
  onCreated: (relation: RelationInstance) => void
}

/**
 * Drag-connect dialog: offers only the relation types valid between the two
 * dragged nodes (either direction), an optional relation-props form, then
 * POSTs the relation. The caller adds the resulting edge via `onCreated`.
 */
export function ConnectDialog({ pair, onClose, ...rest }: ConnectDialogProps) {
  return (
    <Dialog open={pair !== null} onOpenChange={(open) => !open && onClose()}>
      {pair !== null && <ConnectFlow pair={pair} onClose={onClose} {...rest} />}
    </Dialog>
  )
}

function ConnectFlow({
  lensKey,
  pair,
  entityTypes,
  relationTypes,
  onClose,
  onCreated,
}: Omit<ConnectDialogProps, 'pair'> & { pair: ConnectPair }) {
  const queryClient = useQueryClient()
  const options = useMemo(
    () => connectOptions(pair.source, pair.target, relationTypes),
    [pair, relationTypes],
  )
  const [choice, setChoice] = useState<ConnectOption | null>(
    options.length === 1 ? options[0]! : null,
  )
  const [drafts, setDrafts] = useState<Record<string, string>>({})
  const [errors, setErrors] = useState<Record<string, string>>({})
  const [formError, setFormError] = useState<string | null>(null)

  const typeNameOf = (key: string) =>
    entityTypes.find((t) => t.key === key)?.displayName ?? key

  const createMutation = useMutation({
    mutationFn: (vars: { option: ConnectOption; props: Record<string, string> }) => {
      const result = coerceDrafts(vars.option.relationType.properties, vars.props)
      if (!result.ok) {
        setErrors(result.errors)
        return Promise.reject(new Error('__validation__'))
      }
      return runtime.createRelation(lensKey, vars.option.relationType.key, {
        fromEntityId: vars.option.from._id,
        toEntityId: vars.option.to._id,
        ...result.values,
      })
    },
    onSuccess: (created, vars) => {
      invalidateNeighborhood(
        queryClient,
        lensKey,
        vars.option.from._entityTypeKey,
        vars.option.from._id,
      )
      invalidateNeighborhood(
        queryClient,
        lensKey,
        vars.option.to._entityTypeKey,
        vars.option.to._id,
      )
      toast.success(
        `${vars.option.relationType.displayName}: ${displayLabel(vars.option.from)} → ${displayLabel(vars.option.to)}`,
      )
      onCreated(created)
      onClose()
    },
    onError: (err) => {
      if (err.message === '__validation__') return
      if (err instanceof ApiError && err.fieldErrors !== undefined) {
        setErrors(err.fieldErrors)
        const endpointError = err.fieldErrors.fromEntityId ?? err.fieldErrors.toEntityId
        setFormError(endpointError ?? null)
      } else {
        setFormError(err instanceof Error ? err.message : 'Failed to create relation')
      }
    },
  })

  const pending = createMutation.isPending

  const optionRow = (option: ConnectOption) => (
    <span className="inline-flex min-w-0 flex-wrap items-center gap-1.5">
      <span className="max-w-32 truncate font-medium">{displayLabel(option.from)}</span>
      <ArrowRight className="size-3.5 shrink-0 text-muted-foreground" />
      <span className="text-muted-foreground">{option.relationType.displayName}</span>
      <ArrowRight className="size-3.5 shrink-0 text-muted-foreground" />
      <span className="max-w-32 truncate font-medium">{displayLabel(option.to)}</span>
    </span>
  )

  return (
    <DialogContent className="sm:max-w-md">
      <DialogHeader>
        <DialogTitle>Connect entities</DialogTitle>
        <DialogDescription asChild>
          <div>
            {choice !== null ? (
              optionRow(choice)
            ) : (
              <span className="inline-flex flex-wrap items-center gap-1.5">
                <TypeChip
                  typeKey={pair.source._entityTypeKey}
                  displayName={typeNameOf(pair.source._entityTypeKey)}
                  size="sm"
                />
                <span className="max-w-36 truncate">{displayLabel(pair.source)}</span>
                <span aria-hidden>·</span>
                <TypeChip
                  typeKey={pair.target._entityTypeKey}
                  displayName={typeNameOf(pair.target._entityTypeKey)}
                  size="sm"
                />
                <span className="max-w-36 truncate">{displayLabel(pair.target)}</span>
              </span>
            )}
          </div>
        </DialogDescription>
      </DialogHeader>

      {choice === null ? (
        <div className="flex flex-col gap-1.5">
          {options.map((option) => (
            <button
              key={`${option.relationType.key}:${option.from._id}:${option.to._id}`}
              type="button"
              onClick={() => setChoice(option)}
              className="flex items-center gap-1.5 rounded-lg border px-3 py-2 text-left text-[13px] transition-colors hover:bg-muted/60 focus-visible:outline-2 focus-visible:outline-ring/60"
            >
              {optionRow(option)}
            </button>
          ))}
        </div>
      ) : (
        <div className="space-y-3">
          {choice.relationType.properties.length === 0 ? (
            <p className="text-[13px] text-muted-foreground">
              {choice.relationType.displayName} has no properties — the relation is
              created as-is.
            </p>
          ) : (
            choice.relationType.properties.map((property) => (
              <PropertyField
                key={property.key}
                property={property}
                idPrefix="connect"
                draft={drafts[property.key] ?? ''}
                onDraftChange={(draft) =>
                  setDrafts((prev) => ({ ...prev, [property.key]: draft }))
                }
                error={errors[property.key]}
                disabled={pending}
              />
            ))
          )}
        </div>
      )}

      {formError !== null && <p className="text-[13px] text-destructive">{formError}</p>}

      <DialogFooter className="gap-2 sm:justify-between">
        <div>
          {choice !== null && options.length > 1 && (
            <Button variant="ghost" size="sm" disabled={pending} onClick={() => setChoice(null)}>
              <ChevronLeft className="size-3.5" /> Back
            </Button>
          )}
        </div>
        <div className="flex gap-2">
          <Button variant="outline" size="sm" disabled={pending} onClick={onClose}>
            Cancel
          </Button>
          {choice !== null && (
            <Button
              size="sm"
              disabled={pending}
              onClick={() => {
                setFormError(null)
                createMutation.mutate({ option: choice, props: drafts })
              }}
            >
              {pending && <Loader2 className="size-3.5 animate-spin" />}
              Create relation
            </Button>
          )}
        </div>
      </DialogFooter>
    </DialogContent>
  )
}
