import type { KeyboardEventHandler } from 'react'
import type { SchemaProperty } from '@/api/types'
import { Input } from '@/components/ui/input'
import { Label } from '@/components/ui/label'
import { Switch } from '@/components/ui/switch'
import { Textarea } from '@/components/ui/textarea'
import { isLongText } from '@/components/schema/propertyDraft'
import { cn } from '@/lib/utils'

interface PropertyInputProps {
  property: SchemaProperty
  draft: string
  onDraftChange: (draft: string) => void
  id?: string
  autoFocus?: boolean
  invalid?: boolean
  disabled?: boolean
  onKeyDown?: KeyboardEventHandler<HTMLElement>
  className?: string
}

/**
 * Bare input for one schema property, switched by dataType. Works on the
 * string-draft model from `propertyDraft.ts` (booleans draft "true"/"false").
 */
export function PropertyInput({
  property,
  draft,
  onDraftChange,
  id,
  autoFocus,
  invalid,
  disabled,
  onKeyDown,
  className,
}: PropertyInputProps) {
  const common = {
    id,
    autoFocus,
    disabled,
    onKeyDown,
    'aria-invalid': invalid === true || undefined,
  }

  switch (property.dataType) {
    case 'boolean':
      return (
        <div
          className={cn('flex h-8 items-center gap-2', className)}
          onKeyDown={onKeyDown}
        >
          <Switch
            id={id}
            autoFocus={autoFocus}
            disabled={disabled}
            checked={draft === 'true'}
            onCheckedChange={(checked) => onDraftChange(checked ? 'true' : 'false')}
          />
          <span className="font-mono text-xs text-muted-foreground">
            {draft === 'true' ? 'true' : 'false'}
          </span>
        </div>
      )
    case 'integer':
      return (
        <Input
          {...common}
          type="number"
          step={1}
          inputMode="numeric"
          value={draft}
          onChange={(e) => onDraftChange(e.target.value)}
          className={cn('h-8 font-mono text-[13px]', className)}
        />
      )
    case 'float':
      return (
        <Input
          {...common}
          type="number"
          step="any"
          inputMode="decimal"
          value={draft}
          onChange={(e) => onDraftChange(e.target.value)}
          className={cn('h-8 font-mono text-[13px]', className)}
        />
      )
    case 'date':
      return (
        <Input
          {...common}
          type="date"
          value={draft}
          onChange={(e) => onDraftChange(e.target.value)}
          className={cn('h-8 font-mono text-[13px]', className)}
        />
      )
    case 'datetime':
      return (
        <Input
          {...common}
          type="datetime-local"
          value={draft}
          onChange={(e) => onDraftChange(e.target.value)}
          className={cn('h-8 font-mono text-[13px]', className)}
        />
      )
    default:
      return isLongText(property) ? (
        <Textarea
          {...common}
          rows={3}
          value={draft}
          onChange={(e) => onDraftChange(e.target.value)}
          className={cn('text-[13px]', className)}
        />
      ) : (
        <Input
          {...common}
          type="text"
          value={draft}
          onChange={(e) => onDraftChange(e.target.value)}
          className={cn('h-8 text-[13px]', className)}
        />
      )
  }
}

interface PropertyFieldProps {
  property: SchemaProperty
  draft: string
  onDraftChange: (draft: string) => void
  error?: string
  autoFocus?: boolean
  disabled?: boolean
  /** Prefix for the input id (multiple forms may render the same property). */
  idPrefix?: string
}

/**
 * Labeled form field for one schema property: display name, required marker,
 * dataType hint, dataType-appropriate input and an inline error slot.
 */
export function PropertyField({
  property,
  draft,
  onDraftChange,
  error,
  autoFocus,
  disabled,
  idPrefix = 'prop',
}: PropertyFieldProps) {
  const id = `${idPrefix}-${property.key}`
  return (
    <div className="space-y-1.5">
      <div className="flex items-baseline gap-1">
        <Label htmlFor={id} className="text-[13px]">
          {property.displayName}
          {property.required && (
            <span aria-hidden className="text-destructive">
              *
            </span>
          )}
        </Label>
        <span className="ml-auto font-mono text-[10px] text-muted-foreground">
          {property.dataType}
        </span>
      </div>
      <PropertyInput
        property={property}
        draft={draft}
        onDraftChange={onDraftChange}
        id={id}
        autoFocus={autoFocus}
        disabled={disabled}
        invalid={error !== undefined}
      />
      {error !== undefined && <p className="text-xs text-destructive">{error}</p>}
    </div>
  )
}
