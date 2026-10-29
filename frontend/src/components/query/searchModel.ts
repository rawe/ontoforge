/**
 * Pure helpers for the Query page's Search tab: the body the form sends to
 * `POST /search/entities` or `/search/passages`, the field errors a control
 * shows, and `ran` and the limitations as readable sentences.
 *
 * No React, no I/O — unit-tested with `node --test`. The server stays
 * authoritative: a value the form cannot judge is sent and its error shown.
 */

import type { PassageSearchBody, Representation, SearchLimitation } from '@/api/types'

export type SearchMode = 'entities' | 'passages'

/** The request's scope fields; `documents` is the passage search's only. */
export type ScopeField = 'types' | 'indices' | 'documents'

export interface SearchForm {
  mode: SearchMode
  query: string
  /** No keys: the field is left out, so the whole lens is searched. */
  scope: { field: ScopeField; keys: readonly string[] }
  keyword: { on: boolean; match: 'any' | 'all' }
  /** `minSimilarity` as typed; empty leaves the server's floor. */
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
 * The request body: one scope field when it names keys, a block per checked
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

/** The item count above the results, e.g. `1 entity`, `3 passages`. */
export function countText(mode: SearchMode, count: number): string {
  if (mode === 'entities') return `${count} ${count === 1 ? 'entity' : 'entities'}`
  return `${count} ${count === 1 ? 'passage' : 'passages'}`
}

/** `ran` as a line above the results. */
export function ranText(ran: readonly Representation[]): string {
  if (ran.length === 0) return 'No method ran'
  return `Ran ${ran.map((method) => METHOD_NAMES[method].toLowerCase()).join(' and ')} search`
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
