/**
 * Pure helpers of the Studio's assistant management (agents, retrievers,
 * navigators): URL values, the default's sentence, the editor status, the
 * key check and error lines. No React, no I/O — unit-tested with `node --test`.
 */

import type { AssistantKind } from '@/api/types'
import { ApiError } from '../../../api/http.ts'

/** The URL value of a draft — outside the key pattern, so no saved key collides; it exists only in the client until its first save. */
export const ASSISTANT_NEW = '_new'

/** The key of the built-in default every lens has for every kind. */
export const ASSISTANT_DEFAULT = '_default'

// The most characters a new assistant's key may have.
const ASSISTANT_KEY_MAX = 64

/** Per kind: the one sentence that says what its built-in default is. */
export const ASSISTANT_DEFAULT_TEXT: Record<AssistantKind, string> = {
  agents: 'Every lens has it: no system prompt of its own and every tool. It cannot be edited — create an agent to give it a prompt or fewer tools.',
  retrievers: 'Every lens has it, derived from the lens\'s managed search indices. It cannot be edited — create a retriever to choose indices, filters and answer fields.',
  navigators: 'Every lens has it, derived from the lens: it may follow every relation type and start from every entity type the lens shows. It is not stored and cannot be edited; create a navigator to narrow it down.',
}

/** Where an editor stands; `builtIn` is the default's read-only page. */
export type AssistantStatus = 'new' | 'dirty' | 'invalid' | 'saved' | 'builtIn'

/** The status of an editor: new before the first save, then unsaved changes, then invalid in the lens, else saved. */
export function assistantStatus({ isNew, dirty, invalid }: { isNew: boolean; dirty: boolean; invalid: boolean }): AssistantStatus {
  return isNew ? 'new' : dirty ? 'dirty' : invalid ? 'invalid' : 'saved'
}

/** Each status's text in the editor's title row and its tone. */
export const ASSISTANT_STATUS_TEXT: Record<AssistantStatus, { text: string; className: string }> = {
  new: { text: 'Not saved yet', className: 'text-(--tc-amber)' },
  dirty: { text: 'Unsaved changes', className: 'text-(--tc-amber)' },
  invalid: { text: 'Invalid in this lens', className: 'text-destructive' },
  saved: { text: 'Saved', className: 'text-muted-foreground' },
  builtIn: { text: 'Built in', className: 'text-muted-foreground' },
}

/** Why a new assistant's key is refused beyond its pattern — taken in the lens or too long; undefined when free. */
export function assistantKeyError(key: string, existingKeys: readonly string[], one: string): string | undefined {
  if (existingKeys.includes(key)) return `${/^[aeiou]/i.test(one) ? 'An' : 'A'} ${one.toLowerCase()} with this key exists already.`
  if (key.length > ASSISTANT_KEY_MAX) return `At most ${ASSISTANT_KEY_MAX} characters.`
  return undefined
}

/**
 * A failed request as lines: the server's reasons (`details.errors`, plain or
 * `{path, message}`), else its field errors (`details.fields`), else its message.
 */
export function assistantErrorLines(error: unknown): string[] {
  if (error instanceof ApiError) {
    const errors = error.details?.errors
    if (Array.isArray(errors) && errors.length > 0) return errors.map(errorLine)
    const fields = error.fieldErrors
    if (fields !== undefined && Object.keys(fields).length > 0) return Object.entries(fields).map(([field, message]) => `${field}: ${message}`)
  }
  return [error instanceof Error ? error.message : 'The request failed.']
}

function errorLine(entry: unknown): string {
  if (typeof entry === 'string') return entry
  if (entry !== null && typeof entry === 'object' && 'message' in entry && typeof entry.message === 'string') {
    const path = 'path' in entry && typeof entry.path === 'string' && entry.path !== '' ? `${entry.path}: ` : ''
    return path + entry.message
  }
  return JSON.stringify(entry)
}
