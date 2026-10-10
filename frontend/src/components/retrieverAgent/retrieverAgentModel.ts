/**
 * Pure helpers of the retriever-agent editor, test panel and Workbench chat:
 * config v2 draft edits, client-side checks, execution rule, filter paths
 * and diagnostics formatting. No React, no runtime imports — unit-tested
 * with `node --test`.
 */
import type {
  PlanSubQuery,
  RetrieverAgent,
  RetrieverAgentConfig,
  RetrieverAgentFilter,
  RetrieverDiagnostics,
  RetrieverAgentPathStep,
  RetrieverAgentResult,
  SearchMode,
} from '@/api/retrieverAgents'
import type { SearchCatalogEntry, ValidationError } from '@/api/types'

/** Client defaults (the server has no catalog endpoint for them). */
export const DEFAULT_THRESHOLD = 0.35
export const DEFAULT_ANSWER_FIELD_CHARACTERS = 800
export const MIN_ANSWER_FIELD_CHARACTERS = 100
export const MAX_ANSWER_FIELD_CHARACTERS = 2000
export const MAX_ANSWER_FIELDS = 12
export const MAX_FILTER_HOPS = 2
export const CONFIG_VERSION = 2

/** The parts of a lens schema the editor reads (a `RuntimeSchema` fits). */
export interface AgentSchemaProperty { key: string; displayName: string; dataType: string }
export interface AgentSchemaType {
  key: string
  displayName: string
  nameProperty: string | null
  properties: readonly AgentSchemaProperty[]
}
export interface AgentSchema {
  entityTypes: readonly AgentSchemaType[]
  relationTypes: readonly { key: string; displayName: string; fromEntityTypeKey: string; toEntityTypeKey: string }[]
}

export function emptyConfig(): RetrieverAgentConfig {
  return { indices: [], filters: [], answerFields: {}, threshold: DEFAULT_THRESHOLD, answerFieldCharacters: DEFAULT_ANSWER_FIELD_CHARACTERS }
}

/* ---------------------------------- shape ---------------------------------- */

const record = (item: unknown): item is Record<string, unknown> => typeof item === 'object' && item !== null && !Array.isArray(item)
const strings = (items: unknown): items is string[] => Array.isArray(items) && items.every((item) => typeof item === 'string')

/** Keeps references the lens no longer has (for repair) while rejecting shapes that would break the editor. */
export function editableConfig(value: unknown): value is RetrieverAgentConfig {
  if (!record(value)) return false
  const { indices, filters, answerFields, threshold, answerFieldCharacters } = value
  return Array.isArray(indices) && indices.every((item) => record(item) && typeof item.index === 'string' && (item.relations === undefined || strings(item.relations))) &&
    Array.isArray(filters) && filters.every((item) => record(item) && typeof item.id === 'string' && typeof item.entityType === 'string' && typeof item.field === 'string' &&
      Array.isArray(item.path) && item.path.every((hop) => record(hop) && typeof hop.relationTypeKey === 'string' && (hop.direction === 'outgoing' || hop.direction === 'incoming'))) &&
    record(answerFields) && Object.values(answerFields).every(strings) &&
    typeof threshold === 'number' && Number.isFinite(threshold) &&
    typeof answerFieldCharacters === 'number' && Number.isFinite(answerFieldCharacters)
}

/** Version 2 with an editable shape — anything else is preserved but can only be exported or deleted. */
export const isSupportedAgent = (agent: Pick<RetrieverAgent, 'configVersion' | 'config'>) =>
  agent.configVersion === CONFIG_VERSION && editableConfig(agent.config)

export interface AgentDraft { name: string; description: string; config: RetrieverAgentConfig }

export function draftOf(agent: RetrieverAgent | null): AgentDraft {
  return {
    name: agent?.name ?? '',
    description: agent?.description ?? '',
    config: agent !== null && isSupportedAgent(agent) ? agent.config : emptyConfig(),
  }
}

export const sameDraft = (a: AgentDraft, b: AgentDraft) =>
  a.name === b.name && a.description === b.description && JSON.stringify(a.config) === JSON.stringify(b.config)

/** The write body of a draft. */
export function toInput(draft: AgentDraft) {
  return { name: draft.name.trim(), description: draft.description.trim() || null, configVersion: CONFIG_VERSION as 2, config: draft.config }
}

