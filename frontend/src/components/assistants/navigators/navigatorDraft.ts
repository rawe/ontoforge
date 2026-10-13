/**
 * The Studio editor's draft of one navigator: seeded from the saved one
 * (or the defaults), checked field by field, and turned into the write
 * body. No React, no I/O.
 */
import { NAVIGATOR_LIMITS, type Navigator, type NavigatorWrite } from '@/api/navigators'

export interface NavigatorDraft {
  name: string
  description: string
  hops: number
  /** null = every one the lens shows. */
  relationTypes: string[] | null
  anchorTypes: string[] | null
  /** As typed; checked by `draftProblems`. */
  maxEntities: string
  instructions: string
}

export function draftOf(navigator: Navigator | null, name = ''): NavigatorDraft {
  const config = navigator?.config
  return {
    name: navigator?.name ?? name,
    description: navigator?.description ?? '',
    hops: config?.hops ?? NAVIGATOR_LIMITS.hops.default,
    relationTypes: config?.relationTypes ?? null,
    anchorTypes: config?.anchorTypes ?? null,
    maxEntities: String(config?.maxEntities ?? NAVIGATOR_LIMITS.maxEntities.default),
    instructions: config?.instructions ?? '',
  }
}

const sameList = (a: readonly string[] | null, b: readonly string[] | null) =>
  a === null || b === null ? a === b : a.length === b.length && a.every((key) => b.includes(key))

export const sameDraft = (a: NavigatorDraft, b: NavigatorDraft) =>
  a.name === b.name && a.description === b.description && a.hops === b.hops && a.maxEntities === b.maxEntities &&
  a.instructions === b.instructions && sameList(a.relationTypes, b.relationTypes) && sameList(a.anchorTypes, b.anchorTypes)

export type DraftField = 'name' | 'description' | 'relationTypes' | 'anchorTypes' | 'maxEntities' | 'instructions'

/** What keeps the draft from being saved, per field; empty = it can be saved. */
export function draftProblems(draft: NavigatorDraft): Partial<Record<DraftField, string>> {
  const problems: Partial<Record<DraftField, string>> = {}
  const { maxEntities: max } = NAVIGATOR_LIMITS
  if (draft.name.trim() === '') problems.name = 'A name is required.'
  else if (draft.name.trim().length > NAVIGATOR_LIMITS.name) problems.name = `At most ${NAVIGATOR_LIMITS.name} characters.`
  if (draft.description.trim().length > NAVIGATOR_LIMITS.description) problems.description = `At most ${NAVIGATOR_LIMITS.description} characters.`
  if (draft.relationTypes?.length === 0) problems.relationTypes = 'Choose at least one relation type, or allow all.'
  if (draft.anchorTypes?.length === 0) problems.anchorTypes = 'Choose at least one entity type, or allow all.'
  const entities = Number(draft.maxEntities.trim())
  if (draft.maxEntities.trim() === '' || !Number.isInteger(entities) || entities < max.min || entities > max.max) {
    problems.maxEntities = `A whole number from ${max.min} to ${max.max}.`
  }
  if (draft.instructions.trim().length > NAVIGATOR_LIMITS.instructions) problems.instructions = `At most ${NAVIGATOR_LIMITS.instructions} characters.`
  return problems
}

const orNull = (text: string) => (text.trim() === '' ? null : text.trim())

export const toWrite = (draft: NavigatorDraft): NavigatorWrite => ({
  name: draft.name.trim(),
  description: orNull(draft.description),
  configVersion: 1,
  config: {
    hops: draft.hops,
    relationTypes: draft.relationTypes,
    anchorTypes: draft.anchorTypes,
    maxEntities: Number(draft.maxEntities.trim()),
    instructions: orNull(draft.instructions),
  },
})

/** One line about a saved navigator's configuration, for its card. */
export function configLine(navigator: Pick<Navigator, 'config'>): string {
  const { hops, relationTypes, anchorTypes, maxEntities } = navigator.config
  const count = (list: readonly string[] | null, noun: string) =>
    list === null ? `all ${noun}s` : `${list.length} ${noun}${list.length === 1 ? '' : 's'}`
  return `${hops} ${hops === 1 ? 'hop' : 'hops'} · ${count(relationTypes, 'relation type')} · anchors: ${count(anchorTypes, 'entity type')} · up to ${maxEntities} cards`
}
