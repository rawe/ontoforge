/**
 * The properties of an entity or relation type: list, inline edit, add and
 * delete. `density="comfortable"` (classic type page) shows every column in
 * the collapsed row; `density="compact"` (graph inspector) shows key, display
 * name and data type. Same component, same hooks.
 *
 * Every edit is one immediate sparse update (display name, description,
 * required, default). Key and data type are permanent after creation.
 * Surfaces drive two one-shot requests: `openRequest` opens, highlights and
 * scrolls to a property; `addRequest` opens the add form. A new nonce or
 * number repeats the request.
 */

import { useEffect, useRef, useState, type ReactNode } from 'react'
import { Check, ChevronRight, Fingerprint, Lock, Plus, Tag, Trash2 } from 'lucide-react'
import type { DataType, EntityType, PropertyDefinition } from '@/api/types'
import { Badge } from '@/components/ui/badge'
import { Button } from '@/components/ui/button'
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@/components/ui/select'
import { Skeleton } from '@/components/ui/skeleton'
import { Switch } from '@/components/ui/switch'
import { Tooltip, TooltipContent, TooltipTrigger } from '@/components/ui/tooltip'
import { cn } from '@/lib/utils'
import { DATA_TYPE_DESCRIPTIONS } from '../lib'
import { InlineText } from '../shared'
import { TypedValueInput } from '../TypedValueInput'
import { useRequestDelete } from './deleteContext'
import { DescriptionText } from './DescriptionText'
import { fieldErrorsOf } from './errors'
import { useCreateProperty, useUpdateProperty } from './mutations'
import { NameKeyFields } from './NameKeyFields'
import { EMPTY_NAME_KEY, dataTypesFor, nameKeyValid, type NameKey } from './schemaKeys'
import { findType, useModelSchema, type TypeKind } from './useModelSchema'

/** Columns of a comfortable row: key, display name, type, required, default, description, chevron. */
const WIDE_COLUMNS = 'grid grid-cols-[1.1fr_1.1fr_0.7fr_0.5fr_0.8fr_1.6fr_1rem] gap-3'

interface PropertiesEditorProps {
  ontologyKey: string
  kind: TypeKind
  typeId: string
  density: 'compact' | 'comfortable'
  /** Open, highlight and scroll to a property; a new nonce repeats it. */
  openRequest?: { propertyId: string; nonce: number }
  /** Open the add form; a new number repeats it. */
  addRequest?: number
}

