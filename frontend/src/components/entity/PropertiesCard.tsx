import { useMutation, useQueryClient } from '@tanstack/react-query'
import { Loader2 } from 'lucide-react'
import { useState, type KeyboardEvent } from 'react'
import { toast } from 'sonner'
import { ApiError } from '@/api/http'
import { qk } from '@/api/queryKeys'
import type {
  EntityInstance,
  JsonPrimitive,
  SchemaEntityType,
  SchemaProperty,
} from '@/api/types'
import { useRuntimeWrites } from '@/api/writes'
import { useAccess } from '@/components/auth/useAccess'
import { MarkerChip } from '@/components/changesets/MarkerChip'
import { DocumentPropertyRow } from '@/components/entity/DocumentPropertyRow'
import type { StagedField } from '@/components/entity/stagedFields'
import { PropertyInput } from '@/components/schema/PropertyField'
import {
  coerceDraft,
  formatValue,
  valueToDraft,
} from '@/components/schema/propertyDraft'
import { Tooltip, TooltipContent, TooltipTrigger } from '@/components/ui/tooltip'
import { displayLabel } from '@/lib/displayLabel'
import { cn } from '@/lib/utils'

/* ------------------------------- property row ------------------------------- */

interface PropertyRowProps {
  ontologyKey: string
  lensKey: string
  entity: EntityInstance
  property: SchemaProperty
  /** Set while the pinned changeset sets this property. */
  staged?: StagedField
}

function PropertyRow({ ontologyKey, lensKey, entity, property, staged }: PropertyRowProps) {
  const queryClient = useQueryClient()
  const writes = useRuntimeWrites(ontologyKey, lensKey)
  // A Reader sees the values; the click-to-edit button is disabled.
  const canWrite = useAccess().canWrite(ontologyKey, lensKey)
  const [editing, setEditing] = useState(false)
  const [draft, setDraft] = useState('')
  const [error, setError] = useState<string | null>(null)
  // Edits start from, and compare with, the value shown: the staged one, else the stored one.
  const shown = staged === undefined ? entity[property.key] : staged.value

  const mutation = useMutation({
    mutationFn: (value: JsonPrimitive | null) =>
      writes.updateEntity(entity._entityTypeKey, entity._id, { [property.key]: value }),
    onSuccess: (outcome) => {
      setEditing(false)
      setError(null)
      // Staged: the field closes on the stored value.
      if (outcome.kind === 'staged') {
        writes.toastStaged(outcome)
        return
      }
      const updated = outcome.value
      queryClient.setQueryData(
        qk.entity(ontologyKey, lensKey, entity._entityTypeKey, entity._id),
        updated,
      )
      void queryClient.invalidateQueries({
        queryKey: qk.entities(ontologyKey, lensKey, entity._entityTypeKey),
      })
      toast.success(`${property.displayName} saved`)
    },
    onError: (err) => {
      if (err instanceof ApiError) {
        setError(err.fieldErrors?.[property.key] ?? err.message)
      } else {
        setError(err instanceof Error ? err.message : 'Save failed')
      }
    },
  })

  const startEdit = () => {
    if (mutation.isPending) return
    setDraft(valueToDraft(property.dataType, shown))
    setError(null)
    setEditing(true)
  }

  const cancel = () => {
    setEditing(false)
    setError(null)
    mutation.reset()
  }

  const save = (nextDraft: string = draft) => {
    const result = coerceDraft(property.dataType, nextDraft)
    if (!result.ok) {
      setError(result.error)
      return
    }
    if (result.value === null && property.required) {
      setError('Required — cannot be cleared')
      return
    }
    // No-op saves just close the editor.
    if (result.value === (shown ?? null)) {
      cancel()
      return
    }
    mutation.mutate(result.value)
  }

  const handleKeyDown = (e: KeyboardEvent<HTMLElement>) => {
    if (e.key === 'Escape') {
      e.preventDefault()
      cancel()
    } else if (e.key === 'Enter' && !(e.currentTarget.tagName === 'TEXTAREA' && e.shiftKey)) {
      e.preventDefault()
      save()
    }
  }

  const rendered = formatValue(property.dataType, entity[property.key])
  const mono =
    property.dataType !== 'string' ? 'font-mono text-xs' : undefined

  return (
    <div className="grid grid-cols-[130px_minmax(0,1fr)] items-start gap-3 px-4 py-2">
      <Tooltip>
        <TooltipTrigger asChild>
          <span className="mt-1 truncate text-[12.5px] text-muted-foreground">
            {property.displayName}
            {property.required && (
              <span aria-hidden className="ml-0.5 text-destructive">
                *
              </span>
            )}
          </span>
        </TooltipTrigger>
        <TooltipContent side="left">
          <span className="font-mono">
            {property.key} · {property.dataType}
          </span>
        </TooltipContent>
      </Tooltip>

      {editing ? (
        <div className="space-y-1">
          <div className="flex items-center gap-2">
            <div className="min-w-0 flex-1">
              <PropertyInput
                property={property}
                draft={draft}
                onDraftChange={(next) => {
                  setDraft(next)
                  // Booleans save on toggle — no separate confirm step.
                  if (property.dataType === 'boolean') save(next)
                }}
                autoFocus
                invalid={error !== null}
                disabled={mutation.isPending}
                onKeyDown={handleKeyDown}
              />
            </div>
            {mutation.isPending && (
              <Loader2 className="size-3.5 shrink-0 animate-spin text-muted-foreground" />
            )}
          </div>
          {error !== null && <p className="text-xs text-destructive">{error}</p>}
          {error === null && !mutation.isPending && (
            <p className="text-[10.5px] text-muted-foreground">
              ↵ save · esc cancel
            </p>
          )}
        </div>
      ) : (
        <button
          type="button"
          onClick={startEdit}
          disabled={!canWrite}
          className={cn(
            '-mx-1.5 min-h-7 rounded-md px-1.5 py-1 text-left text-[13px] break-words whitespace-pre-wrap',
            'transition-colors duration-100 enabled:hover:bg-muted/60',
            'focus-visible:outline-2 focus-visible:outline-ring/60',
            mono,
            rendered === null && 'text-muted-foreground/50',
          )}
          aria-label={canWrite ? `Edit ${property.displayName}` : undefined}
        >
          {staged === undefined ? (
            (rendered ?? '—')
          ) : (
            // The staged value in the changeset's amber, the stored one struck through.
            <>
              <s className="text-muted-foreground">{rendered ?? '—'}</s>{' '}
              <span className="text-(--tc-amber)">{formatValue(property.dataType, staged.value) ?? '—'}</span>
              {staged.drift !== null && (
                <>
                  {' '}
                  <MarkerChip marker={staged.drift} />
                </>
              )}
            </>
          )}
        </button>
      )}
    </div>
  )
}