/**
 * An agent runs only from its saved, unchanged, valid version 2 configuration.
 * The editor's test panel asks this; elsewhere the server's refusal says why.
 */
export function agentExecution(agent: Pick<RetrieverAgent, 'key' | 'configVersion' | 'config' | 'validation'> | null, dirty: boolean):
  { mode: 'saved'; key: string } | { mode: 'blocked'; reason: string } {
  if (agent === null) return { mode: 'blocked', reason: 'Save this retriever to test it.' }
  if (!isSupportedAgent(agent)) return { mode: 'blocked', reason: 'Unsupported saved configuration. Export it, or delete it.' }
  if (dirty) return { mode: 'blocked', reason: 'Unsaved changes. Save them to test; questions use the saved configuration.' }
  if (!agent.validation.valid) return { mode: 'blocked', reason: 'This retriever is invalid in the current lens. Repair and save it before asking.' }
  return { mode: 'saved', key: agent.key }
}

/* ---------------------------------- indices -------------------------------- */

const scalar = (p: AgentSchemaProperty) => p.dataType !== 'document'

/** Fields an answer may use: every visible property; documents are truncated like any value. */
export const answerFieldOptions = (type: AgentSchemaType) => type.properties

/** The name property, else the first non-document field. */
export function defaultAnswerFields(type: AgentSchemaType | undefined): string[] {
  if (type === undefined) return []
  const name = type.properties.find((p) => p.key === type.nameProperty)
  return name !== undefined ? [name.key] : type.properties.filter(scalar).slice(0, 1).map((p) => p.key)
}

/** Result types: the root types of the chosen indices the lens offers, in config order. */
export function resultTypes(config: RetrieverAgentConfig, catalog: readonly SearchCatalogEntry[]): string[] {
  const types: string[] = []
  for (const ref of config.indices) {
    const type = catalog.find((entry) => entry.key === ref.index)?.entityType
    if (type !== undefined && !types.includes(type)) types.push(type)
  }
  return types
}

/** Add an index; a new result type gets default answer fields. */
export function withIndex(config: RetrieverAgentConfig, entry: SearchCatalogEntry, schema: AgentSchema | undefined): RetrieverAgentConfig {
  if (config.indices.some((ref) => ref.index === entry.key)) return config
  const answerFields = entry.entityType in config.answerFields ? config.answerFields
    : { ...config.answerFields, [entry.entityType]: defaultAnswerFields(schema?.entityTypes.find((t) => t.key === entry.entityType)) }
  return { ...config, indices: [...config.indices, { index: entry.key }], answerFields }
}

/** Remove an index; when no other chosen index has its root type, that type's answer fields and filters go too. */
export function withoutIndex(config: RetrieverAgentConfig, key: string, catalog: readonly SearchCatalogEntry[]): RetrieverAgentConfig {
  const indices = config.indices.filter((ref) => ref.index !== key)
  const type = catalog.find((entry) => entry.key === key)?.entityType
  const next = { ...config, indices }
  if (type === undefined || resultTypes(next, catalog).includes(type)) return next
  const answerFields = { ...config.answerFields }
  delete answerFields[type]
  return { ...next, answerFields, filters: config.filters.filter((f) => f.entityType !== type) }
}

/** Relation types of an index's relation groups (a type followed both ways counts once). */
export const groupRelationTypes = (entry: SearchCatalogEntry) => [...new Set(entry.relations.map((g) => g.relationType))]

/** `undefined` = all relation groups of the index. */
export function withRelations(config: RetrieverAgentConfig, key: string, relations: string[] | undefined): RetrieverAgentConfig {
  return {
    ...config,
    indices: config.indices.map((ref) => {
      if (ref.index !== key) return ref
      return relations === undefined ? { index: ref.index } : { index: ref.index, relations }
    }),
  }
}

/* ---------------------------------- filters -------------------------------- */

export interface PathChoice { key: string; path: RetrieverAgentPathStep[]; label: string; target: AgentSchemaType }

export const pathKey = (path: readonly RetrieverAgentPathStep[]) => path.map((p) => `${p.relationTypeKey}:${p.direction}`).join('/')

