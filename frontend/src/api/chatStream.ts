import { parseError } from './http.ts'
import type { ChatMessage } from './types.ts'

export type ChatEvent =
  | { type: 'tool_call'; callId: string; tool: string; args: Record<string, unknown> }
  | { type: 'tool_result'; callId: string; result: unknown }
  | { type: 'final'; reply: string }
  | { type: 'error'; error: { code: string; message: string; details?: Record<string, unknown> } }

/** Read NDJSON events until `consume` reports a terminal one; EOF before that is an interrupted stream. */
export async function readNdjsonStream(
  response: Response,
  consume: (event: Record<string, unknown>) => boolean,
) {
  if (!response.ok) throw await parseError(response)
  if (!response.headers.get('content-type')?.includes('application/x-ndjson') || !response.body) {
    throw new Error('Invalid chat response')
  }
  const reader = response.body.getReader()
  const decoder = new TextDecoder('utf-8', { fatal: true })
  let buffer = ''
  let terminal = false
  const consumeLine = (line: string) => {
    if (!line.trim()) return
    const e = JSON.parse(line)
    if (!e || typeof e !== 'object') throw new Error('Invalid chat event')
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
      if (buffer.length > 8 * 1024 * 1024) throw new Error('Chat event exceeded its size limit')
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

/** Consume complete chat events; EOF without a terminal event is an interrupted turn. */
export async function readChatStream(response: Response, onEvent: (event: ChatEvent) => void) {
  const calls = new Map<string, boolean>()
  await readNdjsonStream(response, (e) => {
    let terminal = false
    switch (e.type) {
      case 'tool_call':
        if (typeof e.callId !== 'string' || !e.callId || calls.has(e.callId) ||
          typeof e.tool !== 'string' || !e.args || typeof e.args !== 'object' || Array.isArray(e.args)) {
          throw new Error('Invalid tool call')
        }
        calls.set(e.callId, false)
        break
      case 'tool_result':
        if (typeof e.callId !== 'string' || !calls.has(e.callId) || calls.get(e.callId) ||
          !Object.hasOwn(e, 'result')) {
          throw new Error('Invalid tool result')
        }
        calls.set(e.callId, true)
        break
      case 'final':
        if (typeof e.reply !== 'string' || [...calls.values()].some((complete) => !complete)) {
          throw new Error('Invalid final answer')
        }
        terminal = true
        break
      case 'error': {
        const error = e.error as { code?: unknown; message?: unknown } | undefined
        if (typeof error?.code !== 'string' || typeof error?.message !== 'string') {
          throw new Error('Invalid chat error')
        }
        terminal = true
        break
      }
      default: throw new Error('Unknown chat event')
    }
    onEvent(e as ChatEvent)
    return terminal
  })
}

export async function requestChat(
  path: string,
  body: { message: string; history?: ChatMessage[] },
  onEvent: (event: ChatEvent) => void,
  signal: AbortSignal,
) {
  const response = await fetch(path, {
    method: 'POST', headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(body), signal,
  })
  await readChatStream(response, (event) => {
    signal.throwIfAborted()
    onEvent(event)
  })
}
