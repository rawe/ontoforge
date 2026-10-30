import { useQuery } from '@tanstack/react-query'
import { ListFilter } from 'lucide-react'
import { useState } from 'react'
import { listEntities } from '@/api/runtime'
import type { DataType } from '@/api/types'
import { useDebouncedValue } from '@/components/palette/usePaletteSearch'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { Popover, PopoverContent, PopoverTrigger } from '@/components/ui/popover'
import {
  Select,
  SelectContent,
  SelectGroup,
  SelectItem,
  SelectLabel,
  SelectTrigger,
  SelectValue,
} from '@/components/ui/select'
import {
  OP_VALUE,
  RELATION_OPS,
  opLabel,
  opsForDataType,
  relationSubject,
  subjectKey,
  subjectProperty,
  type FilterCondition,
  type FilterOpUi,
  type FilterSubject,
  type FilterSubjects,
} from './filters'

let filterSeq = 0

function inputTypeFor(dataType: DataType): string {
  switch (dataType) {
    case 'integer':
    case 'float':
      return 'number'
    case 'date':
      return 'date'
    case 'datetime':
      return 'datetime-local'
    default:
      return 'text'
  }
}

/** Where value suggestions come from: the lens, and the listed type. */
export interface FilterValueSource {
  ontologyKey: string
  lensKey: string
  typeKey: string
}

const SUGGESTIONS = 8

/**
 * Values a string property holds on entities of a type, containing the typed
 * text: one page of the type's list filtered on the property itself, its
 * distinct values. A hint to pick from, not every value there is.
 */
function useValueSuggestions(
  source: FilterValueSource | undefined,
  typeKey: string | undefined,
  propertyKey: string | undefined,
  text: string,
) {
  const q = useDebouncedValue(text.trim(), 200)
  const enabled = source !== undefined && typeKey !== undefined && propertyKey !== undefined
  return useQuery({
    queryKey: ['filter-values', source?.ontologyKey, source?.lensKey, typeKey, propertyKey, q] as const,
    queryFn: async () => {
      const page = await listEntities(source!.ontologyKey, source!.lensKey, typeKey!, {
        limit: 50,
        sort: propertyKey,
        order: 'asc',
        fields: [propertyKey!],
        ...(q !== '' ? { filter: { [propertyKey!]: { op: 'contains', value: q } } } : {}),
      })
      const values = page.items
        .map((e) => e[propertyKey!])
        .filter((v): v is string => typeof v === 'string' && v !== '')
      return [...new Set(values)].slice(0, SUGGESTIONS)
    },
    enabled,
    staleTime: 30_000,
    // Keep the last values while the text changes, never across another property.
    placeholderData: (previous, query) =>
      query?.queryKey[3] === typeKey && query?.queryKey[4] === propertyKey ? previous : undefined,
  })
}

/** The choice under a relation: whether it exists, or a property reached through it. */
type RelationTarget = 'exists' | 'missing' | `.${string}` | `@${string}`

/**
 * "Filter" toolbar button + popover: pick a subject — a property, or a
 * relation type in one direction and then whether it exists or a property of
 * the entity at its other end or of the relation itself (a query path) — an
 * operator it offers, and value(s); applying calls `onAdd` with a
 * FilterCondition. With `values`, a text value offers what the property holds
 * on entities to pick from. A subject holds one condition, so the popover says
 * when applying replaces an active one. `excludedOps` keeps operators a
 * caller's endpoint rejects out of the list.
 */
