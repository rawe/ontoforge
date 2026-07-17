import { useMutation, useQueryClient } from '@tanstack/react-query'
import { Loader2 } from 'lucide-react'
import { useState, type KeyboardEvent } from 'react'
import { toast } from 'sonner'
import { ApiError } from '@/api/http'
import { qk } from '@/api/queryKeys'
import * as runtime from '@/api/runtime'
import type {
  EntityInstance,
  JsonPrimitive,
  SchemaEntityType,
  SchemaProperty,
} from '@/api/types'
import { DocumentPropertyRow } from '@/components/entity/DocumentPropertyRow'
import { PropertyInput } from '@/components/schema/PropertyField'
import {
  coerceDraft,
  formatValue,
  valueToDraft,
} from '@/components/schema/propertyDraft'
import { Tooltip, TooltipContent, TooltipTrigger } from '@/components/ui/tooltip'
import { cn } from '@/lib/utils'

/* ------------------------------- property row ------------------------------- */

interface PropertyRowProps {
  ontologyKey: string
  entity: EntityInstance
  property: SchemaProperty
}

function PropertyRow({ ontologyKey, entity, property }: PropertyRowProps) {
  const queryClient = useQueryClient()
  const [editing, setEditing] = useState(false)
  const [draft, setDraft] = useState('')
  const [error, setError] = useState<string | null>(null)

  const mutation = useMutation({
    mutationFn: (value: JsonPrimitive | null) =>
      runtime.updateEntity(ontologyKey, entity._entityTypeKey, entity._id, {
        [property.key]: value,
      }),
    onSuccess: (updated) => {
      queryClient.setQueryData(
        qk.entity(ontologyKey, entity._entityTypeKey, entity._id),
        updated,
      )
      void queryClient.invalidateQueries({
        queryKey: qk.entities(ontologyKey, entity._entityTypeKey),
      })
      setEditing(false)
      setError(null)
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
    setDraft(valueToDraft(property.dataType, entity[property.key]))
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
    if (result.value === (entity[property.key] ?? null)) {
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
          className={cn(
            '-mx-1.5 min-h-7 rounded-md px-1.5 py-1 text-left text-[13px] break-words whitespace-pre-wrap',
            'transition-colors duration-100 hover:bg-muted/60',
            'focus-visible:outline-2 focus-visible:outline-ring/60',
            mono,
            rendered === null && 'text-muted-foreground/50',
          )}
          aria-label={`Edit ${property.displayName}`}
        >
          {rendered ?? '—'}
        </button>
      )}
    </div>
  )
}

/* ------------------------------ properties card ------------------------------ */

interface PropertiesCardProps {
  ontologyKey: string
  entityType: SchemaEntityType
  entity: EntityInstance
}

/**
 * All schema properties of the entity, click-to-edit inline. Enter saves a
 * single-field PATCH, Esc cancels; API field errors render under the input.
 * Empty optional properties show as a dimmed "—" and are editable too.
 * Document properties render last as collapsed rows (stub badge; expanding
 * fetches and renders the Markdown, editing opens a Write/Preview dialog).
 */
export function PropertiesCard({ ontologyKey, entityType, entity }: PropertiesCardProps) {
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
              entity={entity}
              property={property}
            />
          ))}
          {documentProperties.map((property) => (
            <DocumentPropertyRow
              key={property.key}
              ontologyKey={ontologyKey}
              entity={entity}
              property={property}
            />
          ))}
        </div>
      )}
    </section>
  )
}