export function PropertiesEditor({
  ontologyKey,
  kind,
  typeId,
  density,
  openRequest,
  addRequest,
}: PropertiesEditorProps) {
  const schema = useModelSchema(ontologyKey)
  const type = findType(schema, kind, typeId)
  const properties = schema.properties[typeId]
  const [openId, setOpenId] = useState<string | null>(null)
  const [adding, setAdding] = useState(false)
  const [flash, setFlash] = useState<{ propertyId: string; nonce: number } | null>(null)
  const listRef = useRef<HTMLDivElement>(null)

  // One-shot requests, taken over while rendering (each nonce once). An open
  // request waits for the property list, so its row exists to scroll to.
  const [seenOpen, setSeenOpen] = useState<number | null>(null)
  if (openRequest !== undefined && openRequest.nonce !== seenOpen && properties !== undefined) {
    setSeenOpen(openRequest.nonce)
    setOpenId(openRequest.propertyId)
    setAdding(false)
    setFlash(openRequest)
  }
  const [seenAdd, setSeenAdd] = useState<number | null>(null)
  if (addRequest !== undefined && addRequest !== seenAdd) {
    setSeenAdd(addRequest)
    setOpenId(null)
    setAdding(true)
  }

  useEffect(() => {
    if (flash === null) return
    const frame = requestAnimationFrame(() => {
      listRef.current
        ?.querySelector(`[data-prop="${flash.propertyId}"]`)
        ?.scrollIntoView({ block: 'nearest', behavior: 'smooth' })
    })
    const timer = setTimeout(() => setFlash(null), 1600)
    return () => {
      cancelAnimationFrame(frame)
      clearTimeout(timer)
    }
  }, [flash])

  if (type === undefined) return null

  const nameProperty = kind === 'entity-types' ? (type as EntityType).nameProperty : null
  const identity = kind === 'entity-types' ? ((type as EntityType).identityProperties ?? []) : []
  const sorted = [...(properties ?? [])].sort((a, b) =>
    a.key === nameProperty ? -1 : b.key === nameProperty ? 1 : a.key.localeCompare(b.key),
  )
  const wide = density === 'comfortable'

  return (
    <section className="grid gap-2">
      <div className="flex items-center gap-2">
        <h2 className="text-[13px] font-semibold">Properties</h2>
        <span className="text-[13px] text-muted-foreground">{properties?.length ?? '…'}</span>
        {!adding && (
          <Button
            size={wide ? 'sm' : 'xs'}
            variant={wide ? 'default' : 'outline'}
            className="ml-auto"
            onClick={() => setAdding(true)}
          >
            <Plus /> Add property
          </Button>
        )}
      </div>

      {properties === undefined &&
        (schema.error === null ? (
          <Skeleton className="h-32 rounded-xl" />
        ) : (
          <p className="rounded-xl border border-dashed p-6 text-center text-[13px] text-muted-foreground">
            Failed to load: {schema.error.message}
          </p>
        ))}

      {properties !== undefined && properties.length === 0 && !adding && (
        <p className="rounded-xl border border-dashed p-4 text-center text-[13px] text-muted-foreground">
          No properties yet — instances of this type carry no fields.
        </p>
      )}

      {sorted.length > 0 && (
        <div ref={listRef} className="overflow-hidden rounded-lg border">
          {wide && (
            <div
              className={cn(
                WIDE_COLUMNS,
                'border-b bg-muted/40 px-3 py-1.5 text-[11px] font-medium text-muted-foreground',
              )}
            >
              <span>Key</span>
              <span>Display name</span>
              <span>Type</span>
              <span>Required</span>
              <span>Default</span>
              <span>Description</span>
              <span />
            </div>
          )}
          <ul className="divide-y">
            {sorted.map((p) => (
              <PropertyRow
                key={p.propertyId}
                ontologyKey={ontologyKey}
                kind={kind}
                typeId={typeId}
                property={p}
                isName={p.key === nameProperty}
                inIdentity={identity.includes(p.key)}
                open={openId === p.propertyId}
                flash={flash?.propertyId === p.propertyId}
                onToggle={() => setOpenId(openId === p.propertyId ? null : p.propertyId)}
                wide={wide}
              />
            ))}
          </ul>
        </div>
      )}

      {adding && (
        <AddPropertyForm
          ontologyKey={ontologyKey}
          kind={kind}
          typeId={typeId}
          wide={wide}
          onDone={() => setAdding(false)}
        />
      )}
    </section>
  )
}

/* ---------------------------------- rows ----------------------------------- */

interface RowProps {
  ontologyKey: string
  kind: TypeKind
  typeId: string
  property: PropertyDefinition
  isName: boolean
  /** Part of the type's identity: required, no default, not deletable. */
  inIdentity: boolean
  wide: boolean
}

/** Why an identity property's required flag, default and delete are locked. */
const IDENTITY_LOCK = 'Part of the identity: required, without a default. Remove it from the identity first.'


const shownDefault = (p: PropertyDefinition) =>
  p.defaultValue === null ? null : String(p.defaultValue)