export function FilterPopover({
  subjects,
  active,
  onAdd,
  excludedOps = [],
  values,
}: {
  subjects: FilterSubjects
  active: readonly FilterCondition[]
  onAdd: (condition: FilterCondition) => void
  excludedOps?: readonly FilterOpUi[]
  values?: FilterValueSource
}) {
  const [open, setOpen] = useState(false)
  const [selectedKey, setSelectedKey] = useState<string>()
  const [target, setTarget] = useState<RelationTarget>()
  const [op, setOp] = useState<FilterOpUi>()
  const [value, setValue] = useState('')
  const [value2, setValue2] = useState('')

  const ownProperty = subjects.properties.find((p) => p.key === selectedKey)
  const relation = subjects.relations.find(
    (r) => subjectKey(relationSubject(r)) === selectedKey,
  )
  const subject: FilterSubject | undefined =
    ownProperty !== undefined
      ? { kind: 'property', propertyKey: ownProperty.key }
      : relation === undefined || target === undefined
        ? undefined
        : target === 'exists' || target === 'missing'
          ? relationSubject(relation)
          : {
              kind: 'path',
              relationTypeKey: relation.relationType.key,
              direction: relation.direction,
              on: target.startsWith('.') ? 'entity' : 'relation',
              propertyKey: target.slice(1),
            }
  const property = subject !== undefined ? subjectProperty(subject, subjects) : undefined
  const offered = (dataType: DataType | undefined) =>
    (dataType !== undefined ? opsForDataType(dataType) : RELATION_OPS).filter(
      (o) => !excludedOps.includes(o),
    )
  const ops: readonly FilterOpUi[] = property !== undefined ? offered(property.dataType) : []
  const shape = op !== undefined ? OP_VALUE[op] : undefined
  const replaces = subject !== undefined && active.some((f) => subjectKey(f.subject) === subjectKey(subject))

  // Suggestions for a text value: the listed type's own values, or the
  // related entity's; a relation's own properties have none.
  const suggestType =
    subject?.kind === 'property' ? values?.typeKey : subject?.kind === 'path' && subject.on === 'entity' ? relation?.otherType.key : undefined
  const suggesting =
    property?.dataType === 'string' && shape === 'value' && !property.key.startsWith('_')
  const suggestions = useValueSuggestions(
    values,
    suggesting ? suggestType : undefined,
    suggesting ? property.key : undefined,
    value,
  )
  const picks = (suggestions.data ?? []).filter((v) => v !== value)

  const valid =
    subject !== undefined &&
    op !== undefined &&
    (shape === 'none' || value !== '') &&
    (shape !== 'range' || value2 !== '')

  const reset = () => {
    setSelectedKey(undefined)
    setTarget(undefined)
    setOp(undefined)
    setValue('')
    setValue2('')
  }

  const startValue = (dataType: DataType | undefined) => {
    setValue('')
    setValue2('')
    const nextOp = offered(dataType)[0]
    setOp(nextOp)
    if (nextOp !== undefined && OP_VALUE[nextOp] === 'boolean') setValue('true')
  }

  const selectSubject = (key: string) => {
    setSelectedKey(key)
    setTarget(undefined)
    const p = subjects.properties.find((x) => x.key === key)
    if (p !== undefined) startValue(p.dataType)
    else {
      setOp(undefined)
      setValue('')
      setValue2('')
    }
  }

  const selectTarget = (next: RelationTarget) => {
    setTarget(next)
    if (next === 'exists' || next === 'missing') {
      setOp(next)
      setValue('')
      setValue2('')
      return
    }
    const owner = next.startsWith('.') ? relation?.otherType : relation?.relationType
    startValue(owner?.properties.find((p) => p.key === next.slice(1))?.dataType)
  }

  const selectOp = (next: FilterOpUi) => {
    setOp(next)
    if (OP_VALUE[next] === 'boolean' && value === '') setValue('true')
  }

  const apply = () => {
    if (!valid || subject === undefined || op === undefined) return
    onAdd({
      id: `f${filterSeq++}`,
      subject,
      op,
      value,
      ...(shape === 'range' ? { value2 } : {}),
    })
    setOpen(false)
    reset()
  }

  const relationOps = RELATION_OPS.filter((o) => !excludedOps.includes(o))

  return (
    <Popover
      open={open}
      onOpenChange={(next) => {
        setOpen(next)
        if (!next) reset()
      }}
    >
      <PopoverTrigger asChild>
        <Button variant="outline" size="sm" className="h-8 gap-1.5 text-[13px]">
          <ListFilter className="size-3.5" />
          Filter
        </Button>
      </PopoverTrigger>
      <PopoverContent align="start" className="w-80 p-3">
        <div className="space-y-2.5">
          <Select value={selectedKey ?? ''} onValueChange={selectSubject}>
            <SelectTrigger size="sm" className="w-full">
              <SelectValue placeholder="Property or relation…" />
            </SelectTrigger>
            <SelectContent>
              {subjects.properties.length > 0 && (
                <SelectGroup>
                  <SelectLabel>Properties</SelectLabel>
                  {subjects.properties.map((p) => (
                    <SelectItem key={p.key} value={p.key}>
                      <span className="flex items-center gap-2">
                        {p.displayName}
                        <span className="font-mono text-[11px] text-muted-foreground">
                          {p.dataType}
                        </span>
                      </span>
                    </SelectItem>
                  ))}
                </SelectGroup>
              )}
              {subjects.relations.length > 0 && (
                <SelectGroup>
                  <SelectLabel>Relations</SelectLabel>
                  {subjects.relations.map((r) => {
                    const key = subjectKey(relationSubject(r))
                    return (
                      <SelectItem key={key} value={key}>
                        <span className="flex items-center gap-2">
                          {r.relationType.displayName}
                          <span className="text-[11px] text-muted-foreground">
                            {r.direction === 'outgoing' ? '→' : '←'} {r.otherType.displayName}
                          </span>
                        </span>
                      </SelectItem>
                    )
                  })}
                </SelectGroup>
              )}
            </SelectContent>
          </Select>

          {relation !== undefined && (
            <Select value={target ?? ''} onValueChange={(v) => selectTarget(v as RelationTarget)}>
              <SelectTrigger size="sm" className="w-full">
                <SelectValue placeholder="Exists, or a property through it…" />
              </SelectTrigger>
              <SelectContent>
                {relationOps.length > 0 && (
                  <SelectGroup>
                    <SelectLabel>The relation</SelectLabel>
                    {relationOps.map((o) => (
                      <SelectItem key={o} value={o}>
                        {opLabel(relationSubject(relation), o)}
                      </SelectItem>
                    ))}
                  </SelectGroup>
                )}
                {relation.otherType.properties.length > 0 && (
                  <SelectGroup>
                    <SelectLabel>{relation.otherType.displayName} at the other end</SelectLabel>
                    {relation.otherType.properties.map((p) => (
                      <SelectItem key={p.key} value={`.${p.key}`}>
                        <span className="flex items-center gap-2">
                          {p.displayName}
                          <span className="font-mono text-[11px] text-muted-foreground">{p.dataType}</span>
                        </span>
                      </SelectItem>
                    ))}
                  </SelectGroup>
                )}
                {relation.relationType.properties.length > 0 && (
                  <SelectGroup>
                    <SelectLabel>On the relation itself</SelectLabel>
                    {relation.relationType.properties.map((p) => (
                      <SelectItem key={p.key} value={`@${p.key}`}>
                        <span className="flex items-center gap-2">
                          {p.displayName}
                          <span className="font-mono text-[11px] text-muted-foreground">{p.dataType}</span>
                        </span>
                      </SelectItem>
                    ))}
                  </SelectGroup>
                )}
              </SelectContent>
            </Select>
          )}

          {subject !== undefined && property !== undefined && (
            <Select value={op ?? ''} onValueChange={(v) => selectOp(v as FilterOpUi)}>
              <SelectTrigger size="sm" className="w-full">
                <SelectValue placeholder="Operator…" />
              </SelectTrigger>
              <SelectContent>
                {ops.map((o) => (
                  <SelectItem key={o} value={o}>
                    {opLabel(subject, o)}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
          )}

          {shape === 'boolean' && (
            <Select value={value} onValueChange={setValue}>
              <SelectTrigger size="sm" className="w-full">
                <SelectValue placeholder="Value…" />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value="true">true</SelectItem>
                <SelectItem value="false">false</SelectItem>
              </SelectContent>
            </Select>
          )}

          {property !== undefined && (shape === 'value' || shape === 'range') && (
            <div className="flex items-center gap-2">
              <Input
                type={inputTypeFor(property.dataType)}
                value={value}
                onChange={(e) => setValue(e.target.value)}
                onKeyDown={(e) => {
                  if (e.key === 'Enter') apply()
                }}
                placeholder={shape === 'range' ? 'From' : 'Value'}
                aria-label={shape === 'range' ? 'From' : 'Value'}
                className="h-8 text-[13px]"
                autoFocus
              />
              {shape === 'range' && (
                <Input
                  type={inputTypeFor(property.dataType)}
                  value={value2}
                  onChange={(e) => setValue2(e.target.value)}
                  onKeyDown={(e) => {
                    if (e.key === 'Enter') apply()
                  }}
                  placeholder="To"
                  aria-label="To"
                  className="h-8 text-[13px]"
                />
              )}
            </div>
          )}

          {suggesting && picks.length > 0 && (
            <div className="space-y-1">
              <p className="text-[11px] text-muted-foreground">
                Values on {subject?.kind === 'path' ? relation?.otherType.displayName : 'this type'}:
              </p>
              <div className="flex flex-wrap gap-1">
                {picks.map((v) => (
                  <button
                    key={v}
                    type="button"
                    onClick={() => setValue(v)}
                    className="max-w-full truncate rounded-md border bg-muted/40 px-1.5 py-0.5 text-[11.5px] hover:bg-muted"
                  >
                    {v}
                  </button>
                ))}
              </div>
            </div>
          )}

          {subject?.kind === 'path' && (
            <p className="text-[12px] text-muted-foreground">
              Keeps an entity when at least one of its {relation?.relationType.displayName} relations matches.
            </p>
          )}
          {op === 'ne' && (
            <p className="text-[12px] text-muted-foreground">
              Entities without a value are not included.
            </p>
          )}
          {replaces && (
            <p className="text-[12px] text-muted-foreground">
              Replaces the active filter on this {subject?.kind === 'property' ? 'property' : subject?.kind === 'path' ? 'path' : 'relation'}.
            </p>
          )}

          <div className="flex items-center justify-between pt-0.5">
            {subject !== undefined ? (
              <span className="min-w-0 truncate font-mono text-[11px] text-muted-foreground">
                {subjectKey(subject)}
              </span>
            ) : (
              <span />
            )}
            <Button size="sm" className="h-7 text-[13px]" disabled={!valid} onClick={apply}>
              Apply
            </Button>
          </div>
        </div>
      </PopoverContent>
    </Popover>
  )
}
