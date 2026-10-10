/**
 * Retrievers: lens-local saved configurations (config v2) that answer
 * questions over the lens's search indices with a planner and an answer
 * model. Modeling CRUD by lens key + retriever key under
 * `assistants/retrievers`, the runtime chat on a thread with the
 * retriever's own stream events, and retrieve — the found entities without
 * an answer. Every lens also has the implicit default retriever `_default`,
 * derived from its managed indices: first in the runtime list
 * (`runtime.ts` → `listAssistants`), never a modeling resource. The editor
 * reads the runtime index catalog and lens schema (`runtime.ts`), not a
 * catalog of its own.
 */
import { assistantPath, postChat, readAssistantStream, type ChatRequest, type KindReader, type SharedEvent } from './chatStream.ts'
import { request } from './http.ts'
import type { Matched, RelationDirection } from './types'

export type SearchMode = 'semantic' | 'keyword' | 'hybrid'

/** One index the retriever searches; `relations` absent = all its relation groups. */
export interface RetrieverIndex {
  index: string
  relations?: string[]
}
export interface RetrieverPathStep {
  relationTypeKey: string
  direction: RelationDirection
}
/** A hard condition: exact value compare on a field reached by 0..2 hops from a result type. */
export interface RetrieverFilter {
  id: string
  entityType: string
  path: RetrieverPathStep[]
  field: string
}
export interface RetrieverConfig {
  indices: RetrieverIndex[]
  filters: RetrieverFilter[]
  /** Per result entity type, the fields sent to the answer model as evidence. */
  answerFields: Record<string, string[]>
  /** Cosine, −1…1. */
  threshold: number
  answerFieldCharacters: number
}

export interface RetrieverInput {
  name: string
  description: string | null
  configVersion: 2
  config: RetrieverConfig
}
/** Portable JSON (export, import). */
export interface RetrieverExport extends RetrieverInput {
  key: string
}
export interface Retriever {
  key: string
  lensKey: string
  name: string
  description: string | null
  /** Stored versions are preserved; only 2 is editable and executable. */
  configVersion: number
  config: RetrieverConfig
  validation: { valid: boolean; errors: string[]; warnings: string[] }
  createdAt: string
  updatedAt: string
}

/* ------------------------------- diagnostics ------------------------------- */

export interface PlanSubQuery {
  indices: string[]
  relations: string[]
  query: string
  variants: string[]
  mode: SearchMode
  filters: { id: string; value: string; quote: string }[]
}
export interface RetrieverResult {
  entityId: string
  entityType: string
  label: string | null
  /** Index into `plan.subQueries`. */
  subQuery: number
  matched?: Matched
  answerFields: Record<string, unknown>
}
export interface ModelCall {
  phase: string
  systemPrompt?: string
  input: string
  output: string
  usage?: unknown
  finishReason?: string
  inputTruncated?: boolean
  outputTruncated?: boolean
}
/** What `retriever.diagnostics` events report about one answer, merged as they arrive. */
export interface RetrieverDiagnostics {
  llmCalls?: number
  searchCalls?: number
  plan?: { subQueries?: PlanSubQuery[] } & Record<string, unknown>
  results?: RetrieverResult[]
  timings?: Record<string, number>
  modelIO?: ModelCall[]
  limitations?: string[]
}
/** One exact condition a result is proven to satisfy. */
export interface RetrieveCondition {
  /** The filter id of the retriever's configuration. */
  filter: string
  value: string
  /** The condition in plain words: "reported by Customer Name: Acme". */
  text: string
}
/** One found entity; its place in the list is its grade — no score. */
export interface RetrieveResult {
  entityId: string
  entityType: string
  label: string | null
  conditions: RetrieveCondition[]
  /** The text match, or null when the entity was only listed by its conditions. */
  matched: Matched | null
}
export interface RetrieveResponse {
  results: RetrieveResult[]
  limitations: string[]
  unsupportedReason?: string
}

/** A retriever's own stream events. */
export type RetrieverKindEvent =
  | { type: 'retriever.phase'; phase: string; status: 'start' | 'end'; durationMs?: number }
  | ({ type: 'retriever.diagnostics' } & RetrieverDiagnostics)

/** A retriever's turn: the shared events plus its own. */
export type RetrieverEvent = SharedEvent | RetrieverKindEvent

/* ---------------------------------- routes --------------------------------- */

const modelBase = (ontologyKey: string, lensKey: string) =>
  `/api/ontologies/${encodeURIComponent(ontologyKey)}/model/lenses/${encodeURIComponent(lensKey)}/assistants/retrievers`
const modelRetriever = (ontologyKey: string, lensKey: string, key: string) =>
  `${modelBase(ontologyKey, lensKey)}/${encodeURIComponent(key)}`

/** The modeling list: stored retrievers with configuration and validation (Studio). */
export const listRetrievers = (ontologyKey: string, lensKey: string) =>
  request<Retriever[]>(modelBase(ontologyKey, lensKey))
