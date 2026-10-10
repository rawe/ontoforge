import { test } from 'node:test'
import assert from 'node:assert/strict'
import {
  agentReader, assistantPath, chatErrorText, postChat, readChatStream, readNdjsonStream, readThread, threadError,
} from '../src/api/chatStream.ts'
import { ApiError } from '../src/api/http.ts'

function response(chunks: Uint8Array[]) {
  return new Response(new ReadableStream({ start(controller) {
    for (const chunk of chunks) controller.enqueue(chunk)
    controller.close()
  } }), { headers: { 'content-type': 'application/x-ndjson' } })
}

test('consumer sees complete events across fragmented UTF-8 and an unterminated final line', async () => {
  const expected = [
    { type: 'thread', threadId: 't1' },
    { type: 'agent.tool_call', callId: '1', tool: 'search', args: { query: 'Zoë 🐈' } },
    { type: 'agent.tool_result', callId: '1', result: [null, { name: 'Zoë' }] },
    { type: 'final', reply: 'Found her' },
  ]
  const bytes = new TextEncoder().encode(expected.map((e) => JSON.stringify(e)).join('\n'))
  const received: unknown[] = []
  await readChatStream(response(Array.from(bytes, (byte) => Uint8Array.of(byte))), (e) => received.push(e))
  assert.deepEqual(received, expected)
})

test('consumer receives several events in a single chunk, preserving string results', async () => {
  const expected = [
    { type: 'thread', threadId: 't1' },
    { type: 'agent.tool_call', callId: '1', tool: 'get_schema', args: {} },
    { type: 'agent.tool_result', callId: '1', result: 'null' },
    { type: 'final', reply: 'Hi' },
  ]
  const received: unknown[] = []
  await readChatStream(response([new TextEncoder().encode(expected.map((e) => JSON.stringify(e)).join('\n') + '\n')]), (e) => received.push(e))
  assert.deepEqual(received, expected)
})

const THREAD = '{"type":"thread","threadId":"t1"}\n'

for (const [name, body] of [
  ['EOF without final', THREAD + '{"type":"agent.tool_call","callId":"1","tool":"search","args":{}}\n'],
  ['malformed JSON', THREAD + 'bad\n'],
  ['invalid event', THREAD + '{"type":"final","reply":42}\n'],
  ['orphan result', THREAD + '{"type":"agent.tool_result","callId":"missing","result":null}\n'],
  ['final with a call still open', THREAD + '{"type":"agent.tool_call","callId":"1","tool":"search","args":{}}\n{"type":"final","reply":"x"}\n'],
  ['no thread first', '{"type":"final","reply":"x"}\n'],
  ['a second thread', THREAD + THREAD + '{"type":"final","reply":"x"}\n'],
  ['an unknown shared event', THREAD + '{"type":"tool_call","callId":"1","tool":"search","args":{}}\n'],
]) {
  test(name, async () => {
    await assert.rejects(readChatStream(response([new TextEncoder().encode(body)]), () => {}))
  })
}

test('error preserves previously delivered results and terminates the consumer', async () => {
  const expected = [
    { type: 'thread', threadId: 't1' },
    { type: 'agent.tool_call', callId: '1', tool: 'search', args: {} },
    { type: 'agent.tool_result', callId: '1', result: null },
    { type: 'error', error: { code: 'STORAGE_ERROR', message: 'Storage failed' } },
  ]
  const received: unknown[] = []
  await readChatStream(response([new TextEncoder().encode(expected.map((e) => JSON.stringify(e)).join('\n'))]), (e) => received.push(e))
  assert.deepEqual(received, expected)
})

test('generic reader delivers arbitrary events and lets its consumer choose the terminal event', async () => {
  const expected = [
    { type: 'progress', label: 'Zoë 🐈', percent: 50 },
    { type: 'complete', result: { count: 2 } },
  ]
  // The terminal event has no newline; UTF-8 code points and JSON span chunks.
  const bytes = new TextEncoder().encode('\n' + expected.map((event) => JSON.stringify(event)).join('\n'))
  const received: unknown[] = []
  await readNdjsonStream(response(Array.from(bytes, (byte) => Uint8Array.of(byte))), (event) => {
    received.push(event)
    return event.type === 'complete'
  })
  assert.deepEqual(received, expected)
})

test('generic reader cancels and unlocks the body as soon as its consumer terminates', async () => {
  let cancelled = false
  const body = new ReadableStream<Uint8Array>({
    start(controller) {
      controller.enqueue(new TextEncoder().encode('{"type":"complete"}\nnot JSON\n'))
      // Keep the connection open: completion must not depend on server EOF.
    },
    cancel() { cancelled = true },
  })
  const received: unknown[] = []
  await readNdjsonStream(new Response(body, { headers: { 'content-type': 'application/x-ndjson' } }), (event) => {
    received.push(event)
    return true
  })
  assert.deepEqual(received, [{ type: 'complete' }])
  assert.equal(cancelled, true)
  assert.equal(body.locked, false)
})

