/**
 * Shared form components for the Studio (modeling) surface. Non-component
 * helpers (key validation, invalidation, errors) live in `./lib`.
 */

import { useRef, useState } from 'react'
import { Input } from '@/components/ui/input'
import { Label } from '@/components/ui/label'
import { Textarea } from '@/components/ui/textarea'
import { cn } from '@/lib/utils'
import { isValidKey } from './lib'

interface KeyFieldProps {
  id: string
  value: string
  onChange: (value: string) => void
  /** Edit mode — the key is immutable, render it disabled. */
  disabled?: boolean
  error?: string
  autoFocus?: boolean
}

/**
 * Key input with live pattern validation and the "immutable" note. Keys are
 * snake_case (`^[a-z][a-z0-9_]*$`) and permanent once created.
 */
export function KeyField({ id, value, onChange, disabled, error, autoFocus }: KeyFieldProps) {
  const invalid = !disabled && value !== '' && !isValidKey(value)
  return (
    <div className="grid gap-1.5">
      <Label htmlFor={id}>Key</Label>
      <Input
        id={id}
        value={value}
        onChange={(e) => onChange(e.target.value)}
        disabled={disabled}
        autoFocus={autoFocus}
        spellCheck={false}
        autoComplete="off"
        placeholder="my_key"
        className={cn('font-mono', (invalid || error !== undefined) && 'border-destructive')}
        aria-invalid={invalid || error !== undefined}
      />
      {invalid && (
        <p className="text-xs text-destructive">
          Lowercase letters, digits and underscores only; must start with a letter.
        </p>
      )}
      {!invalid && error !== undefined && <p className="text-xs text-destructive">{error}</p>}
      <p className="text-xs text-muted-foreground">
        {disabled ? 'The key is immutable.' : 'Permanent — the key cannot be changed later.'}
      </p>
    </div>
  )
}

interface InlineTextProps {
  value: string
  /** Called with the trimmed new value (only when it changed). */
  onSave: (value: string) => void
  placeholder?: string
  multiline?: boolean
  className?: string
  inputClassName?: string
  'aria-label'?: string
}

/**
 * Click-to-edit text. Enter (or blur) saves, Escape cancels; multiline uses a
 * textarea where Enter inserts a newline and blur/Cmd+Enter saves.
 */
export function InlineText({
  value,
  onSave,
  placeholder,
  multiline = false,
  className,
  inputClassName,
  'aria-label': ariaLabel,
}: InlineTextProps) {
  const [editing, setEditing] = useState(false)
  const [draft, setDraft] = useState('')
  const cancelled = useRef(false)

  const commit = () => {
    setEditing(false)
    if (cancelled.current) {
      cancelled.current = false
      return
    }
    const next = draft.trim()
    if (next !== value.trim()) onSave(next)
  }

  if (editing) {
    const common = {
      value: draft,
      autoFocus: true,
      'aria-label': ariaLabel,
      onChange: (e: React.ChangeEvent<HTMLInputElement | HTMLTextAreaElement>) =>
        setDraft(e.target.value),
      onBlur: commit,
      onKeyDown: (e: React.KeyboardEvent) => {
        if (e.key === 'Escape') {
          cancelled.current = true
          ;(e.target as HTMLElement).blur()
        } else if (e.key === 'Enter' && (!multiline || e.metaKey || e.ctrlKey)) {
          e.preventDefault()
          ;(e.target as HTMLElement).blur()
        }
      },
    }
    return multiline ? (
      <Textarea {...common} rows={2} className={cn('text-[13px]', inputClassName)} />
    ) : (
      <Input {...common} className={inputClassName} />
    )
  }

  const empty = value.trim() === ''
  return (
    <button
      type="button"
      aria-label={ariaLabel}
      onClick={() => {
        setDraft(value)
        setEditing(true)
      }}
      className={cn(
        'cursor-text rounded-sm text-left transition-colors hover:bg-muted/60',
        'focus-visible:outline-2 focus-visible:outline-ring/60',
        empty && 'italic text-muted-foreground/70',
        className,
      )}
      title="Click to edit"
    >
      {empty ? (placeholder ?? 'Click to edit') : value}
    </button>
  )
}
