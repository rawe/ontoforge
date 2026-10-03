import { test } from 'node:test'
import assert from 'node:assert/strict'
import { readChatStream, readNdjsonStream } from '../src/api/chatStream.ts'

function response(chunks: Uint8Array[]) {
  return new Response(new ReadableStream({ start(controller) {
    for (const chunk of chunks) controller.enqueue(chunk)
    controller.close()
  } }), { headers: { 'content-type': 'application/x-ndjson' } })
}

test('consumer sees complete events across fragmented UTF-8 and an unterminated final line', async () => {
  const expected = [
    { type: 'tool_call', callId: '1', tool: 'search', args: { query: 'Zoë 🐈' } },
    { type: 'tool_result', callId: '1', result: [null, { name: 'Zoë' }] },
    { type: 'final', reply: 'Found her' },
  ]
  const bytes = new TextEncoder().encode(expected.map((e) => JSON.stringify(e)).join('\n'))
  const received: unknown[] = []
  await readChatStream(response(Array.from(bytes, (byte) => Uint8Array.of(byte))), (e) => received.push(e))
  assert.deepEqual(received, expected)
})

test('consumer receives several events in a single chunk, preserving string results', async () => {
  const expected = [
    { type: 'tool_call', callId: '1', tool: 'get_schema', args: {} },
    { type: 'tool_result', callId: '1', result: 'null' },
    { type: 'final', reply: 'Hi' },
  ]
  const received: unknown[] = []
  await readChatStream(response([new TextEncoder().encode(expected.map((e) => JSON.stringify(e)).join('\n') + '\n')]), (e) => received.push(e))
  assert.deepEqual(received, expected)
})

for (const [name, body] of [
  ['EOF without final', '{"type":"tool_call","callId":"1","tool":"search","args":{}}\n'],
  ['malformed JSON', 'bad\n'],
  ['invalid event', '{"type":"final","reply":42}\n'],
  ['orphan result', '{"type":"tool_result","callId":"missing","result":null}\n'],
]) {
  test(name, async () => {
    await assert.rejects(readChatStream(response([new TextEncoder().encode(body)]), () => {}))
  })
}

test('error preserves previously delivered results and terminates the consumer', async () => {
  const expected = [
    { type: 'tool_call', callId: '1', tool: 'search', args: {} },
    { type: 'tool_result', callId: '1', result: null },
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
