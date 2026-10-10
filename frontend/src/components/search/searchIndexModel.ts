/**
 * Pure helpers for the Studio Search area: the schema an index designer
 * reads, field counting and limits, relation-group options, draft →
 * definition normalisation, status chip text and search-settings edits.
 *
 * No React, no I/O — unit-tested with `node --test`. The server stays
 * authoritative; these rules only keep the UI from offering what it rejects.
 */

import type {
  DataType,
  IndexState,
  IndexStatus,
  KeywordLanguage,
  RelationDirection,
  SearchIndexDefinition,
  SearchIndexDraftInput,
  SearchIndexRecord,
  SearchIndexRelationGroup,
  ValidationError,
} from '@/api/types'

/** Most fields one custom index reads: own, relation and target fields together. */
export const MAX_INDEX_FIELDS = 12

/** Most relation groups one custom index holds. */
export const MAX_RELATION_GROUPS = 4

/** Data types an index renders as text; `document` only as one own field. */
export const TEXT_DATA_TYPES: readonly DataType[] = [
  'string',
  'integer',
  'float',
  'boolean',
  'date',
  'datetime',
]

/* --------------------------------- schema ---------------------------------- */

export interface IndexSchemaProperty {
  key: string
  displayName: string
  dataType: DataType
}

export interface IndexSchemaEntityType {
  key: string
  displayName: string
  nameProperty: string
  properties: IndexSchemaProperty[]
}

export interface IndexSchemaRelationType {
  key: string
  displayName: string
  sourceEntityTypeKey: string
  targetEntityTypeKey: string
  properties: IndexSchemaProperty[]
}

/** The modeling schema as the designer reads it (declaration order kept). */
export interface IndexSchema {
  entityTypes: IndexSchemaEntityType[]
  relationTypes: IndexSchemaRelationType[]
}

/** Managed keys (`<type>~default`, `<type>~<document>`) contain `~`; user keys never do. */
export const isManagedIndexKey = (key: string) => key.includes('~')

export const isTextProperty = (p: IndexSchemaProperty) => TEXT_DATA_TYPES.includes(p.dataType)

/** Own fields an index may read: text properties and document properties. */
export const ownFieldOptions = (root: IndexSchemaEntityType) =>
  root.properties.filter((p) => isTextProperty(p) || p.dataType === 'document')

/** The document property among the selected own fields, if any. */
export function selectedDocument(
  fields: readonly string[],
  root: IndexSchemaEntityType,
): string | null {
  const documents = new Set(
    root.properties.filter((p) => p.dataType === 'document').map((p) => p.key),
  )
  return fields.find((f) => documents.has(f)) ?? null
}

/* ------------------------------ fields & limits ----------------------------- */

/** Fields counted toward the limit: own + relation + target. The header does not count. */
export function countFields(
  definition: Pick<SearchIndexDefinition, 'fields' | 'relations'>,
): number {
  return (
    definition.fields.length +
    definition.relations.reduce(
      (sum, group) =>
        sum +
        group.fields.length +
        Object.values(group.target).reduce((n, list) => n + list.length, 0),
      0,
    )
  )
}

/** Add (at the end) or remove a key, keeping the existing order. */
export function toggleKey(list: readonly string[], key: string, on: boolean): string[] {
  if (on) return list.includes(key) ? [...list] : [...list, key]
  return list.filter((k) => k !== key)
}

/* ------------------------------ relation groups ----------------------------- */

export interface RelationGroupOption {
  relationType: string
  direction: RelationDirection
  /** Entity type on the other end — the group's only target type. */
  otherEnd: string
  displayName: string
}

/** Select value of a group / option: one relation type in one direction. */
export const groupValue = (g: { relationType: string; direction: RelationDirection }) =>
  `${g.relationType}/${g.direction}`

/**
 * Relation types connecting the root, in either direction (one hop). A
 * self-relation yields two options, one per direction.
 */
export function relationGroupOptions(
  schema: IndexSchema,
  rootKey: string,
): RelationGroupOption[] {
  const options: RelationGroupOption[] = []
  for (const r of schema.relationTypes) {
    if (r.sourceEntityTypeKey === rootKey) {
      options.push({
        relationType: r.key,
        direction: 'outgoing',
        otherEnd: r.targetEntityTypeKey,
        displayName: r.displayName,
      })
    }
    if (r.targetEntityTypeKey === rootKey) {
      options.push({
        relationType: r.key,
        direction: 'incoming',
        otherEnd: r.sourceEntityTypeKey,
        displayName: r.displayName,
      })
    }
  }
  return options
}

