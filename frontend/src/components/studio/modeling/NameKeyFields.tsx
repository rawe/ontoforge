/**
 * Display name input with a compact key line below it. The key follows the
 * name (`deriveKey`) until the user edits it, and is marked permanent: keys
 * never change after creation. State helpers live in `schemaKeys.ts`.
 */

import { Input } from '@/components/ui/input'
import { cn } from '@/lib/utils'
import { keyProblem, withName, type NameKey } from './schemaKeys'

interface NameKeyFieldsProps {
  value: NameKey
  onChange: (value: NameKey) => void
  placeholder: string
  /** Prefix of the two inputs' ids. */
  idPrefix: string
  autoFocus?: boolean
  /** Server field errors, shown under their field. */
  errors?: { displayName?: string; key?: string }
}

export function NameKeyFields({
  value,
  onChange,
  placeholder,
  idPrefix,
  autoFocus,
  errors = {},
}: NameKeyFieldsProps) {
  const problem = value.key === '' ? null : keyProblem(value.key)
  const keyInvalid = problem !== null || errors.key !== undefined
  return (
    <div className="grid gap-1">
      <Input
        id={`${idPrefix}-name`}
        aria-label="Display name"
        value={value.name}
        autoFocus={autoFocus}
        placeholder={placeholder}
        onChange={(e) => onChange(withName(value, e.target.value))}
        className="h-8"
        aria-invalid={errors.displayName !== undefined}
      />
      {errors.displayName !== undefined && (
        <p className="text-xs text-destructive">{errors.displayName}</p>
      )}
      <label className="flex items-center gap-1.5 text-[11px] text-muted-foreground">
        <span className="shrink-0">key</span>
        <input
          id={`${idPrefix}-key`}
          aria-label="Key"
          value={value.key}
          spellCheck={false}
          autoComplete="off"
          placeholder="auto_from_name"
          onChange={(e) => onChange({ ...value, key: e.target.value, keyTouched: true })}
          className={cn(
            'min-w-0 flex-1 rounded border border-transparent bg-transparent px-1 py-0.5 font-mono text-[11px] text-foreground/80 outline-none',
            'hover:border-input focus:border-ring',
            keyInvalid && 'border-destructive text-destructive',
          )}
          aria-invalid={keyInvalid}
        />
        <span
          className="shrink-0 text-[10px] text-muted-foreground/70"
          title="The key cannot be changed later"
        >
          permanent
        </span>
      </label>
      {problem !== null && <p className="text-[11px] text-destructive">{problem}</p>}
      {problem === null && errors.key !== undefined && (
        <p className="text-[11px] text-destructive">{errors.key}</p>
      )}
    </div>
  )
}