function PropertyRow({
  open,
  flash,
  onToggle,
  ...rowProps
}: RowProps & { open: boolean; flash: boolean; onToggle: () => void }) {
  const { property: p, isName, inIdentity, wide } = rowProps
  const chevron = (
    <ChevronRight
      className={cn(
        'shrink-0 text-muted-foreground transition-transform',
        wide ? 'size-3.5' : 'size-3',
        open && 'rotate-90',
      )}
    />
  )
  return (
    <li
      data-prop={p.propertyId}
      className={cn(
        'scroll-my-3 transition-colors duration-700',
        open && 'bg-muted/30',
        flash && 'bg-(--tc-amber-bg)',
      )}
    >
      <button
        type="button"
        onClick={onToggle}
        aria-expanded={open}
        className={cn(
          'w-full cursor-pointer px-3 py-1.5 text-left transition-colors hover:bg-muted/50',
          wide && cn(WIDE_COLUMNS, 'items-center py-2'),
        )}
      >
        {wide ? (
          <>
            <KeyCell property={p} isName={isName} inIdentity={inIdentity} />
            <span className="truncate text-[13px]">{p.displayName}</span>
            <span>
              <Badge variant="secondary" className="font-mono text-[11px]">
                {p.dataType}
              </Badge>
            </span>
            <span>
              {p.required ? (
                <Check className="size-4 text-(--tc-emerald)" aria-label="Required" />
              ) : (
                <span className="text-muted-foreground/50">—</span>
              )}
            </span>
            <span className="truncate font-mono text-xs text-muted-foreground">
              {shownDefault(p) ?? '—'}
            </span>
            <span className="truncate text-[13px] text-muted-foreground">{p.description ?? ''}</span>
            {chevron}
          </>
        ) : (
          <span className="flex items-center gap-1.5">
            {chevron}
            <span className="min-w-0 flex-1">
              <KeyCell property={p} isName={isName} inIdentity={inIdentity} />
              <span className="block truncate text-[11.5px] text-muted-foreground">
                {p.displayName}
              </span>
            </span>
            <span className="font-mono text-[10.5px] text-muted-foreground">{p.dataType}</span>
          </span>
        )}
      </button>
      {open && <PropertyDetails {...rowProps} />}
    </li>
  )
}

function KeyCell({
  property: p,
  isName,
  inIdentity,
}: {
  property: PropertyDefinition
  isName: boolean
  inIdentity: boolean
}) {
  return (
    <span className="flex min-w-0 items-center gap-1 font-mono text-[12px]">
      <span className="truncate">{p.key}</span>
      {p.required && (
        <span className="text-(--tc-rose)" title="Required">
          *
        </span>
      )}
      {isName && (
        <Badge
          variant="outline"
          className="h-4 gap-0.5 px-1 font-sans text-[10px]"
          title="Name property — its value labels instances of this type"
        >
          <Tag className="size-2.5" /> name
        </Badge>
      )}
      {inIdentity && (
        <Badge
          variant="outline"
          className="h-4 gap-0.5 px-1 font-sans text-[10px]"
          title="Identity property — its value is part of the identity of instances of this type"
        >
          <Fingerprint className="size-2.5" /> identity
        </Badge>
      )}
    </span>
  )
}

/** Inline editor of one property; each field saves on its own. */
function PropertyDetails({ ontologyKey, kind, typeId, property: p, isName, inIdentity, wide }: RowProps) {
  const update = useUpdateProperty(ontologyKey, kind, typeId)
  const requestDelete = useRequestDelete()
  const stored = shownDefault(p)

  return (
    <div
      className={cn(
        'grid gap-2.5 px-3 pt-1 pb-3',
        wide ? 'grid-cols-2 gap-x-6' : 'grid-cols-[minmax(0,1fr)] pl-7',
      )}
    >
      <Field label="Display name">
        <InlineText
          aria-label="Property display name"
          value={p.displayName}
          onSave={(v) => {
            if (v !== '') update.mutate({ propertyId: p.propertyId, patch: { displayName: v } })
          }}
          className="-mx-1 px-1 text-[13px]"
          inputClassName="h-7 text-[13px]"
        />
      </Field>
      <Field label="Default">
        {/* Keyed by the stored value: a saved or refetched default re-seeds the draft. */}
        <DefaultInput
          key={stored ?? ''}
          dataType={p.dataType}
          stored={stored}
          disabled={inIdentity}
          onCommit={(next, revert) =>
            update.mutate(
              { propertyId: p.propertyId, patch: { defaultValue: next } },
              { onError: revert },
            )
          }
        />
      </Field>
      <Field label="Description">
        <DescriptionText
          aria-label="Property description"
          value={p.description}
          onSave={(v) => update.mutate({ propertyId: p.propertyId, patch: { description: v } })}
          className="-mx-1 block w-full px-1 text-[13px] text-muted-foreground"
        />
      </Field>
      <label className="flex items-center gap-2 self-start text-[13px]">
        <Switch
          size="sm"
          checked={p.required}
          aria-label="Required"
          disabled={inIdentity}
          title={inIdentity ? IDENTITY_LOCK : undefined}
          onCheckedChange={(v) => update.mutate({ propertyId: p.propertyId, patch: { required: v } })}
        />
        Required
        {inIdentity ? (
          <span className="text-[11px] text-muted-foreground">— part of the identity, locked</span>
        ) : p.required && p.defaultValue === null && (
          <span className="text-[11px] text-muted-foreground">— must be supplied on create</span>
        )}
      </label>
      <div className={cn('flex items-center gap-2', wide && 'col-span-2')}>
        <span
          className="flex min-w-0 flex-wrap items-center gap-1 text-[11px] text-muted-foreground"
          title="Key and data type are fixed at creation"
        >
          <Lock className="size-3" /> <span className="font-mono">{p.key}</span> ·{' '}
          <span className="font-mono">{p.dataType}</span> are permanent
        </span>
        <span className="flex-1" />
        {isName || inIdentity ? (
          <Tooltip>
            <TooltipTrigger asChild>
              {/* A disabled button gets no pointer events — the span carries the tooltip. */}
              <span tabIndex={0}>
                <Button variant="ghost" size="xs" disabled className="text-destructive">
                  <Trash2 /> Delete
                </Button>
              </span>
            </TooltipTrigger>
            <TooltipContent>
              {isName ? 'Choose another name property first' : 'Remove it from the identity first'}
            </TooltipContent>
          </Tooltip>
        ) : (
          <Button
            variant="ghost"
            size="xs"
            className="text-destructive hover:text-destructive"
            onClick={() =>
              requestDelete({ what: 'property', kind, typeId, propertyId: p.propertyId })
            }
          >
            <Trash2 /> Delete
          </Button>
        )}
      </div>
    </div>
  )
}

