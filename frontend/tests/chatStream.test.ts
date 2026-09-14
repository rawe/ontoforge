import { test } from 'node:test'
import assert from 'node:assert/strict'
import { readChatStream } from '../src/api/chatStream.ts'

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

test('consumer receives several events in a single chunk', async () => {
  const received: unknown[] = []
  await readChatStream(response([new TextEncoder().encode('{"type":"final","reply":"Hi"}\n')]), (e) => received.push(e))
  assert.deepEqual(received, [{ type: 'final', reply: 'Hi' }])
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