test('generic reader cancels and unlocks the body when the consumer throws', async () => {
  let cancelled = false
  const body = new ReadableStream<Uint8Array>({
    start(controller) { controller.enqueue(new TextEncoder().encode('{"type":"progress"}\n')) },
    cancel() { cancelled = true },
  })
  const failure = new Error('Consumer failed')
  await assert.rejects(readNdjsonStream(
    new Response(body, { headers: { 'content-type': 'application/x-ndjson' } }),
    () => { throw failure },
  ), (error) => error === failure)
  assert.equal(cancelled, true)
  assert.equal(body.locked, false)
})

test('generic reader reports EOF when its consumer has not accepted a terminal event', async () => {
  const received: unknown[] = []
  await assert.rejects(readNdjsonStream(response([new TextEncoder().encode('{"type":"progress"}')]), (event) => {
    received.push(event)
    return false
  }), /Connection closed before the answer was complete/)
  assert.deepEqual(received, [{ type: 'progress' }])
})

for (const body of ['null', '42', '"progress"', '[]']) {
  test(`generic reader rejects a non-object event: ${body}`, async () => {
    let delivered = false
    await assert.rejects(readNdjsonStream(response([new TextEncoder().encode(body + '\n')]), () => {
      delivered = true
      return true
    }), /Invalid .* event/)
    assert.equal(delivered, false)
  })
}

test('generic reader rejects invalid UTF-8 rather than replacing corrupted event text', async () => {
  await assert.rejects(readNdjsonStream(response([Uint8Array.of(0xff)]), () => true), TypeError)
})

test('kind events the agent does not know are ignored; delta text must match the final reply', async () => {
  const body = THREAD + '{"type":"retriever.phase","phase":"plan","status":"start"}\n{"type":"agent.future"}\n{"type":"delta","text":"H"}\n{"type":"delta","text":"i"}\n{"type":"final","reply":"Hi"}\n'
  const received: { type: string }[] = []
  await readChatStream(response([new TextEncoder().encode(body)]), (e) => received.push(e))
  assert.deepEqual(received.map((e) => e.type), ['thread', 'delta', 'delta', 'final'])
  await assert.rejects(readChatStream(response([new TextEncoder().encode(THREAD + '{"type":"delta","text":"H"}\n{"type":"final","reply":"Ho"}\n')]), () => {}), /Invalid final/)
})

test('a chat posts {message, threadId} to the assistant route; a thread reads back from its own route', async () => {
  const original = globalThis.fetch
  const calls: { url: string; init?: RequestInit }[] = []
  globalThis.fetch = (async (url: string, init?: RequestInit) => {
    calls.push({ url, init })
    return url.endsWith('/chat')
      ? response([new TextEncoder().encode(THREAD + '{"type":"final","reply":"Hi"}\n')])
      : new Response(JSON.stringify({ threadId: 't1', messages: [{ role: 'user', content: 'Hello' }] }), { headers: { 'content-type': 'application/json' } })
  }) as typeof fetch
  try {
    const path = assistantPath('o 1', 'main', 'agents', '_default')
    assert.equal(path, '/api/ontologies/o%201/runtime/lenses/main/ai/assistants/agents/_default')
    assert.equal(assistantPath('o', 'main', 'retrievers'), '/api/ontologies/o/runtime/lenses/main/ai/assistants/retrievers')
    await postChat(path, { message: 'Hello', threadId: 't1' }, agentReader(), () => {}, new AbortController().signal)
    assert.equal(calls[0]!.url, `${path}/chat`)
    assert.deepEqual(JSON.parse(String(calls[0]!.init!.body)), { message: 'Hello', threadId: 't1' })
    const thread = await readThread(path, 't1')
    assert.equal(calls[1]!.url, `${path}/threads/t1`)
    assert.deepEqual(thread.messages, [{ role: 'user', content: 'Hello' }])
  } finally {
    globalThis.fetch = original
  }
})

test('thread refusals and refused questions read from the error details', () => {
  assert.equal(threadError(new ApiError(404, 'RESOURCE_NOT_FOUND', 'gone', { code: 'THREAD_NOT_FOUND' })), 'THREAD_NOT_FOUND')
  assert.equal(threadError(new ApiError(409, 'RESOURCE_CONFLICT', 'busy', { code: 'THREAD_BUSY' })), 'THREAD_BUSY')
  assert.equal(threadError(new ApiError(404, 'RESOURCE_NOT_FOUND', 'no agent')), null)
  assert.equal(threadError(new Error('x')), null)
  assert.equal(chatErrorText(new ApiError(400, 'VALIDATION_ERROR', 'Agent cannot run.', { errors: ['Index x is gone.'] })), 'Agent cannot run. Index x is gone.')
  assert.equal(chatErrorText(new ApiError(400, 'VALIDATION_ERROR',
    "Retriever agent 'r' is invalid in this lens: Index x is gone.", { errors: ['Index x is gone.'] })),
  "Retriever agent 'r' is invalid in this lens: Index x is gone.")
  assert.equal(chatErrorText(new ApiError(400, 'VALIDATION_ERROR', 'Agent cannot run: A.', { errors: ['A.', 'B.'] })),
    'Agent cannot run: A. B.')
  assert.equal(chatErrorText(new Error('Plain')), 'Plain')
  assert.equal(chatErrorText('nope', 'Fallback'), 'Fallback')
})