/**
 * Typed default input that commits on blur, Enter or a select change. An
 * empty value clears the default (`null`); a failed save shows the stored
 * value again.
 */
function DefaultInput({
  dataType,
  stored,
  disabled = false,
  onCommit,
}: {
  dataType: DataType
  stored: string | null
  /** An identity property has no default. */
  disabled?: boolean
  onCommit: (next: string | null, revert: () => void) => void
}) {
  const [draft, setDraft] = useState(stored ?? '')
  if (disabled) {
    return (
      <span className="text-[13px] text-muted-foreground" title={IDENTITY_LOCK}>
        No default — part of the identity
      </span>
    )
  }
  return (
    <TypedValueInput
      dataType={dataType}
      value={draft}
      onChange={setDraft}
      placeholder="No default"
      emptyLabel="No default"
      onCommit={(raw) => {
        const next = raw.trim() === '' ? null : raw.trim()
        if (next !== stored) onCommit(next, () => setDraft(stored ?? ''))
      }}
    />
  )
}

function Field({ label, children }: { label: string; children: ReactNode }) {
  return (
    <div className="grid gap-0.5">
      <span className="text-[11px] font-medium text-muted-foreground">{label}</span>
      {children}
    </div>
  )
}

/* -------------------------------- add form --------------------------------- */

