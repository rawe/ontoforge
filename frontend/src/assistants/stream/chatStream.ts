/**
 * Chat with an assistant of any kind, under
 * `/api/ontologies/{ontologyKey}/runtime/lenses/{lensKey}/ai/assistants/<kind>`
 * — or the Studio helper, bound to the whole ontology, under
 * `/api/ontologies/{ontologyKey}/model/ai`:
 * one message per request (`{message, threadId?}`), its NDJSON stream read
 * by one reader for the shared events — `thread` first, `delta`,
 * `entities`, one terminal `final` or `error` — with the kind's own events
 * (`<kind>.<event>`) checked by the kind, and a thread read back.
 */
import { record } from '../../api/checks.ts'
import { checkEntities, type EntitiesEvent } from '../../api/entities.ts'
import { ApiError, parseError, request } from '../../api/http.ts'
import type { AssistantThread } from '../../api/types.ts'
import type { Binding } from '../types.ts'

export interface StreamError { code: string; message: string; details?: Record<string, unknown> }

/** The events every assistant kind sends. */
export type SharedEvent =
  | { type: 'thread'; threadId: string }
  | { type: 'delta'; text: string }
  | EntitiesEvent
  | { type: 'final'; reply: string }
  | { type: 'error'; error: StreamError }

/** The tool activity of a kind that runs on the tool loop, its events prefixed with the kind (`agent`, `studio`). */
export type ToolEvent<P extends string = string> =
  | { type: `${P}.tool_call`; callId: string; tool: string; args: Record<string, unknown> }
  | { type: `${P}.tool_result`; callId: string; result: unknown }

/** An agent's turn: the shared events plus its tool activity. */
export type ChatEvent = SharedEvent | ToolEvent<'agent'>

/** How a kind reads its own events. */
export interface KindReader<K> {
  /** A kind event checked, or null for one this client does not know — ignored. Throws on a malformed one. */
  parse: (event: Record<string, unknown>) => K | null
  /** Throws when the turn may not end with `final` yet. */
  beforeFinal?: () => void
}

/** Read NDJSON events until `consume` reports a terminal one; EOF before that is an interrupted stream. */
export async function readNdjsonStream(
  response: Response,
  consume: (event: Record<string, unknown>) => boolean,
) {
  if (!response.ok) throw await parseError(response)
  if (!response.headers.get('content-type')?.includes('application/x-ndjson') || !response.body) {
    throw new Error('Invalid NDJSON response')
  }
  const reader = response.body.getReader()
  const decoder = new TextDecoder('utf-8', { fatal: true })
  let buffer = ''
  let terminal = false
  const consumeLine = (line: string) => {
    if (!line.trim()) return
    const e = JSON.parse(line)
    if (!e || typeof e !== 'object' || Array.isArray(e)) throw new Error('Invalid NDJSON event')
    if (consume(e)) terminal = true
  }
  try {
    while (!terminal) {
      const { value, done } = await reader.read()
      buffer += done ? decoder.decode() : decoder.decode(value, { stream: true })
      let end: number
      while (!terminal && (end = buffer.indexOf('\n')) !== -1) {
        consumeLine(buffer.slice(0, end))
        buffer = buffer.slice(end + 1)
      }
      if (buffer.length > 8 * 1024 * 1024) throw new Error('NDJSON event exceeded its size limit')
      if (done) {
        if (!terminal && buffer.trim()) consumeLine(buffer)
        if (!terminal) throw new Error('Connection closed before the answer was complete')
        break
      }
    }
  } finally {
    await reader.cancel().catch(() => {})
    reader.releaseLock()
  }
}

/**
 * One assistant turn: `thread` exactly once and first, `delta` text that the
 * `final` reply must match, `entities` whose links join cards of this
 * turn, one terminal `final` or `error`; every other event goes to the
 * kind's reader. Each checked event reaches `onEvent`.
 */
export async function readAssistantStream<K>(
  response: Response,
  kind: KindReader<K>,
  onEvent: (event: SharedEvent | K) => void,
  signal?: AbortSignal,
) {
  let thread = false
  let streamed = ''
  const refs = new Set<string>()
  await readNdjsonStream(response, (e) => {
    signal?.throwIfAborted()
    let terminal = false
    let event: SharedEvent | K | null
    if (!thread && e.type !== 'thread') throw new Error('The stream did not start with its thread')
    switch (e.type) {
      case 'thread':
        if (thread || typeof e.threadId !== 'string' || !e.threadId) throw new Error('Invalid thread event')
        thread = true
        event = e as SharedEvent
        break
      case 'delta':
        if (typeof e.text !== 'string') throw new Error('Invalid answer text')
        streamed += e.text
        event = e as SharedEvent
        break
      case 'entities':
        event = checkEntities(e, refs)
        break
      case 'final':
        if (typeof e.reply !== 'string' || (streamed && streamed !== e.reply)) throw new Error('Invalid final answer')
        kind.beforeFinal?.()
        terminal = true
        event = e as SharedEvent
        break
      case 'error':
        if (!record(e.error) || typeof e.error.code !== 'string' || typeof e.error.message !== 'string') {
          throw new Error('Invalid chat error')
        }
        terminal = true
        event = e as SharedEvent
        break
      default:
        event = kind.parse(e)
    }
    if (event !== null) onEvent(event)
    return terminal
  })
}