/** Own fields plus every visible path of up to two relations, both directions, without revisiting a type. */
export function filterChoices(schema: AgentSchema, startKey: string): PathChoice[] {
  const start = schema.entityTypes.find((t) => t.key === startKey)
  if (start === undefined) return []
  const choices: PathChoice[] = [{ key: '', path: [], label: start.displayName, target: start }]
  function visit(type: AgentSchemaType, path: RetrieverAgentPathStep[], labels: string[], visited: string[]) {
    if (path.length === MAX_FILTER_HOPS) return
    for (const relation of schema.relationTypes) {
      const directions: RetrieverAgentPathStep['direction'][] = []
      if (relation.fromEntityTypeKey === type.key) directions.push('outgoing')
      if (relation.toEntityTypeKey === type.key) directions.push('incoming')
      for (const direction of directions) {
        const targetKey = direction === 'outgoing' ? relation.toEntityTypeKey : relation.fromEntityTypeKey
        const target = schema.entityTypes.find((t) => t.key === targetKey)
        if (target === undefined || visited.includes(targetKey)) continue
        const next = [...path, { relationTypeKey: relation.key, direction }]
        const nextLabels = [...labels, `${relation.displayName} ${direction === 'outgoing' ? '→' : '←'} ${target.displayName}`]
        choices.push({ key: pathKey(next), path: next, label: nextLabels.join(' · '), target })
        visit(target, next, nextLabels, [...visited, targetKey])
      }
    }
  }
  visit(start, [], [start.displayName], [start.key])
  return choices
}

/** Fields a filter offers: visible non-document properties of the reached type (any visible field stays valid). */
export const filterFieldOptions = (type: AgentSchemaType) => type.properties.filter(scalar)

function uniqueId(base: string, taken: readonly string[]): string {
  const stem = base.toLowerCase().replace(/[^a-z0-9]+/g, '_').replace(/^[^a-z]+|_+$/g, '') || 'filter'
  if (!taken.includes(stem)) return stem
  let n = 2
  while (taken.includes(`${stem}_${n}`)) n += 1
  return `${stem}_${n}`
}

/** A filter on the choice's reached type; compares its name property, else its first field. The id names it for the planner. */
export function newFilter(config: RetrieverAgentConfig, entityType: string, choice: PathChoice): RetrieverAgentFilter {
  const fields = filterFieldOptions(choice.target)
  const field = fields.find((p) => p.key === choice.target.nameProperty)?.key ?? fields[0]?.key ?? ''
  const base = choice.path.length === 0 ? field : `${choice.target.key}_${field}`
  return { id: uniqueId(base, config.filters.map((f) => f.id)), entityType, path: choice.path, field }
}

/** "Person · works for → Company · City" — the readable form of a filter, also for diagnostics. */
export function filterLabel(filter: RetrieverAgentFilter, schema: AgentSchema | undefined): string {
  const choice = schema === undefined ? undefined : filterChoices(schema, filter.entityType).find((c) => c.key === pathKey(filter.path))
  if (choice === undefined) return filter.id
  const field = choice.target.properties.find((p) => p.key === filter.field)?.displayName ?? filter.field
  return `${choice.label} · ${field}`
}

/* -------------------------------- validation ------------------------------- */

/**
 * Client checks of a draft, worded for the editor. The server validates
 * again on save and reports what the lens no longer offers.
 */