/** A fresh group for an option: no fields picked yet. */
export function newRelationGroup(option: RelationGroupOption): SearchIndexRelationGroup {
  return {
    relationType: option.relationType,
    direction: option.direction,
    fields: [],
    target: {},
    label: null,
    template: null,
  }
}

/* ---------------------------------- drafts ---------------------------------- */

/** An empty custom index: header = name property, semantic + keyword on. */
export function emptyDraft(entityType = ''): SearchIndexDefinition {
  return {
    key: '',
    name: '',
    description: '',
    entityType,
    fields: [],
    header: null,
    relations: [],
    semantic: { enabled: true, template: null },
    keyword: { enabled: true },
  }
}

/** Switch the root: everything read from the old root is dropped. */
export function withEntityType(
  draft: SearchIndexDefinition,
  entityType: string,
): SearchIndexDefinition {
  if (draft.entityType === entityType) return draft
  return { ...draft, entityType, fields: [], header: null, relations: [] }
}

const blankToNull = (value: string | null) => {
  const trimmed = value?.trim() ?? ''
  return trimmed === '' ? null : trimmed
}

/**
 * The definition a draft stands for: trimmed texts, blank label/template →
 * null, target lists without empty entries. Two drafts are equal exactly
 * when their definitions are.
 */
export function toDefinition(draft: SearchIndexDefinition): SearchIndexDefinition {
  return {
    key: draft.key.trim(),
    name: draft.name.trim(),
    description: draft.description.trim(),
    entityType: draft.entityType,
    fields: [...draft.fields],
    header: draft.header === null ? null : [...draft.header],
    relations: draft.relations.map((g) => ({
      relationType: g.relationType,
      direction: g.direction,
      fields: [...g.fields],
      target: Object.fromEntries(
        Object.entries(g.target).filter(([, list]) => list.length > 0),
      ),
      label: blankToNull(g.label),
      template: blankToNull(g.template),
    })),
    semantic: {
      enabled: draft.semantic.enabled,
      template: blankToNull(draft.semantic.template),
    },
    keyword: { enabled: draft.keyword.enabled },
  }
}

/** The preview body: a new index has no key yet, so a blank key is left out. */
export function toPreviewInput(draft: SearchIndexDefinition): SearchIndexDraftInput {
  const { key, ...rest } = toDefinition(draft)
  return key === '' ? rest : { key, ...rest }
}

export function sameDefinition(a: SearchIndexDefinition, b: SearchIndexDefinition): boolean {
  return JSON.stringify(toDefinition(a)) === JSON.stringify(toDefinition(b))
}

export type HeaderMode = 'name' | 'fields' | 'none'

/** `null` → the name property, `[]` → none, else chosen fields. */
export const headerMode = (header: string[] | null): HeaderMode =>
  header === null ? 'name' : header.length === 0 ? 'none' : 'fields'

/**
 * Problems the client can see before asking the server — what keeps Save
 * disabled. Key pattern and uniqueness are checked by the key field.
 */
export function draftProblems(draft: SearchIndexDefinition): ValidationError[] {
  const problems: ValidationError[] = []
  const add = (path: string, message: string) => problems.push({ path, message })
  if (draft.name.trim() === '') add('name', 'Give the index a name.')
  if (draft.description.trim() === '') {
    add('description', 'Describe what the index finds — agents choose indices by it.')
  }
  if (draft.entityType === '') add('entityType', 'Choose the entity type the index finds.')
  if (draft.fields.length === 0 && draft.relations.length === 0) {
    add('fields', 'Pick at least one field or add a relation group.')
  }
  const count = countFields(draft)
  if (count > MAX_INDEX_FIELDS) {
    add('fields', `At most ${MAX_INDEX_FIELDS} fields — this draft reads ${count}.`)
  }
  if (draft.relations.length > MAX_RELATION_GROUPS) {
    add('relations', `At most ${MAX_RELATION_GROUPS} relation groups.`)
  }
  draft.relations.forEach((g, i) => {
    const targetCount = Object.values(g.target).reduce((n, list) => n + list.length, 0)
    if (g.fields.length === 0 && targetCount === 0) {
      add(`relations.${i}`, 'Pick at least one relation or target field.')
    }
  })
  if (!draft.semantic.enabled && !draft.keyword.enabled) {
    add('semantic.enabled', 'Enable semantic search, keyword search or both.')
  }
  return problems
}

/** Issues whose path is `prefix` or lies below it (`relations.0` → `relations.0.fields.1`). */
export function issuesAt(
  issues: readonly ValidationError[],
  prefix: string,
): ValidationError[] {
  return issues.filter((i) => i.path === prefix || i.path.startsWith(`${prefix}.`))
}

