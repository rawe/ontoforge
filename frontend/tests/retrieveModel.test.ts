import { test } from 'node:test'
import assert from 'node:assert/strict'
import {
  DEFAULT_RETRIEVER, isStale, questionToSend, resolveRetriever, resultEntities,
} from '../src/components/retrieverAgent/retrieveModel.ts'
import { retrieveWithAgent, type RetrieveResponse } from '../src/api/retrieverAgents.ts'

test('the remembered retriever falls back to Default when the runtime list does not have it', () => {
  const choices = [{ key: DEFAULT_RETRIEVER }, { key: 'alpha' }]
  assert.equal(resolveRetriever('alpha', choices), 'alpha')
  assert.equal(resolveRetriever('gone', choices), DEFAULT_RETRIEVER)
  assert.equal(resolveRetriever(null, choices), DEFAULT_RETRIEVER)
  assert.equal(resolveRetriever('alpha', undefined), DEFAULT_RETRIEVER)
})

test('Enter sends a new question once; an unchanged one is not resent unless it failed', () => {
  assert.equal(questionToSend('  Who?  ', null), 'Who?')
  assert.equal(questionToSend('   ', null), null)
  assert.equal(questionToSend('x'.repeat(2001), null), null)
  assert.equal(questionToSend('x'.repeat(2000), null)?.length, 2000)
  assert.equal(questionToSend('Who?', { question: 'Who?', status: 'running' }), null)
  assert.equal(questionToSend('Who?', { question: 'Who?', status: 'done' }), null)
  assert.equal(questionToSend('Who?', { question: 'Who?', status: 'failed' }), 'Who?')
  assert.equal(questionToSend('Who else?', { question: 'Who?', status: 'done' }), 'Who else?')
})

test('results are stale once the question differs from the answered one', () => {
  assert.equal(isStale('Who?', null), false)
  assert.equal(isStale(' Who? ', 'Who?'), false)
  assert.equal(isStale('Who else?', 'Who?'), true)
})

const response: RetrieveResponse = {
  results: [
    { entityId: 'p1', entityType: 'problem', label: 'SSO login fails', conditions: [{ filter: 'customer', value: 'Acme', text: 'reported by Customer Name: Acme' }], matched: null },
  ],
  limitations: [],
}

test('the results go to the Explorer as their entities', () => {
  assert.deepEqual(resultEntities(response), [{ typeKey: 'problem', id: 'p1' }])
})

test('retrieve posts the query to the retriever route and never a configuration', async () => {
  const calls: { url: string; init: RequestInit }[] = []
  const original = globalThis.fetch
  globalThis.fetch = (async (url: string, init: RequestInit) => {
    calls.push({ url, init })
    return new Response(JSON.stringify({ results: [], limitations: [] }), { status: 200, headers: { 'Content-Type': 'application/json' } })
  }) as typeof fetch
  try {
    const result = await retrieveWithAgent('o 1', 'all', '_default', { query: 'Who?' })
    assert.deepEqual(result, { results: [], limitations: [] })
    assert.equal(calls[0]!.url, '/api/ontologies/o%201/runtime/lenses/all/ai/assistants/retrievers/_default/retrieve')
    assert.equal(calls[0]!.init.method, 'POST')
    assert.deepEqual(JSON.parse(String(calls[0]!.init.body)), { query: 'Who?' })
  } finally {
    globalThis.fetch = original
  }
})