export function draftProblems(config: RetrieverAgentConfig, catalog: readonly SearchCatalogEntry[] | undefined, schema: AgentSchema | undefined): ValidationError[] {
  const problems: ValidationError[] = []
  if (config.indices.length === 0) problems.push({ path: 'indices', message: 'Choose at least one search index.' })
  config.indices.forEach((ref, i) => {
    if (catalog === undefined) return
    const entry = catalog.find((c) => c.key === ref.index)
    if (entry === undefined) { problems.push({ path: `indices[${i}].index`, message: `Index ${ref.index} is not available in this lens.` }); return }
    if (ref.relations !== undefined) {
      if (ref.relations.length === 0) problems.push({ path: `indices[${i}].relations`, message: `Choose at least one relation group of ${entry.name}, or all of them.` })
      const groups = groupRelationTypes(entry)
      for (const relation of ref.relations) {
        if (!groups.includes(relation)) problems.push({ path: `indices[${i}].relations`, message: `${entry.name} has no relation group ${relation}.` })
      }
    }
  })
  const types = catalog === undefined ? undefined : resultTypes(config, catalog)
  const ids = new Set<string>()
  config.filters.forEach((filter, i) => {
    const at = `filters[${i}]`
    if (!filter.id.trim()) problems.push({ path: `${at}.id`, message: 'A filter needs an id.' })
    else if (ids.has(filter.id)) problems.push({ path: `${at}.id`, message: `Filter id ${filter.id} is used twice.` })
    ids.add(filter.id)
    if (types !== undefined && !types.includes(filter.entityType)) problems.push({ path: `${at}.entityType`, message: `Filter ${filter.id}: ${filter.entityType} is not a result type of the chosen indices.` })
    if (schema === undefined) return
    const choice = filterChoices(schema, filter.entityType).find((c) => c.key === pathKey(filter.path))
    if (choice === undefined) problems.push({ path: `${at}.path`, message: `Filter ${filter.id}: its relation path is not visible in this lens.` })
    else if (!choice.target.properties.some((p) => p.key === filter.field)) problems.push({ path: `${at}.field`, message: `Filter ${filter.id}: choose a field to compare.` })
  })
  for (const type of types ?? []) {
    const fields = config.answerFields[type] ?? []
    if (fields.length === 0) problems.push({ path: `answerFields.${type}`, message: `Choose at least one answer field for ${schema?.entityTypes.find((t) => t.key === type)?.displayName ?? type}.` })
    if (fields.length > MAX_ANSWER_FIELDS) problems.push({ path: `answerFields.${type}`, message: `At most ${MAX_ANSWER_FIELDS} answer fields per type.` })
    const visible = schema?.entityTypes.find((t) => t.key === type)
    for (const field of fields) {
      if (visible !== undefined && !answerFieldOptions(visible).some((p) => p.key === field)) problems.push({ path: `answerFields.${type}`, message: `Answer field ${field} of ${visible.displayName} is not visible in this lens.` })
    }
  }
  if (types !== undefined) {
    for (const type of Object.keys(config.answerFields)) {
      if (!types.includes(type)) problems.push({ path: `answerFields.${type}`, message: `Answer fields for ${type}, which no chosen index finds.` })
    }
  }
  if (config.threshold < -1 || config.threshold > 1) problems.push({ path: 'threshold', message: 'The threshold lies between −1 and 1.' })
  if (!Number.isInteger(config.answerFieldCharacters) || config.answerFieldCharacters < MIN_ANSWER_FIELD_CHARACTERS || config.answerFieldCharacters > MAX_ANSWER_FIELD_CHARACTERS) {
    problems.push({ path: 'answerFieldCharacters', message: `Characters per answer field: a whole number from ${MIN_ANSWER_FIELD_CHARACTERS} to ${MAX_ANSWER_FIELD_CHARACTERS}.` })
  }
  return problems
}

/** Server validation strings as panel issues (they carry no path). */
export const asIssues = (messages: readonly string[]): ValidationError[] => messages.map((message) => ({ path: '', message }))

/** One portable export body, checked before it is offered for import. */
export function importProblem(body: unknown, existingKeys: readonly string[]): string | null {
  if (!record(body) || body.configVersion !== CONFIG_VERSION || typeof body.key !== 'string' || typeof body.name !== 'string' || !editableConfig(body.config)) {
    return 'Expected a version 2 retriever export with key, name and config.'
  }
  if (existingKeys.includes(body.key)) return `Key ${body.key} already exists in this lens. Change the key in the JSON first.`
  return null
}

/* -------------------------------- diagnostics ------------------------------ */

/** Display names of chat phases and timings; unknown names show as sent. */
export const phaseNames: Record<string, string> = {
  plan: 'Plan question', validation: 'Validate plan', retrieve: 'Search indices', context: 'Build answer context',
  answer: 'Write answer', firstDelta: 'First answer text', total: 'Total', schemaRead: 'Read schema',
  planModel: 'Planner model', search: 'Search calls', answerModel: 'Response model',
}
export const phaseName = (phase: string) => phaseNames[phase] ?? phase

/** Heading of one model call in the diagnostics: the planner (possibly repeated once) or the response model. */
export const modelCallName = (phase: string) =>
  ({ plan: 'Planner', replan: 'Planner (repeated)', answer: 'Response' } as Record<string, string>)[phase] ?? phaseName(phase)