/* ---------------------------------- status ---------------------------------- */

export type StatusTone = 'ok' | 'busy' | 'warn' | 'error' | 'muted'

/** Building or stale: the UI polls while any shown index is in one of these states. */
export const isBusyState = (state: IndexState) => state === 'building' || state === 'stale'

export const anyBusy = (records: readonly SearchIndexRecord[] | undefined) =>
  records?.some((r) => isBusyState(r.status.state)) ?? false

const sum = (status: IndexStatus, pick: (r: IndexStatus['representations'][number]) => number) =>
  status.representations.reduce((n, r) => n + pick(r), 0)

/** Chip text and tone for an index status. */
export function statusChip(status: IndexStatus): { label: string; tone: StatusTone } {
  switch (status.state) {
    case 'ready':
      return { label: 'ready', tone: 'ok' }
    case 'building': {
      const builds = status.representations.filter((r) => r.state === 'building')
      const done = builds.reduce((n, r) => n + (r.build?.done ?? 0), 0)
      const total = builds.reduce((n, r) => n + (r.build?.total ?? 0), 0)
      return { label: total > 0 ? `building ${done}/${total}` : 'building', tone: 'busy' }
    }
    case 'stale':
      return { label: `stale · ${sum(status, (r) => r.pending)} pending`, tone: 'warn' }
    case 'failed':
      return { label: `failed · ${sum(status, (r) => r.failed)}`, tone: 'error' }
    case 'disabled':
      return { label: 'disabled', tone: 'muted' }
    case 'unavailable':
      return { label: 'unavailable', tone: 'muted' }
  }
}

/** One representation's state in words — chip tooltip and status block. */
export function representationLine(r: IndexStatus['representations'][number]): string {
  switch (r.state) {
    case 'building':
      return r.build ? `building ${r.build.done}/${r.build.total}` : 'building'
    case 'stale':
      return `stale · ${r.pending} pending`
    case 'failed':
      return `failed · ${r.failed}`
    case 'unavailable':
      return 'unavailable — no embedding provider configured'
    default:
      return r.state
  }
}

/** Representations an index builds, in fixed order. */
export function representations(definition: SearchIndexDefinition): ('semantic' | 'keyword')[] {
  return [
    ...(definition.semantic.enabled ? (['semantic'] as const) : []),
    ...(definition.keyword.enabled ? (['keyword'] as const) : []),
  ]
}

/** Rough human duration for the cost preview: `< 1 s`, `40 s`, `3 min`, `2.5 h`. */
export function formatDuration(seconds: number): string {
  if (seconds < 1) return '< 1 s'
  if (seconds < 90) return `${Math.round(seconds)} s`
  const minutes = seconds / 60
  if (minutes < 90) return `${Math.round(minutes)} min`
  const hours = minutes / 60
  return `${hours < 10 ? Math.round(hours * 10) / 10 : Math.round(hours)} h`
}

/* ------------------------------ search settings ----------------------------- */

const LANGUAGE_ORDER: readonly KeywordLanguage[] = ['german', 'english']

/** Turn one keyword language on or off; the set never becomes empty. */
export function toggleKeywordLanguage(
  languages: readonly KeywordLanguage[],
  language: KeywordLanguage,
  on: boolean,
): KeywordLanguage[] {
  const next = new Set(languages)
  if (on) next.add(language)
  else next.delete(language)
  if (next.size === 0) return LANGUAGE_ORDER.filter((l) => languages.includes(l))
  return LANGUAGE_ORDER.filter((l) => next.has(l))
}

/** Switch a managed index: `disabledIndices` lists the ones switched off (sorted). */
export function toggleDisabledIndex(
  disabled: readonly string[],
  key: string,
  enabled: boolean,
): string[] {
  const next = new Set(disabled)
  if (enabled) next.delete(key)
  else next.add(key)
  return [...next].sort()
}

export interface ManagedGroup {
  entityType: string
  defaultIndex: SearchIndexRecord | null
  passages: SearchIndexRecord[]
}

/** Managed indices grouped by entity type, in the order the types first appear. */
export function managedByEntityType(records: readonly SearchIndexRecord[]): ManagedGroup[] {
  const groups = new Map<string, ManagedGroup>()
  for (const r of records) {
    if (r.kind === 'custom') continue
    const type = r.definition.entityType
    let group = groups.get(type)
    if (group === undefined) {
      group = { entityType: type, defaultIndex: null, passages: [] }
      groups.set(type, group)
    }
    if (r.kind === 'default') group.defaultIndex = r
    else group.passages.push(r)
  }
  return [...groups.values()]
}
