import { ListFilter } from 'lucide-react'
import { useState } from 'react'
import type { DataType, SchemaProperty } from '@/api/types'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { Popover, PopoverContent, PopoverTrigger } from '@/components/ui/popover'
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@/components/ui/select'
import {
  OP_LABELS,
  opsForDataType,
  type FilterCondition,
  type FilterOpUi,
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
 * "Filter" toolbar button + popover: pick a property, an op appropriate to
 * its dataType, and value(s); applying calls `onAdd` with a FilterCondition.
 */
export function FilterPopover({
  properties,
  onAdd,
}: {
  properties: readonly SchemaProperty[]
  onAdd: (condition: FilterCondition) => void
}) {
  const [open, setOpen] = useState(false)
  const [propertyKey, setPropertyKey] = useState<string>()
  const [op, setOp] = useState<FilterOpUi>()
  const [value, setValue] = useState('')
  const [value2, setValue2] = useState('')

  // Only properties with at least one operator (documents have none).
  const filterable = properties.filter((p) => opsForDataType(p.dataType).length > 0)
  const property = filterable.find((p) => p.key === propertyKey)
  const ops = property !== undefined ? opsForDataType(property.dataType) : []

  const valid =
    property !== undefined &&
    op !== undefined &&
    (op === 'is' || value !== '') &&
    (op !== 'between' || value2 !== '')

  const reset = () => {
    setPropertyKey(undefined)
    setOp(undefined)
    setValue('')
    setValue2('')
  }

  const apply = () => {
    if (!valid || property === undefined || op === undefined) return
    onAdd({
      id: `f${filterSeq++}`,
      propertyKey: property.key,
      op,
      value: op === 'is' && value === '' ? 'true' : value,
      ...(op === 'between' ? { value2 } : {}),
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
      <PopoverContent align="start" className="w-72 p-3">
        <div className="space-y-2.5">
          <Select
            value={propertyKey ?? ''}
            onValueChange={(key) => {
              setPropertyKey(key)
              setValue('')
              setValue2('')
              const p = filterable.find((x) => x.key === key)
              const nextOps = p !== undefined ? opsForDataType(p.dataType) : []
              setOp(nextOps[0])
              if (p?.dataType === 'boolean') setValue('true')
            }}
          >
            <SelectTrigger size="sm" className="w-full">
              <SelectValue placeholder="Property…" />
            </SelectTrigger>
            <SelectContent>
              {filterable.map((p) => (
                <SelectItem key={p.key} value={p.key}>
                  <span className="flex items-center gap-2">
                    {p.displayName}
                    <span className="font-mono text-[11px] text-muted-foreground">
                      {p.dataType}
                    </span>
                  </span>
                </SelectItem>
              ))}
            </SelectContent>
          </Select>

          {property !== undefined && (
            <Select value={op ?? ''} onValueChange={(v) => setOp(v as FilterOpUi)}>
              <SelectTrigger size="sm" className="w-full">
                <SelectValue placeholder="Operator…" />
              </SelectTrigger>
              <SelectContent>
                {ops.map((o) => (
                  <SelectItem key={o} value={o}>
                    {OP_LABELS[o]}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
          )}

          {property !== undefined &&
            op !== undefined &&
            (property.dataType === 'boolean' ? (
              <Select value={value} onValueChange={setValue}>
                <SelectTrigger size="sm" className="w-full">
                  <SelectValue placeholder="Value…" />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value="true">true</SelectItem>
                  <SelectItem value="false">false</SelectItem>
                </SelectContent>
              </Select>
            ) : (
              <div className="flex items-center gap-2">
                <Input
                  type={inputTypeFor(property.dataType)}
                  value={value}
                  onChange={(e) => setValue(e.target.value)}
                  onKeyDown={(e) => {
                    if (e.key === 'Enter') apply()
                  }}
                  placeholder={op === 'between' ? 'From' : 'Value'}
                  className="h-8 text-[13px]"
                  autoFocus
                />
                {op === 'between' && (
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
            ))}

          <div className="flex items-center justify-between pt-0.5">
            {property !== undefined ? (
              <span className="font-mono text-[11px] text-muted-foreground">
                {property.key}
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