function AddPropertyForm({
  ontologyKey,
  kind,
  typeId,
  wide,
  onDone,
}: {
  ontologyKey: string
  kind: TypeKind
  typeId: string
  wide: boolean
  onDone: () => void
}) {
  const { create, isPending } = useCreateProperty(ontologyKey, kind, typeId)
  const [nameKey, setNameKey] = useState<NameKey>(EMPTY_NAME_KEY)
  const [dataType, setDataType] = useState<DataType>('string')
  const [required, setRequired] = useState(false)
  const [defaultRaw, setDefaultRaw] = useState('')
  const [errors, setErrors] = useState<Record<string, string>>({})
  const [formError, setFormError] = useState<string | null>(null)
  // Bumped after each add: remounts the name field, which focuses it again.
  const [round, setRound] = useState(0)

  const formRef = useRef<HTMLFormElement>(null)
  useEffect(() => {
    formRef.current?.scrollIntoView({ block: 'nearest', behavior: 'smooth' })
  }, [])

  // Esc closes the form even when focus left it (after Add, focus can fall to
  // <body>). Capture phase, so it runs before page-level shortcuts. An open
  // select or dialog, or an input outside the form, takes Esc first.
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.key !== 'Escape' || e.defaultPrevented) return
      if (document.querySelector('[role="listbox"],[role="dialog"],[role="alertdialog"]') !== null) {
        return
      }
      const el = document.activeElement
      if (
        el !== null &&
        el !== document.body &&
        formRef.current?.contains(el) !== true &&
        el.closest('input,textarea') !== null
      ) {
        return
      }
      e.preventDefault()
      e.stopPropagation()
      onDone()
    }
    window.addEventListener('keydown', onKey, true)
    return () => window.removeEventListener('keydown', onKey, true)
  }, [onDone])

  const valid = nameKeyValid(nameKey)
  const submit = () => {
    if (!valid || isPending) return
    setErrors({})
    setFormError(null)
    const value = defaultRaw.trim()
    create(
      {
        key: nameKey.key,
        displayName: nameKey.name.trim(),
        dataType,
        required,
        defaultValue: value === '' ? null : value,
      },
      {
        onSuccess: () => {
          // Stay open for the next property.
          setNameKey(EMPTY_NAME_KEY)
          setRequired(false)
          setDefaultRaw('')
          setRound((r) => r + 1)
        },
        onError: (error) => {
          const fields = fieldErrorsOf(error)
          setErrors(fields)
          if (Object.keys(fields).length === 0) {
            setFormError(error instanceof Error ? error.message : String(error))
          }
        },
      },
    )
  }

  const requiredToggle = (
    <label className="flex items-center gap-1.5 text-[12px] font-medium">
      <Switch
        size="sm"
        checked={required}
        onCheckedChange={setRequired}
        aria-label="Required"
      />
      Required
    </label>
  )
  const typeHint = errors.dataType ?? DATA_TYPE_DESCRIPTIONS[dataType]

  return (
    <form
      ref={formRef}
      className="grid gap-2.5 rounded-lg border border-dashed bg-muted/20 p-3"
      onSubmit={(e) => {
        e.preventDefault()
        submit()
      }}
    >
      <div
        className={cn(
          'grid gap-2.5',
          wide && 'grid-cols-[1.4fr_0.8fr_auto_1fr] items-start gap-4',
        )}
      >
        <NameKeyFields
          key={round}
          idPrefix="new-prop"
          value={nameKey}
          onChange={setNameKey}
          placeholder="Property name, e.g. Start date"
          autoFocus
          errors={{ displayName: errors.displayName, key: errors.key }}
        />
        <div className={cn('grid gap-2.5', !wide && 'grid-cols-[1fr_auto] items-center')}>
          <Select
            value={dataType}
            onValueChange={(v) => {
              setDataType(v as DataType)
              setDefaultRaw('')
            }}
          >
            <SelectTrigger size="sm" className="w-full font-mono text-xs" aria-label="Data type">
              <SelectValue />
            </SelectTrigger>
            <SelectContent>
              {dataTypesFor(kind).map((t) => (
                <SelectItem key={t} value={t}>
                  <span className="font-mono text-xs">{t}</span>
                </SelectItem>
              ))}
            </SelectContent>
          </Select>
          {!wide && requiredToggle}
        </div>
        {wide && <div className="pt-1.5">{requiredToggle}</div>}
        <div className="grid gap-1">
          <TypedValueInput
            dataType={dataType}
            value={defaultRaw}
            onChange={setDefaultRaw}
            placeholder="Default (optional)"
            emptyLabel="No default"
          />
          {errors.defaultValue !== undefined && (
            <p className="text-[11px] text-destructive">{errors.defaultValue}</p>
          )}
        </div>
      </div>
      {typeHint !== undefined && (
        <p
          className={cn(
            'text-[11px]',
            errors.dataType !== undefined ? 'text-destructive' : 'text-muted-foreground',
          )}
        >
          {typeHint}
        </p>
      )}
      {formError !== null && <p className="text-xs text-destructive">{formError}</p>}
      <div className="flex items-center justify-end gap-2">
        <span className="mr-auto text-[11px] text-muted-foreground">Enter adds · Esc closes</span>
        <Button type="button" variant="ghost" size="xs" onClick={onDone}>
          Done
        </Button>
        <Button type="submit" size="xs" disabled={!valid || isPending}>
          <Plus /> Add
        </Button>
      </div>
    </form>
  )
}
