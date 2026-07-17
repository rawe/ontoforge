import { useMemo, useState, type FormEvent, type ReactNode } from 'react'
import type { JsonValue, SchemaEntityType, SchemaProperty } from '@/api/types'
import { PropertyField } from '@/components/schema/PropertyField'
import { coerceDrafts, valueToDraft } from '@/components/schema/propertyDraft'

/** Required properties first, then optionals — schema order within each group. */
function orderedProperties(type: SchemaEntityType): SchemaProperty[] {
  return [...type.properties].sort((a, b) => Number(b.required) - Number(a.required))
}

interface EntityFormProps {
  entityType: SchemaEntityType
  /** Called with coerced wire values once client-side validation passes. */
  onSubmit: (values: Record<string, JsonValue>) => void
  submitting?: boolean
  /** Per-field errors from the backend (`ApiError.fieldErrors`). */
  serverErrors?: Record<string, string>
  onDirtyChange?: (dirty: boolean) => void
  /** Rendered inside the <form> so buttons submit natively. */
  footer?: ReactNode
  idPrefix?: string
}

/**
 * Schema-driven create form for one entity type: required props first, one
 * PropertyField per property, drafts coerced on submit (collecting all
 * errors), server field errors merged in. Enter submits (native form
 * semantics — textareas keep newline behavior).
 */
export function EntityForm({
  entityType,
  onSubmit,
  submitting = false,
  serverErrors,
  onDirtyChange,
  footer,
  idPrefix = 'qa',
}: EntityFormProps) {
  const properties = useMemo(() => orderedProperties(entityType), [entityType])

  const initialDrafts = useMemo(() => {
    const drafts: Record<string, string> = {}
    for (const p of properties) {
      drafts[p.key] = p.defaultValue === null ? '' : valueToDraft(p.dataType, p.defaultValue)
    }
    return drafts
  }, [properties])

  const [drafts, setDrafts] = useState(initialDrafts)
  const [clientErrors, setClientErrors] = useState<Record<string, string>>({})

  const setDraft = (key: string, draft: string) => {
    const next = { ...drafts, [key]: draft }
    setDrafts(next)
    onDirtyChange?.(properties.some((p) => next[p.key] !== initialDrafts[p.key]))
    // Editing a field clears its stale error.
    setClientErrors((prev) => {
      if (prev[key] === undefined) return prev
      const rest = { ...prev }
      delete rest[key]
      return rest
    })
  }

  const handleSubmit = (e: FormEvent) => {
    e.preventDefault()
    if (submitting) return
    const result = coerceDrafts(properties, drafts)
    setClientErrors(result.errors)
    if (!result.ok) return
    onSubmit(result.values)
  }

  return (
    <form onSubmit={handleSubmit} className="contents">
      <div className="max-h-[50dvh] space-y-3.5 overflow-y-auto px-0.5 py-0.5">
        {properties.map((p, i) => (
          <PropertyField
            key={p.key}
            property={p}
            draft={drafts[p.key] ?? ''}
            onDraftChange={(d) => setDraft(p.key, d)}
            error={clientErrors[p.key] ?? serverErrors?.[p.key]}
            autoFocus={i === 0}
            disabled={submitting}
            idPrefix={idPrefix}
          />
        ))}
        {properties.length === 0 && (
          <p className="py-2 text-[13px] text-muted-foreground">
            This type has no properties — the entity is created empty.
          </p>
        )}
      </div>
      {footer}
    </form>
  )
}
