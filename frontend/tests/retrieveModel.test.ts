import { test } from 'node:test'
import assert from 'node:assert/strict'
import {
  DEFAULT_RETRIEVER, isStale, questionToSend, resolveRetriever, resultEntities, retrieveMeta, retrieverChoices,
} from '../src/components/retrieverAgent/retrieveModel.ts'
import { retrieveWithAgent, type RetrieveResponse } from '../src/api/retrieverAgents.ts'

const config = { indices: [{ index: 'person~default' }], filters: [], answerFields: { person: ['name'] }, threshold: 0.35, answerFieldCharacters: 800 }
const agent = (key: string, name: string, valid = true) => ({
  key, name, configVersion: 2, config, validation: { valid, errors: valid ? [] : ['broken'], warnings: [] },
})

test('the picker lists Default first, then stored agents by name; invalid ones are not selectable', () => {
  const choices = retrieverChoices([agent('zeta', 'Zeta'), agent('broken', 'Broken', false), agent('alpha', 'Alpha')])
  assert.deepEqual(choices.map((c) => [c.key, c.name, c.selectable]), [
    [DEFAULT_RETRIEVER, 'Default', true], ['alpha', 'Alpha', true], ['broken', 'Broken', false], ['zeta', 'Zeta', true],
  ])
  assert.deepEqual(retrieverChoices(undefined).map((c) => c.key), ['_default'])
  // An unsupported (other version) configuration is not selectable either.
  assert.equal(retrieverChoices([{ ...agent('old', 'Old'), configVersion: 1 }])[1]!.selectable, false)
})

test('the remembered retriever falls back to Default when it is gone or invalid', () => {
  const choices = retrieverChoices([agent('alpha', 'Alpha'), agent('broken', 'Broken', false)])
  assert.equal(resolveRetriever('alpha', choices), 'alpha')
  assert.equal(resolveRetriever('broken', choices), DEFAULT_RETRIEVER)
  assert.equal(resolveRetriever('gone', choices), DEFAULT_RETRIEVER)
  assert.equal(resolveRetriever(null, choices), DEFAULT_RETRIEVER)
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
  limitations: ['Search indices not fully built (Problems); results may be incomplete.'],
  unsupportedReason: 'No salaries.',
  diagnostics: { plan: { subQueries: [] }, searchCalls: 2, timings: { plan: 10, retrieve: 5, total: 16 }, modelIO: [{ phase: 'plan', input: 'i', output: 'o' }] },
}

test('a retrieve reports its diagnostics in the chat shape: one model call, the reason with the limitations', () => {
  assert.deepEqual(retrieveMeta(response), {
    plan: { subQueries: [] }, searchCalls: 2, timings: { plan: 10, retrieve: 5, total: 16 },
    modelIO: [{ phase: 'plan', input: 'i', output: 'o' }], llmCalls: 1,
    limitations: ['No salaries.', 'Search indices not fully built (Problems); results may be incomplete.'],
  })
  assert.deepEqual(resultEntities(response), [{ typeKey: 'problem', id: 'p1' }])
})

test('retrieve posts the question to the agent route and never a configuration', async () => {
  const calls: { url: string; init: RequestInit }[] = []
  const original = globalThis.fetch
  globalThis.fetch = (async (url: string, init: RequestInit) => {
    calls.push({ url, init })
    return new Response(JSON.stringify({ results: [], limitations: [] }), { status: 200, headers: { 'Content-Type': 'application/json' } })
  }) as typeof fetch
  try {
    const result = await retrieveWithAgent('o 1', 'all', '_default', { question: 'Who?', diagnostics: true })
    assert.deepEqual(result, { results: [], limitations: [] })
    assert.equal(calls[0]!.url, '/api/ontologies/o%201/runtime/lenses/all/retriever-agents/_default/retrieve')
    assert.equal(calls[0]!.init.method, 'POST')
    assert.deepEqual(JSON.parse(String(calls[0]!.init.body)), { question: 'Who?', diagnostics: true })
  } finally {
    globalThis.fetch = original
  }
})
