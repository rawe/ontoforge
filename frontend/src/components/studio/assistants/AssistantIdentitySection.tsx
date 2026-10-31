import { useState, type ReactNode } from 'react'
import type { AssistantKind } from '@/api/types'
import { adapters } from '@/assistants'
import { Input } from '@/components/ui/input'
import { Label } from '@/components/ui/label'
import { Textarea } from '@/components/ui/textarea'
import { deriveKey } from '../lib'
import { KeyField } from '../shared'
import { assistantKeyError } from './assistantModel'

/**
 * The Name, Key and Description card of an editor. A new assistant's key
 * follows the name until edited and is refused when taken in the lens or too
 * long (`assistantKeyError`); a saved one's key is fixed. With `followName`
 * false the owner makes the key follow the name instead, in `onName`.
 */
export function AssistantIdentitySection({
  kind, isNew, name, assistantKey, description, existingKeys, disabled, namePlaceholder, nameError, descriptionError, descriptionHint,
  followName = true, nameMark, descriptionMark, onName, onKey, onDescription,
}: {
  kind: AssistantKind
  isNew: boolean
  name: string
  assistantKey: string
  description: string
  /** The keys the lens has already, for a new assistant's key check. */
  existingKeys: readonly string[]
  disabled: boolean
  namePlaceholder?: string
  nameError?: string
  descriptionError?: string
  /** The muted sentence under the description, when it has no error. */
  descriptionHint: string
  /** Whether the section makes a new assistant's key follow the name until edited; false when the owner does. */
  followName?: boolean
  /** Beside the Name and Description labels: the AI mark. */
  nameMark?: ReactNode
  descriptionMark?: ReactNode
  onName: (name: string) => void
  onKey: (key: string) => void
  onDescription: (description: string) => void
}) {
  const [keyTouched, setKeyTouched] = useState(false)
  const one = adapters[kind].nouns.one
  const id = one.toLowerCase()
  return (
    <section className="grid gap-3 rounded-xl border bg-card p-4">
      <div className="grid gap-1.5">
        <div className="flex items-center gap-2"><Label htmlFor={`${id}-name`}>Name</Label>{nameMark}</div>
        <Input
          id={`${id}-name`}
          value={name}
          disabled={disabled}
          autoFocus={isNew}
          placeholder={namePlaceholder}
          onChange={(e) => {
            onName(e.target.value)
            if (followName && isNew && !keyTouched) onKey(deriveKey(e.target.value))
          }}
        />
        {nameError !== undefined && <p className="text-xs text-destructive">{nameError}</p>}
      </div>
      <KeyField
        id={`${id}-key`}
        lensResource
        value={assistantKey}
        disabled={!isNew || disabled}
        error={isNew ? assistantKeyError(assistantKey, existingKeys, one) : undefined}
        onChange={(value) => { setKeyTouched(true); onKey(value) }}
      />
      <div className="grid gap-1.5">
        <div className="flex items-center gap-2"><Label htmlFor={`${id}-description`}>Description</Label>{descriptionMark}</div>
        <Textarea id={`${id}-description`} rows={2} value={description} disabled={disabled} onChange={(e) => onDescription(e.target.value)} />
        {descriptionError !== undefined
          ? <p className="text-xs text-destructive">{descriptionError}</p>
          : <p className="text-xs text-muted-foreground">{descriptionHint}</p>}
      </div>
    </section>
  )
}