/** Create (201) or replace (200). Sends exactly the write fields — never an export's `key`. */
export const saveRetriever = (ontologyKey: string, lensKey: string, key: string, body: RetrieverInput, signal?: AbortSignal) =>
  request<Retriever>(modelRetriever(ontologyKey, lensKey, key), {
    method: 'PUT', signal,
    body: { name: body.name, description: body.description, configVersion: body.configVersion, config: body.config },
  })
export const deleteRetriever = (ontologyKey: string, lensKey: string, key: string, signal?: AbortSignal) =>
  request<void>(modelRetriever(ontologyKey, lensKey, key), { method: 'DELETE', signal })
export const transferRetriever = (ontologyKey: string, lensKey: string, key: string, mode: 'copy' | 'move', body: { targetLensKey: string; targetKey: string }, signal?: AbortSignal) =>
  request<Retriever>(`${modelRetriever(ontologyKey, lensKey, key)}/${mode}`, { method: 'POST', body, signal })
export const exportRetriever = (ontologyKey: string, lensKey: string, key: string, signal?: AbortSignal) =>
  request<RetrieverExport>(`${modelRetriever(ontologyKey, lensKey, key)}/export`, { signal })
/** Create only: an existing key is a conflict, never replaced. */
export const importRetriever = (ontologyKey: string, lensKey: string, body: RetrieverExport, signal?: AbortSignal) =>
  request<Retriever>(`${modelBase(ontologyKey, lensKey)}/import`, { method: 'POST', body, signal })

/** One message to the saved (or default) retriever on a thread; the browser never sends a configuration. */
export async function chatRetriever(
  ontologyKey: string, lensKey: string, key: string,
  body: ChatRequest & { diagnostics: boolean },
  onEvent: (event: RetrieverEvent) => void, signal: AbortSignal,
) {
  await postChat(assistantPath(ontologyKey, lensKey, 'retrievers', key), body, retrieverReader, onEvent, signal)
}

/** One query to the saved (or default) retriever: its planning and retrieval, no answer. */
export const retrieveQuestion = (
  ontologyKey: string, lensKey: string, key: string,
  body: { query: string }, signal?: AbortSignal,
) => request<RetrieveResponse>(`${assistantPath(ontologyKey, lensKey, 'retrievers', key)}/retrieve`, { method: 'POST', body, signal })

/* ------------------------------- stream reader ------------------------------ */

function record(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value)
}
const strings = (value: unknown) => Array.isArray(value) && value.every((item) => typeof item === 'string')

function validDiagnostics(event: Record<string, unknown>): boolean {
  if (event.timings !== undefined && (!record(event.timings) || Object.values(event.timings).some((x) => typeof x !== 'number' || !Number.isFinite(x)))) return false
  // Preserve additional bounded metadata, including finishReason from a failed plan parse.
  if (event.modelIO !== undefined && (!Array.isArray(event.modelIO) || event.modelIO.some((x) => !record(x) || typeof x.phase !== 'string' || typeof x.input !== 'string' || typeof x.output !== 'string'))) return false
  if (event.limitations !== undefined && !strings(event.limitations)) return false
  if (event.plan !== undefined && (!record(event.plan) || (event.plan.subQueries !== undefined && (!Array.isArray(event.plan.subQueries) ||
    event.plan.subQueries.some((q) => !record(q) || !strings(q.indices) || typeof q.query !== 'string' || (q.relations !== undefined && !strings(q.relations)) || (q.filters !== undefined && !Array.isArray(q.filters))))))) return false
  if (event.results !== undefined && (!Array.isArray(event.results) || event.results.some((x) => !record(x) ||
    typeof x.entityId !== 'string' || typeof x.entityType !== 'string' || typeof x.subQuery !== 'number' ||
    (x.matched !== undefined && !record(x.matched)) || (x.answerFields !== undefined && !record(x.answerFields))))) return false
  if (['llmCalls', 'searchCalls'].some((key) => event[key] !== undefined && typeof event[key] !== 'number')) return false
  return true
}

/** The retriever's own events, validated before they reach the UI; kind events it does not know are ignored. */
const retrieverReader: KindReader<RetrieverKindEvent> = {
  parse(event) {
    switch (event.type) {
      case 'retriever.phase':
        if (typeof event.phase === 'string' && ['start', 'end'].includes(String(event.status)) &&
            (event.durationMs === undefined || typeof event.durationMs === 'number')) return event as RetrieverKindEvent
        break
      case 'retriever.diagnostics': if (validDiagnostics(event)) return event as RetrieverKindEvent; break
      default: if (typeof event.type === 'string' && event.type.includes('.')) return null
    }
    throw new Error('Invalid event in the retriever stream.')
  },
}

export const readRetrieverStream = (response: Response, onEvent: (event: RetrieverEvent) => void, signal: AbortSignal) =>
  readAssistantStream(response, retrieverReader, onEvent, signal)
