/**
 * Pure helpers for the Advanced search page: the body the form sends to
 * `POST /search/entities` or `/search/passages`, the field errors a control
 * shows, `ran` and the limitations as readable sentences, and how a found
 * entity links and reads.
 *
 * No React, no I/O — unit-tested with `node --test`. The server stays
 * authoritative: a value the form cannot judge is sent and its error shown.
 */

import type {
  EntityReference,
  EntitySearchResponse,
  PassageSearchBody,
  QueryResult,
  MethodScores,
  Representation,
  SearchLimitation,
} from '@/api/types'

export type SearchMode = 'entities' | 'passages'

/** The request's scope fields; `documents` is the passage search's only. */
export type ScopeField = 'types' | 'indices' | 'documents'

/** What ranks: the method blocks the form sends. */
export type MethodChoice = 'keyword' | 'semantic' | 'both'

export interface SearchForm {
  mode: SearchMode
  query: string
  /** No keys: the field is left out, so the whole lens is searched. */
  scope: { field: ScopeField; keys: readonly string[] }
  keyword: { on: boolean; match: 'any' | 'all' }
  /** `minSimilarity` as typed; empty sends none, so there is no floor. */
  semantic: { on: boolean; minSimilarity: string }
  /** The applied filter conditions, as the entity list's filter keys. */
  filter: Record<string, string | number | boolean> | undefined
  limit: string
  /** Passages only; empty means no cap per entity. */
  perEntity: string
}

const numberOf = (text: string): number | undefined =>
  text.trim() === '' ? undefined : Number(text)

/**
 * The request body: one scope field when it names keys, a block per chosen
 * method (none: the server runs what can run), the filter values as strings.
 * The passage text is always wanted, which is the server's default.
 */
export function searchBody(form: SearchForm): PassageSearchBody {
  const body: PassageSearchBody = { query: form.query.trim() }
  const { field, keys } = form.scope
  if (keys.length > 0 && (field !== 'documents' || form.mode === 'passages')) {
    body[field] = [...keys]
  }
  if (form.keyword.on) body.keyword = { match: form.keyword.match }
  if (form.semantic.on) {
    const minSimilarity = numberOf(form.semantic.minSimilarity)
    body.semantic = minSimilarity === undefined ? {} : { minSimilarity }
  }
  if (form.filter !== undefined) {
    body.filter = Object.fromEntries(
      Object.entries(form.filter).map(([key, value]) => [key, String(value)]),
    )
  }
  const limit = numberOf(form.limit)
  if (limit !== undefined) body.limit = limit
  if (form.mode === 'passages') {
    const perEntity = numberOf(form.perEntity)
    if (perEntity !== undefined) body.perEntity = perEntity
  }
  return body
}

/** The one entity type every chosen scope item belongs to, if they share one:
 * the filter editor works on one type's properties. */
export function sharedType(
  keys: readonly string[],
  typeOf: (key: string) => string | undefined,
): string | undefined {
  const types = new Set(keys.map(typeOf))
  return keys.length > 0 && types.size === 1 ? [...types][0] : undefined
}

const SCOPE_NOUNS: Record<ScopeField, [string, string]> = {
  types: ['type', 'types'],
  indices: ['index', 'indices'],
  documents: ['document', 'documents'],
}

/** What the scope searches, in a few words: `All 5 types`, `2 of 62 indices`. */
export function scopeSummary(field: ScopeField, chosen: number, total: number): string {
  const [one, many] = SCOPE_NOUNS[field]
  if (chosen > 0) return `${chosen} of ${total} ${total === 1 ? one : many}`
  if (field === 'indices') return 'Every type’s managed indices'
  return total === 1 ? `The one ${one}` : `All ${total} ${many}`
}

/** What an empty scope field searches, as the line under its list. */
export function emptyScopeText(field: ScopeField, mode: SearchMode): string {
  switch (field) {
    case 'types':
      return mode === 'entities'
        ? 'Nothing chosen: every type is searched, by its own fields and its documents.'
        : 'Nothing chosen: the documents of every type are searched.'
    case 'indices':
      return mode === 'entities'
        ? 'Nothing chosen: every type’s own fields and documents are searched. A custom index is searched only when chosen.'
        : 'Nothing chosen: every type’s documents are searched. A custom index is searched only when chosen.'
    case 'documents':
      return 'Nothing chosen: every document is searched.'
  }
}

/**
 * A request as a comparable text: the same search reads the same whatever
 * order its scope keys and filter keys were chosen in.
 */
