/**
 * The naming popover of the graph's create gestures: a new entity type, a new
 * relation type (after a connect drop on a node), or both (a drop on empty
 * canvas). Nothing reaches the server before Enter; Esc and Cancel close it.
 * The canvas does the writes (`onSubmit`) and reports a failure back, which
 * shows under the part that failed.
 */

import { useState, type ReactNode } from 'react'
import { ArrowRight } from 'lucide-react'
import type { EntityType } from '@/api/types'
import { TypeChip } from '@/components/TypeChip'
import { Button } from '@/components/ui/button'
import { fieldErrorsOf } from '../modeling/errors'
import { NameKeyFields } from '../modeling/NameKeyFields'
import { EMPTY_NAME_KEY, nameKeyValid, type NameKey } from '../modeling/schemaKeys'
import type { XY } from './geometry'

export const POPOVER_WIDTH = 320

/**
 * Where the popover sits in the canvas (pixels): below a point, or above it.
 * The popover clamps it into the canvas, also when the canvas narrows later.
 */
export type PopoverAnchor = { left: number; top: number } | { left: number; bottom: number }

/** `ghost` is the ghost node's flow position. */
export type PopoverState =
  | { mode: 'entity'; at: PopoverAnchor; ghost: XY }
  | {
      mode: 'relation'
      at: PopoverAnchor
      sourceId: string
      targetId: string
      /** Carried over when the combined gesture created the type but not the relation. */
      initial?: NameKey
      failure?: SubmitError
    }
  | { mode: 'entity+relation'; at: PopoverAnchor; ghost: XY; sourceId: string }

export interface PopoverValues {
  entity?: NameKey
  relation?: NameKey
}

/** A failed submit, routed to the part that failed. */
export interface SubmitError {
  part: 'entity' | 'relation'
  error: unknown
}

/** Height estimates, to choose above or below: one part, and both parts. */
export const POPOVER_HEIGHT = 160
export const COMBINED_POPOVER_HEIGHT = 280

export function CreatePopover({
  state,
  source,
  target,
  onSubmit,
  onCancel,
}: {
  state: PopoverState
  source?: EntityType
  target?: EntityType
  onSubmit: (values: PopoverValues) => Promise<SubmitError | null>
  onCancel: () => void
}) {
  const [entity, setEntity] = useState<NameKey>(EMPTY_NAME_KEY)
  const [relation, setRelation] = useState<NameKey>(
    state.mode === 'relation' ? (state.initial ?? EMPTY_NAME_KEY) : EMPTY_NAME_KEY,
  )
  const [pending, setPending] = useState(false)
  const [failure, setFailure] = useState<SubmitError | null>(
    state.mode === 'relation' ? (state.failure ?? null) : null,
  )

  const height = state.mode === 'entity+relation' ? COMBINED_POPOVER_HEIGHT : POPOVER_HEIGHT
  const needsEntity = state.mode !== 'relation'
  const needsRelation = state.mode !== 'entity'
  const valid = (!needsEntity || nameKeyValid(entity)) && (!needsRelation || nameKeyValid(relation))
  const self = state.mode === 'relation' && state.sourceId === state.targetId

  const submit = async () => {
    if (!valid || pending) return
    setPending(true)
    setFailure(null)
    const result = await onSubmit({
      entity: needsEntity ? entity : undefined,
      relation: needsRelation ? relation : undefined,
    })
    setPending(false)
    setFailure(result)
  }

  // Field errors go under their field. Anything else (a taken key answers 409
  // without field details) shows as a line under the part that failed.
  const errorsOf = (part: SubmitError['part']) => {
    if (failure?.part !== part) return { fields: {}, line: undefined }
    const fields = fieldErrorsOf(failure.error)
    const line =
      fields.displayName === undefined && fields.key === undefined
        ? failure.error instanceof Error
          ? failure.error.message
          : String(failure.error)
        : undefined
    return { fields, line }
  }
  const entityErrors = errorsOf('entity')
  const relationErrors = errorsOf('relation')

  return (
    <form
      aria-label="Name the new type"
      className="absolute z-20 grid gap-3 rounded-xl border bg-popover p-3 text-popover-foreground shadow-lg"
      style={{ ...clampedAnchor(state.at, height), width: POPOVER_WIDTH }}
      onSubmit={(e) => {
        e.preventDefault()
        void submit()
      }}
      onKeyDown={(e) => {
        // The popover's keys are its own: no canvas shortcut fires from here.
        e.stopPropagation()
        if (e.key === 'Escape') onCancel()
      }}
    >
      <div className="grid gap-1.5">
        <div className="text-[12px] font-semibold">
          {state.mode === 'entity' && 'New entity type'}
          {state.mode === 'relation' && (self ? 'New self-relation' : 'New relation type')}
          {state.mode === 'entity+relation' && 'New relation to a new entity type'}
        </div>
        {needsRelation && source !== undefined && (
          <div className="flex flex-wrap items-center gap-1 text-[11px]">
            <TypeChip typeKey={source.key} displayName={source.displayName} size="sm" />
            <ArrowRight className="size-3 text-muted-foreground" />
            {state.mode === 'entity+relation' ? (
              <span className="rounded-md border border-dashed border-primary/60 px-1.5 py-px text-primary">
                {entity.name.trim() || 'new type'}
              </span>
            ) : (
              target !== undefined && (
                <TypeChip typeKey={target.key} displayName={target.displayName} size="sm" />
              )
            )}
          </div>
        )}
      </div>

      {needsRelation && (
        <Part
          label={state.mode === 'entity+relation' ? 'Relation' : undefined}
          line={relationErrors.line}
        >
          <NameKeyFields
            idPrefix="create-rel"
            value={relation}
            onChange={setRelation}
            placeholder="Relation name, e.g. Works on"
            autoFocus
            errors={relationErrors.fields}
          />
        </Part>
      )}
      {needsEntity && (
        <Part
          label={state.mode === 'entity+relation' ? 'New entity type' : undefined}
          line={entityErrors.line}
        >
          <NameKeyFields
            idPrefix="create-ent"
            value={entity}
            onChange={setEntity}
            placeholder="Entity type name, e.g. Vehicle Owner"
            autoFocus={state.mode === 'entity'}
            errors={entityErrors.fields}
          />
        </Part>
      )}

      <div className="flex items-center gap-2">
        <span className="mr-auto text-[10.5px] text-muted-foreground">Enter creates · Esc cancels</span>
        <Button type="button" variant="ghost" size="xs" onClick={onCancel}>
          Cancel
        </Button>
        <Button type="submit" size="xs" disabled={!valid || pending}>
          {pending ? 'Creating…' : 'Create'}
        </Button>
      </div>
    </form>
  )
}

/** CSS keeps the popover 8 px inside the canvas, whatever the canvas's size is now. */
const within = (px: number, size: number) => `clamp(8px, ${px}px, calc(100% - ${size + 8}px))`

function clampedAnchor(at: PopoverAnchor, height: number) {
  const left = within(at.left, POPOVER_WIDTH)
  return 'top' in at ? { left, top: within(at.top, height) } : { left, bottom: within(at.bottom, height) }
}

function Part({ label, line, children }: { label?: string; line?: string; children: ReactNode }) {
  return (
    <div className="grid gap-1">
      {label !== undefined && <span className="text-[11px] font-medium text-muted-foreground">{label}</span>}
      {children}
      {line !== undefined && <p className="text-[11px] text-destructive">{line}</p>}
    </div>
  )
}