/** The sequential steps of one question; every other timing is a part of one of them. */
export const STEPS = ['plan', 'retrieve', 'answer'] as const

export type TurnStatus = 'pending' | 'complete' | 'failed'

/**
 * One step's timing cell: its duration; while the turn runs, "…"; in a
 * failed or cancelled turn the first step without a timing "stopped" and
 * later ones "not run" — a finished turn never looks pending.
 */
export function stepText(timings: Record<string, number>, step: (typeof STEPS)[number], status: TurnStatus): string {
  const ms = timings[step]
  if (ms !== undefined) return formatMs(ms)
  if (status === 'pending') return '…'
  if (status === 'complete') return 'not run'
  const firstMissing = STEPS.find((key) => timings[key] === undefined)
  return step === firstMissing ? 'stopped' : 'not run'
}

/** Model and search call counts; model calls fall back to the traced calls, a finished turn without searches made none. */
export function callCounts(meta: RetrieverDiagnostics, status: TurnStatus): { model: number | null; search: number | null } {
  return {
    model: meta.llmCalls ?? (meta.modelIO !== undefined || status !== 'pending' ? (meta.modelIO?.length ?? 0) : null),
    search: meta.searchCalls ?? (status === 'pending' ? null : 0),
  }
}

export const formatMs = (ms: number) => ms < 1000 ? `${ms.toFixed(ms < 10 ? 1 : 0)} ms` : `${(ms / 1000).toFixed(2)} s`

export const MODE_LABEL: Record<SearchMode, string> = { semantic: 'by meaning', keyword: 'by keywords', hybrid: 'by meaning and keywords' }

/** Merge one `retriever.diagnostics` event into a turn's diagnostics: timings and model calls accumulate, limitations dedupe. */
export function mergeDiagnostics(current: RetrieverDiagnostics, data: RetrieverDiagnostics): RetrieverDiagnostics {
  return {
    ...current, ...data,
    timings: { ...current.timings, ...data.timings },
    modelIO: data.modelIO ? [...(current.modelIO ?? []).filter((call) => !data.modelIO?.some((next) => next.phase === call.phase)), ...data.modelIO] : current.modelIO,
    limitations: [...new Set([...(current.limitations ?? []), ...(data.limitations ?? [])])],
  }
}

export const indexName = (key: string, catalog: readonly SearchCatalogEntry[] | undefined) =>
  catalog?.find((entry) => entry.key === key)?.name ?? key

/** A relation group's label in the given indices, else the relation type's display name. */
export function relationName(key: string, indices: readonly string[], catalog: readonly SearchCatalogEntry[] | undefined, schema: AgentSchema | undefined): string {
  const label = catalog?.filter((entry) => indices.includes(entry.key)).flatMap((entry) => entry.relations)
    .find((group) => group.relationType === key && group.label !== null)?.label
  return label ?? schema?.relationTypes.find((r) => r.key === key)?.displayName ?? key
}

/** Results per planned sub-query, in plan order; results of an unknown sub-query come last. */
export function resultsBySubQuery(meta: RetrieverDiagnostics): { subQuery: number; plan: PlanSubQuery | null; results: RetrieverAgentResult[] }[] {
  const planned = meta.plan?.subQueries ?? []
  const groups = new Map<number, RetrieverAgentResult[]>()
  for (const result of meta.results ?? []) groups.set(result.subQuery, [...(groups.get(result.subQuery) ?? []), result])
  return [...groups.keys()].sort((a, b) => a - b).map((subQuery) => ({ subQuery, plan: planned[subQuery] ?? null, results: groups.get(subQuery) ?? [] }))
}

/** "City = Berlin (from “in Berlin”)" for one planned filter. */
export function plannedFilterText(filter: PlanSubQuery['filters'][number], config: RetrieverAgentConfig | null, schema: AgentSchema | undefined): string {
  const configured = config?.filters.find((f) => f.id === filter.id)
  const label = configured === undefined ? filter.id : filterLabel(configured, schema)
  return `${label} = ${filter.value}${filter.quote ? ` (from “${filter.quote}”)` : ''}`
}

/** A result's display label: its label, else the truncated id. */
export const resultLabel = (result: RetrieverAgentResult) => result.label ?? result.entityId.slice(0, 12)