export function requestKey(mode: SearchMode, body: PassageSearchBody): string {
  const sorted = (keys: readonly string[] | undefined) => (keys === undefined ? undefined : [...keys].sort())
  return JSON.stringify({
    mode,
    ...body,
    types: sorted(body.types),
    indices: sorted(body.indices),
    documents: sorted(body.documents),
    filter: body.filter === undefined ? undefined : Object.entries(body.filter).sort(([a], [b]) => a.localeCompare(b)),
  })
}

/** The request paths a form control answers for. */
export const SEARCH_CONTROLS = [
  'query',
  'types',
  'indices',
  'documents',
  'keyword',
  'semantic',
  'filter',
  'limit',
  'perEntity',
] as const

export type SearchControl = (typeof SEARCH_CONTROLS)[number]

const under = (path: string, control: string) =>
  path === control || path.startsWith(`${control}.`)

/** The messages of `details.fields` at a control: its path or one below it. */
export function fieldErrorsAt(fields: Record<string, string>, control: SearchControl): string[] {
  return Object.entries(fields)
    .filter(([path]) => under(path, control))
    .map(([, message]) => message)
}

/** The messages no control answers for, each with its path. */
export function unplacedFieldErrors(fields: Record<string, string>): string[] {
  return Object.entries(fields)
    .filter(([path]) => !SEARCH_CONTROLS.some((control) => under(path, control)))
    .map(([path, message]) => `${path}: ${message}`)
}

const METHOD_NAMES: Record<Representation, string> = { semantic: 'Semantic', keyword: 'Keyword' }

/** An entry's scores as a line, semantic first, e.g. `Semantic 0.81 · Keyword 2.25`. */
export function scoresText(scores: MethodScores): string {
  return (['semantic', 'keyword'] as const)
    .filter((method) => scores[method] !== undefined)
    .map((method) => `${METHOD_NAMES[method]} ${scores[method]!.toFixed(2)}`)
    .join(' · ')
}

/** What the scores mean, for a hover. */
export const SCORES_TITLE =
  "Each method's own score of this entry: semantic similarity from 0 to 1, keyword query words " +
  'matched plus a fraction. The two are not comparable; the rank orders the results.'

/** The item count above the results, e.g. `1 entity`, `3 passages`. */
export function countText(mode: SearchMode, count: number): string {
  if (mode === 'entities') return `${count} ${count === 1 ? 'entity' : 'entities'}`
  return `${count} ${count === 1 ? 'passage' : 'passages'}`
}

/** `ran` as a line above the results. */
export function ranText(ran: readonly Representation[]): string {
  if (ran.length === 0) return 'No method ran'
  const names = ran.map((method) => METHOD_NAMES[method].toLowerCase()).join(' and ')
  return ran.length > 1 ? `Ran ${names} search, fused by rank` : `Ran ${names} search`
}

/** How a limitation names what it lists: display names for keys. */
export interface LimitationNames {
  type: (key: string) => string
  index: (key: string) => string
  /** `type.property` */
  document: (key: string) => string
}

/** A limitation as one sentence naming its types, documents or indices. */
export function limitationSentence(
  limitation: SearchLimitation,
  mode: SearchMode,
  names: LimitationNames,
): string {
  const types = (limitation.types ?? []).map(names.type)
  const documents = (limitation.documents ?? []).map(names.document)
  const indices = (limitation.indices ?? []).map(names.index)
  const method = limitation.method !== undefined ? METHOD_NAMES[limitation.method] : undefined
  switch (limitation.code) {
    case 'not-searchable': {
      const named = [...types, ...documents]
      if (named.length === 0) break
      const kind = mode === 'passages' ? 'passage index' : 'search index'
      return `No ${kind} this lens can search for ${named.join(', ')}, so nothing was searched there.`
    }
    case 'switched-off':
      if (method === undefined || indices.length === 0) break
      return `${method} search is switched off on ${indices.join(', ')}.`
    case 'not-ready':
      if (method === undefined || indices.length === 0) break
      return `${method} search entries of ${indices.join(', ')} are not built yet.`
    case 'filter-excludes-all-types':
      if (types.length === 0) break
      return `None of ${types.join(', ')} declares every filter key, so nothing was searched.`
  }
  return limitation.message
}

export const entityLink = (ontologyKey: string, lensKey: string, entity: EntityReference) =>
  `/o/${ontologyKey}/w/${lensKey}/e/${entity._entityTypeKey}/${entity._id}`

export const entityLabel = (entity: EntityReference) => entity.name ?? entity._id

/** Whether a saved query's run answered with an entity search (its last
 * step is a search step) rather than OQL rows. */
export function isEntitySearchResponse(
  result: QueryResult | EntitySearchResponse,
): result is EntitySearchResponse {
  return 'items' in result && 'ran' in result
}
