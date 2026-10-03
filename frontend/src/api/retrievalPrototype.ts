/** Isolated V2 prototype contract; configuration is sent per request, never saved as an agent. */
import { readNdjsonStream } from './chatStream.ts'
import { request } from './http.ts'
import type { ChatMessage } from './types'

export interface RetrievalProperty { key: string; displayName: string; dataType: string }
export interface RetrievalType { key: string; displayName: string; properties: RetrievalProperty[] }
export interface RetrievalPathStep { relationTypeKey: string; direction: 'outgoing' | 'incoming' }
export interface RetrievalCondition {
  id: string
  mode: 'hard' | 'soft'
  path: RetrievalPathStep[]
  targetField: string
  textFields: string[]
}
export interface RetrievalBucket {
  entityTypeKey: string
  searchFields: string[]
  answerFields: string[]
  conditions: RetrievalCondition[]
}
export interface RetrievalConfig {
  buckets: RetrievalBucket[]
  threshold: number
  answerFieldCharacters?: number
}
export interface RetrievalCatalog {
  entityTypes: RetrievalType[]
  relationTypes: { key: string; displayName: string; fromEntityTypeKey: string; toEntityTypeKey: string }[]
  defaults: { threshold: number }
  limits: { entities: number; relations: number; contextCharacters: number }
}
export interface RetrievalResult {
  entityTypeKey: string
  totalHardMatches: number
  totalAccepted: number
  omitted: number
  items: { id: string; score: number | null; fields: Record<string, unknown>; relations: unknown; sources?: Record<string, unknown>[] }[]
}
export interface RetrievalMeta {
  turnToken?: string
  llmCalls?: number
  plan?: unknown
  results?: RetrievalResult[]
  timings?: Record<string, number>
  modelIO?: { phase: string; systemPrompt?: string; input: string; output: string; usage?: unknown; finishReason?: string; inputTruncated?: boolean; outputTruncated?: boolean }[]
  embeddingRequests?: number
  cacheHits?: number
  limitations?: string[]
}
export type RetrievalEvent =
  | { type: 'phase'; phase: string; status: 'start' | 'end'; durationMs?: number }
  | { type: 'delta'; text: string }
  | ({ type: 'meta' } & RetrievalMeta)
  | { type: 'final'; reply: string }
  | { type: 'error'; error: { code: string; message: string } }
export interface RetrievalPreparation {
  ready: true
  entityCount: number
  relationCount: number
  fingerprint: string
  embeddingRequests: number
  cacheHits: number
  timings: Record<string, number>
}

const base = (ontologyKey: string, lensKey: string) =>
  `/api/ontologies/${encodeURIComponent(ontologyKey)}/runtime/lenses/${encodeURIComponent(lensKey)}/ai/retriever`

export const retrievalCatalog = (ontologyKey: string, lensKey: string) =>
  request<RetrievalCatalog>(`${base(ontologyKey, lensKey)}/catalog`)

export const prepareRetrieval = (ontologyKey: string, lensKey: string, config: RetrievalConfig, signal: AbortSignal) =>
  request<RetrievalPreparation>(`${base(ontologyKey, lensKey)}/prepare`, { method: 'POST', body: { config }, signal })

function record(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value)
}

/** Validate the stream envelope before updating UI; an unknown event fails the turn. */
function parseEvent(event: Record<string, unknown>): RetrievalEvent {
  switch (event.type) {
    case 'phase':
      if (typeof event.phase === 'string' && ['start', 'end'].includes(String(event.status)) &&
          (event.durationMs === undefined || typeof event.durationMs === 'number')) return event as RetrievalEvent
      break
    case 'delta': if (typeof event.text === 'string') return event as RetrievalEvent; break
    case 'final': if (typeof event.reply === 'string') return event as RetrievalEvent; break
    case 'error':
      if (record(event.error) && typeof event.error.code === 'string' && typeof event.error.message === 'string') return event as RetrievalEvent
      break
    case 'meta': {
      if (event.turnToken !== undefined && typeof event.turnToken !== 'string') break
      if (event.timings !== undefined && (!record(event.timings) || Object.values(event.timings).some((x) => typeof x !== 'number' || !Number.isFinite(x)))) break
      // Preserve additional bounded metadata, including finishReason from a failed plan parse.
      if (event.modelIO !== undefined && (!Array.isArray(event.modelIO) || event.modelIO.some((x) => !record(x) || typeof x.phase !== 'string' || typeof x.input !== 'string' || typeof x.output !== 'string'))) break
      if (event.limitations !== undefined && (!Array.isArray(event.limitations) || event.limitations.some((x) => typeof x !== 'string'))) break
      if (event.results !== undefined && (!Array.isArray(event.results) || event.results.some((x) => !record(x) || typeof x.entityTypeKey !== 'string' || !Array.isArray(x.items) ||
        ['totalHardMatches', 'totalAccepted', 'omitted'].some((key) => typeof x[key] !== 'number') || x.items.some((i: unknown) => !record(i) || typeof i.id !== 'string' || !record(i.fields) || (i.score !== null && typeof i.score !== 'number'))))) break
      if (['embeddingRequests', 'cacheHits'].some((key) => event[key] !== undefined && typeof event[key] !== 'number')) break
      return event as RetrievalEvent
    }
  }
  throw new Error('Invalid event in the retriever stream.')
}

export async function chatRetrieval(
  ontologyKey: string, lensKey: string,
  body: { config: RetrievalConfig; message: string; history: ChatMessage[]; turnToken?: string },
  onEvent: (event: RetrievalEvent) => void, signal: AbortSignal,
) {
  const response = await fetch(`${base(ontologyKey, lensKey)}/chat`, {
    method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body), signal,
  })
  await readRetrievalStream(response, onEvent, signal)
}

export async function readRetrievalStream(response: Response, onEvent: (event: RetrievalEvent) => void, signal: AbortSignal) {
  let streamed = ''
  await readNdjsonStream(response, (raw) => {
    signal.throwIfAborted()
    const event = parseEvent(raw)
    if (event.type === 'delta') streamed += event.text
    if (event.type === 'final' && streamed && streamed !== event.reply) throw new Error('The final answer does not match the streamed text.')
    onEvent(event)
    return event.type === 'final' || event.type === 'error'
  })
}