/** A tool loop's events (`<prefix>.tool_call`, `<prefix>.tool_result`): each call announced once, its one result after it, none open at `final`. */
export function toolCallReader<P extends string>(prefix: P): KindReader<ToolEvent<P>> {
  const calls = new Map<string, boolean>()
  return {
    parse(e) {
      switch (e.type) {
        case `${prefix}.tool_call`:
          if (typeof e.callId !== 'string' || !e.callId || calls.has(e.callId) ||
            typeof e.tool !== 'string' || !record(e.args)) {
            throw new Error('Invalid tool call')
          }
          calls.set(e.callId, false)
          return e as ToolEvent<P>
        case `${prefix}.tool_result`:
          if (typeof e.callId !== 'string' || !calls.has(e.callId) || calls.get(e.callId) ||
            !Object.hasOwn(e, 'result')) {
            throw new Error('Invalid tool result')
          }
          calls.set(e.callId, true)
          return e as ToolEvent<P>
        default:
          if (typeof e.type === 'string' && e.type.includes('.')) return null
          throw new Error('Unknown chat event')
      }
    },
    beforeFinal() {
      if ([...calls.values()].some((complete) => !complete)) throw new Error('Invalid final answer')
    },
  }
}

/** The agent's tool events. */
export const agentReader = () => toolCallReader('agent')

/** Consume one agent turn; EOF without a terminal event is an interrupted turn. */
export const readChatStream = (response: Response, onEvent: (event: ChatEvent) => void, signal?: AbortSignal) =>
  readAssistantStream(response, agentReader(), onEvent, signal)

/* ---------------------------------- routes --------------------------------- */

/**
 * A lens's `/ai/assistants/<kind>`, or one assistant of it. Bound to the
 * whole ontology there is one assistant, the Studio helper, with a route of
 * its own: `/model/ai`.
 */
export function assistantPath(at: Binding, kind: string, assistantKey?: string) {
  const ontology = `/api/ontologies/${encodeURIComponent(at.ontologyKey)}`
  if (at.lensKey === null) return `${ontology}/model/ai`
  const base = `${ontology}/runtime/lenses/${encodeURIComponent(at.lensKey)}/ai/assistants/${kind}`
  return assistantKey === undefined ? base : `${base}/${encodeURIComponent(assistantKey)}`
}

/** The body every kind's chat takes; a kind may add fields. */
export interface ChatRequest {
  message: string
  /** Continue this thread; without one the message starts a new thread. */
  threadId?: string
}

/** Send one message and read its turn. Refusals before the stream opens throw an `ApiError`. */
export async function postChat<K>(
  path: string,
  body: ChatRequest,
  kind: KindReader<K>,
  onEvent: (event: SharedEvent | K) => void,
  signal: AbortSignal,
) {
  const response = await fetch(`${path}/chat`, {
    method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body), signal,
  })
  await readAssistantStream(response, kind, onEvent, signal)
}

/** A thread's user messages and answers, as the server keeps them. */
export const readThread = (path: string, threadId: string, signal?: AbortSignal) =>
  request<AssistantThread>(`${path}/threads/${encodeURIComponent(threadId)}`, { signal })

/** The thread refusals a client reacts to: gone (unknown or expired) or still answering. */
export function threadError(error: unknown): 'THREAD_NOT_FOUND' | 'THREAD_BUSY' | null {
  if (!(error instanceof ApiError)) return null
  const code = error.details?.code
  return code === 'THREAD_NOT_FOUND' || code === 'THREAD_BUSY' ? code : null
}

/**
 * A failed request in words; a refused question adds the server's reasons
 * (`details.errors`) its message does not already carry.
 */
export function chatErrorText(error: unknown, fallback = 'The question failed.'): string {
  if (!(error instanceof Error)) return fallback
  const errors = error instanceof ApiError ? error.details?.errors : undefined
  if (!Array.isArray(errors) || !errors.every((item) => typeof item === 'string')) return error.message
  const missing = errors.filter((item) => !error.message.includes(item))
  return missing.length > 0 ? `${error.message} ${missing.join(' ')}` : error.message
}
