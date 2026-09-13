import { ListFilter } from 'lucide-react'
import { useState } from 'react'
import type { DataType } from '@/api/types'
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

/**
 * "Filter" toolbar button + popover: pick a subject — a property, or a
 * relation type in one direction — an operator it offers, and value(s);
 * applying calls `onAdd` with a FilterCondition. A subject holds one
 * condition, so the popover says when applying replaces an active one.
 */
export function FilterPopover({
  subjects,
  active,
  onAdd,
}: {
  subjects: FilterSubjects
  active: readonly FilterCondition[]
  onAdd: (condition: FilterCondition) => void
}) {
  const [open, setOpen] = useState(false)
  const [selectedKey, setSelectedKey] = useState<string>()
  const [op, setOp] = useState<FilterOpUi>()
  const [value, setValue] = useState('')
  const [value2, setValue2] = useState('')

  const property = subjects.properties.find((p) => p.key === selectedKey)
  const relation = subjects.relations.find(
    (r) => subjectKey(relationSubject(r)) === selectedKey,
  )
  const subject: FilterSubject | undefined =
    property !== undefined
      ? { kind: 'property', propertyKey: property.key }
      : relation !== undefined
        ? relationSubject(relation)
        : undefined
  const ops: readonly FilterOpUi[] =
    property !== undefined ? opsForDataType(property.dataType) : relation !== undefined ? RELATION_OPS : []
  const shape = op !== undefined ? OP_VALUE[op] : undefined
  const replaces = active.some((f) => subjectKey(f.subject) === selectedKey)

  const valid =
    subject !== undefined &&
    op !== undefined &&
    (shape === 'none' || value !== '') &&
    (shape !== 'range' || value2 !== '')

  const reset = () => {
    setSelectedKey(undefined)
    setOp(undefined)
    setValue('')
    setValue2('')
  }

  const selectSubject = (key: string) => {
    setSelectedKey(key)
    setValue('')
    setValue2('')
    const p = subjects.properties.find((x) => x.key === key)
    const nextOp = p !== undefined ? opsForDataType(p.dataType)[0] : RELATION_OPS[0]
    setOp(nextOp)
    if (nextOp !== undefined && OP_VALUE[nextOp] === 'boolean') setValue('true')
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

          {subject !== undefined && (
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
                  className="h-8 text-[13px]"
                />
              )}
            </div>
          )}

          {op === 'ne' && (
            <p className="text-[12px] text-muted-foreground">
              Entities without a value are not included.
            </p>
          )}
          {replaces && (
            <p className="text-[12px] text-muted-foreground">
              Replaces the active filter on this {property !== undefined ? 'property' : 'relation'}.
            </p>
          )}

          <div className="flex items-center justify-between pt-0.5">
            {subject !== undefined ? (
              <span className="font-mono text-[11px] text-muted-foreground">
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
