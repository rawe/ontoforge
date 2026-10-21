import { useMemo, useState, type FormEvent, type ReactNode } from 'react'
import type { JsonValue, SchemaEntityType, SchemaProperty } from '@/api/types'
import { PropertyField } from '@/components/schema/PropertyField'
import { coerceDrafts, valueToDraft } from '@/components/schema/propertyDraft'
import { changedProperties, editPatch } from '@/components/quickadd/entityEdit'

/** Required properties first, then optionals — schema order within each group. */
function orderedProperties(properties: readonly SchemaProperty[]): SchemaProperty[] {
  return [...properties].sort((a, b) => Number(b.required) - Number(a.required))
}

/** Drafts of the properties' defaults. */
function defaultDrafts(properties: readonly SchemaProperty[]): Record<string, string> {
  const drafts: Record<string, string> = {}
  for (const p of properties) {
    drafts[p.key] = p.defaultValue === null ? '' : valueToDraft(p.dataType, p.defaultValue)
  }
  return drafts
}

/** Drafts of an entity's values (a document's text is not loaded: its draft starts empty). */
function valueDrafts(
  properties: readonly SchemaProperty[],
  values: Readonly<Record<string, JsonValue>>,
): Record<string, string> {
  const drafts: Record<string, string> = {}
  for (const p of properties) drafts[p.key] = valueToDraft(p.dataType, values[p.key])
  return drafts
}

const changed = (drafts: Record<string, string>, initial: Record<string, string>) =>
  Object.keys(initial).some((key) => drafts[key] !== initial[key])

/** A parent relation's own properties, filled in above the entity's. */
export interface RelationFields {
  /** The parent relation type's key, for the heading "has_task properties". */
  relationTypeKey: string
  properties: readonly SchemaProperty[]
  serverErrors?: Record<string, string>
}

interface EntityFormProps {
  entityType: SchemaEntityType
  /**
   * Called with coerced wire values once client-side validation passes;
   * `relationValues` only with `relation`.
   */
  onSubmit: (values: Record<string, JsonValue>, relationValues: Record<string, JsonValue>) => void
  submitting?: boolean
  /** Per-field errors from the backend (`ApiError.fieldErrors`). */
  serverErrors?: Record<string, string>
  onDirtyChange?: (dirty: boolean) => void
  /** Rendered inside the <form> so buttons submit natively. */
  footer?: ReactNode
  idPrefix?: string
  /** The parent relation's properties of a create with a parent relation. */
  relation?: RelationFields
  /**
   * Edit mode: the drafts start from these values instead of the defaults,
   * only the changed properties are checked, and `onSubmit` gets just those
   * (a cleared one as null).
   */
  initialValues?: Record<string, JsonValue>
}

/**
 * Schema-driven create (or, with `initialValues`, edit) form for one entity type: required props first, one
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
  relation,
  initialValues,
}: EntityFormProps) {
  const properties = useMemo(() => orderedProperties(entityType.properties), [entityType])
  const relationProperties = useMemo(
    () => orderedProperties(relation?.properties ?? []),
    [relation?.properties],
  )

  const initialDrafts = useMemo(
    () => (initialValues === undefined ? defaultDrafts(properties) : valueDrafts(properties, initialValues)),
    [properties, initialValues],
  )
  const initialRelationDrafts = useMemo(
    () => defaultDrafts(relationProperties),
    [relationProperties],
  )

  const [drafts, setDrafts] = useState(initialDrafts)
  const [relationDrafts, setRelationDrafts] = useState(initialRelationDrafts)
  const [clientErrors, setClientErrors] = useState<Record<string, string>>({})
  const [relationErrors, setRelationErrors] = useState<Record<string, string>>({})

  /** Editing a field clears its stale error. */
  const clearError = (key: string) => (prev: Record<string, string>) => {
    if (prev[key] === undefined) return prev
    const rest = { ...prev }
    delete rest[key]
    return rest
  }

  const setDraft = (key: string, draft: string) => {
    const next = { ...drafts, [key]: draft }
    setDrafts(next)
    onDirtyChange?.(changed(next, initialDrafts) || changed(relationDrafts, initialRelationDrafts))
    setClientErrors(clearError(key))
  }

  const setRelationDraft = (key: string, draft: string) => {
    const next = { ...relationDrafts, [key]: draft }
    setRelationDrafts(next)
    onDirtyChange?.(changed(drafts, initialDrafts) || changed(next, initialRelationDrafts))
    setRelationErrors(clearError(key))
  }

  const handleSubmit = (e: FormEvent) => {
    e.preventDefault()
    if (submitting) return
    const checked =
      initialValues === undefined ? properties : changedProperties(properties, initialDrafts, drafts)
    const result = coerceDrafts(checked, drafts)
    const relationResult = coerceDrafts(relationProperties, relationDrafts)
    setClientErrors(result.errors)
    setRelationErrors(relationResult.errors)
    if (!result.ok || !relationResult.ok) return
    onSubmit(initialValues === undefined ? result.values : editPatch(checked, result.values), relationResult.values)
  }

  const fields = (
    list: readonly SchemaProperty[],
    values: Record<string, string>,
    onChange: (key: string, draft: string) => void,
    errors: Record<string, string>,
    server: Record<string, string> | undefined,
    prefix: string,
    focusFirst: boolean,
  ) =>
    list.map((p, i) => (
      <PropertyField
        key={p.key}
        property={p}
        draft={values[p.key] ?? ''}
        onDraftChange={(d) => onChange(p.key, d)}
        error={errors[p.key] ?? server?.[p.key]}
        autoFocus={focusFirst && i === 0}
        disabled={submitting}
        idPrefix={prefix}
      />
    ))

  return (
    <form onSubmit={handleSubmit} className="contents">
      <div className="max-h-[50dvh] space-y-3.5 overflow-y-auto px-0.5 py-0.5">
        {relation !== undefined && relationProperties.length > 0 && (
          <>
            <h4 className="font-mono text-[12px] font-semibold">
              {relation.relationTypeKey} properties
            </h4>
            {fields(
              relationProperties,
              relationDrafts,
              setRelationDraft,
              relationErrors,
              relation.serverErrors,
              `${idPrefix}-rel`,
              true,
            )}
            <h4 className="text-[12px] font-semibold">{entityType.displayName} properties</h4>
          </>
        )}
        {fields(
          properties,
          drafts,
          setDraft,
          clientErrors,
          serverErrors,
          idPrefix,
          relationProperties.length === 0,
        )}
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