/* ------------------------------ properties card ------------------------------ */

interface PropertiesCardProps {
  ontologyKey: string
  lensKey: string
  entityType: SchemaEntityType
  entity: EntityInstance
  /** While a changeset is pinned: the properties its writes set, and its id. */
  staged?: { changesetId: string; fields: Record<string, StagedField> }
}

/**
 * All schema properties of the entity, click-to-edit inline. Enter saves a
 * single-field PATCH, Esc cancels; API field errors render under the input.
 * Empty optional properties show as a dimmed "—" and are editable too.
 * Document properties render last as collapsed rows (stub badge; expanding
 * fetches and renders the Markdown, editing opens a Write/Preview dialog).
 * A property the pinned changeset sets shows its staged value beside the stored one.
 */
export function PropertiesCard({ ontologyKey, lensKey, entityType, entity, staged }: PropertiesCardProps) {
  const scalarProperties = entityType.properties.filter((p) => p.dataType !== 'document')
  const documentProperties = entityType.properties.filter(
    (p) => p.dataType === 'document',
  )
  return (
    <section className="overflow-hidden rounded-xl border bg-card">
      <header className="flex items-center border-b bg-muted/30 px-4 py-2">
        <h2 className="text-[13px] font-semibold">Properties</h2>
      </header>
      {entityType.properties.length === 0 ? (
        <p className="px-4 py-8 text-center text-[13px] text-muted-foreground">
          This type defines no properties.
        </p>
      ) : (
        <div className="divide-y divide-border/60">
          {scalarProperties.map((property) => (
            <PropertyRow
              key={property.key}
              ontologyKey={ontologyKey}
              lensKey={lensKey}
              entity={entity}
              property={property}
              staged={staged?.fields[property.key]}
            />
          ))}
          {documentProperties.map((property) => (
            <DocumentPropertyRow
              key={property.key}
              ontologyKey={ontologyKey}
              lensKey={lensKey}
              entity={entity}
              property={property}
              staged={staged?.fields[property.key]}
              changesetId={staged?.changesetId}
              entityLabel={displayLabel(entity, entityType.nameProperty)}
            />
          ))}
        </div>
      )}
    </section>
  )
}
