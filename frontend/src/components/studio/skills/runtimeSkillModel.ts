/**
 * Pure helpers of the Studio's runtime skill editor: the URL value of a draft
 * and the save rules — key, description, content — as the server checks them
 * (`docs/capabilities/runtime-skills.md`). No React, no I/O — unit-tested
 * with `node --test`.
 */

import { MAX_KEY_LENGTH, RUNTIME_SKILL_KEY_PATTERN } from '../modeling/schemaKeys.ts'

/** The URL value of a draft — outside the key pattern (no underscore), so no saved key collides. */
export const SKILL_NEW = '_new'

/** Mirrors the server's `MAX_RUNTIME_SKILL_DESCRIPTION_LENGTH`. */
export const MAX_SKILL_DESCRIPTION_LENGTH = 1024

/** Characters as the server counts a description: code points. */
export const characters = (text: string) => [...text].length

/** What is wrong with a new skill's key, or undefined when it can be saved. Empty is "required", not an error to show. */
export function skillKeyProblem(key: string, existingKeys: readonly string[]): string | undefined {
  if (key === '') return undefined
  if (key.length > MAX_KEY_LENGTH) return `At most ${MAX_KEY_LENGTH} characters.`
  if (!RUNTIME_SKILL_KEY_PATTERN.test(key)) {
    return 'Lowercase letters, digits and single hyphens only; no underscore, no hyphen at the start or end.'
  }
  if (existingKeys.includes(key)) return 'This lens has a runtime skill with this key already.'
  return undefined
}

/** What is wrong with a description, or undefined when it can be saved. */
export function skillDescriptionProblem(description: string): string | undefined {
  if (description === '') return 'A description is required.'
  const length = characters(description)
  if (length > MAX_SKILL_DESCRIPTION_LENGTH) {
    return `At most ${MAX_SKILL_DESCRIPTION_LENGTH} characters; this one has ${length}.`
  }
  return undefined
}

/** What is wrong with the content, or undefined when it can be saved. */
export function skillContentProblem(content: string): string | undefined {
  return content === '' ? 'The content must not be empty.' : undefined
}
