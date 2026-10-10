import type { DataType } from '@/api/types'
import { Input } from '@/components/ui/input'
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@/components/ui/select'

interface TypedValueInputProps {
  id?: string
  dataType: DataType
  /** Raw string state — coerce with `coerceTypedValue` (see `./lib`) on submit. */
  value: string
  onChange: (raw: string) => void
  placeholder?: string
  /** Allow clearing a boolean back to "not set". */
  allowEmptyBoolean?: boolean
  /** Label of the boolean's empty choice. */
  emptyLabel?: string
  /** Inline editing: called with the raw value on blur, Enter and a select change. */
  onCommit?: (raw: string) => void
}

/** Input matched to a property dataType (number, boolean select, date, …). */
export function TypedValueInput({
  id,
  dataType,
  value,
  onChange,
  placeholder,
  allowEmptyBoolean = true,
  emptyLabel = 'Not set',
  onCommit,
}: TypedValueInputProps) {
  if (dataType === 'boolean') {
    const NONE = '__none__'
    return (
      <Select
        value={value === '' ? (allowEmptyBoolean ? NONE : '') : value}
        onValueChange={(v) => {
          const raw = v === NONE ? '' : v
          onChange(raw)
          onCommit?.(raw)
        }}
      >
        <SelectTrigger id={id} className="w-full">
          <SelectValue placeholder="Select…" />
        </SelectTrigger>
        <SelectContent>
          {allowEmptyBoolean && <SelectItem value={NONE}>{emptyLabel}</SelectItem>}
          <SelectItem value="true">true</SelectItem>
          <SelectItem value="false">false</SelectItem>
        </SelectContent>
      </Select>
    )
  }
  const type =
    dataType === 'integer' || dataType === 'float'
      ? 'number'
      : dataType === 'date'
        ? 'date'
        : dataType === 'datetime'
          ? 'datetime-local'
          : 'text'
  return (
    <Input
      id={id}
      type={type}
      step={dataType === 'float' ? 'any' : undefined}
      value={value}
      placeholder={placeholder}
      onChange={(e) => onChange(e.target.value)}
      onBlur={onCommit === undefined ? undefined : () => onCommit(value)}
      onKeyDown={
        onCommit === undefined
          ? undefined
          : (e) => {
              if (e.key === 'Enter') {
                e.preventDefault()
                e.currentTarget.blur()
              }
            }
      }
    />
  )
}
