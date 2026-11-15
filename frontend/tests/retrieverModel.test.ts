import { test } from 'node:test'
import assert from 'node:assert/strict'
import {
  retrieverExecution, defaultAnswerFields, draftOf, draftProblems, editableConfig, emptyConfig, filterChoices, filterLabel,
  importProblem, isSupportedRetriever, newFilter, phaseName, plannedFilterText, relationName, resultTypes, sameDraft,
  toInput, withIndex, withRelations, withoutIndex, type RetrieverSchema,
} from '../src/components/assistants/retrievers/retrieverModel.ts'
import { chatRetriever, readRetrieverStream, retrieverPlan, saveRetriever, type Retriever, type RetrieverConfig } from '../src/api/retrievers.ts'
import type { SearchCatalogEntry } from '../src/api/types.ts'

const prop = (key: string, dataType = 'string') => ({ key, displayName: key[0].toUpperCase() + key.slice(1), dataType })
const schema: RetrieverSchema = {
  entityTypes: [
    { key: 'person', displayName: 'Person', nameProperty: 'name', properties: [prop('name'), prop('email'), prop('bio', 'document')] },
    { key: 'company', displayName: 'Company', nameProperty: 'title', properties: [prop('title'), prop('founded', 'integer')] },
    { key: 'city', displayName: 'City', nameProperty: 'name', properties: [prop('name')] },
    { key: 'country', displayName: 'Country', nameProperty: 'name', properties: [prop('name')] },
  ],
  relationTypes: [
    { key: 'works_for', displayName: 'works for', fromEntityTypeKey: 'person', toEntityTypeKey: 'company' },
    { key: 'located_in', displayName: 'located in', fromEntityTypeKey: 'company', toEntityTypeKey: 'city' },
    { key: 'part_of', displayName: 'part of', fromEntityTypeKey: 'city', toEntityTypeKey: 'country' },
  ],
}
const entry = (patch: Partial<SearchCatalogEntry>): SearchCatalogEntry => ({
  key: 'person~default', kind: 'default', name: 'Person', description: '', entityType: 'person', fields: ['name'],
  relations: [], documentProperty: null, modes: ['semantic', 'keyword'], status: 'ready', ...patch,
})
const catalog = [
  entry({}),
  entry({ key: 'person_employment', kind: 'custom', name: 'People by employment', relations: [{ relationType: 'works_for', direction: 'outgoing', label: 'Employment' }] }),
  entry({ key: 'company~default', name: 'Company', entityType: 'company' }),
]
const config: RetrieverConfig = { ...emptyConfig(), indices: [{ index: 'person~default' }], answerFields: { person: ['name'] } }
const agent = (patch: Partial<Retriever> = {}): Retriever => ({
  key: 'people', lensKey: 'main', name: 'People', description: null, configVersion: 2, config,
  validation: { valid: true, errors: [], warnings: [] }, createdAt: '', updatedAt: '', ...patch,
})

test('a new draft starts empty with the client defaults', () => {
  assert.deepEqual(emptyConfig(), { indices: [], filters: [], answerFields: {}, threshold: 0.35, answerFieldCharacters: 800 })
  assert.deepEqual(draftOf(null).config, emptyConfig())
  assert.deepEqual(draftOf(agent({ description: 'About people' })), { name: 'People', description: 'About people', config })
})

test('the shape guard keeps unavailable references but rejects malformed shapes and other versions', () => {
  assert.equal(editableConfig({ ...config, indices: [{ index: 'gone~default', relations: ['gone'] }] }), true)
  assert.equal(editableConfig({ ...config, indices: [{}] }), false)
  assert.equal(editableConfig({ ...config, filters: [{ id: 'x', entityType: 'person', field: 'name', path: [null] }] }), false)
  assert.equal(editableConfig({ ...config, answerFields: { person: 'name' } }), false)
  assert.equal(editableConfig({ buckets: [], threshold: 0.3 }), false)
  assert.equal(isSupportedRetriever(agent({ configVersion: 1 })), false)
  assert.equal(isSupportedRetriever(agent()), true)
})

test('only a saved, unchanged, valid version 2 agent runs — by its key', () => {
  assert.deepEqual(retrieverExecution(agent(), false), { mode: 'saved', key: 'people' })
  assert.match((retrieverExecution(null, false) as { reason: string }).reason, /Save this retriever to test it/)
  assert.match((retrieverExecution(agent(), true) as { reason: string }).reason, /Save them to test/)
  assert.equal(retrieverExecution(agent({ validation: { valid: false, errors: ['x'], warnings: [] } }), false).mode, 'blocked')
  assert.equal(retrieverExecution(agent({ configVersion: 1 }), false).mode, 'blocked')
})

test('dirty compares name, description and config; the write body never carries a key', () => {
  const draft = draftOf(agent())
  assert.equal(sameDraft(draft, structuredClone(draft)), true)
  assert.equal(sameDraft(draft, { ...draft, config: { ...draft.config, threshold: 0.5 } }), false)
  assert.deepEqual(toInput({ ...draft, name: ' People ', description: '  ' }), { name: 'People', description: null, configVersion: 2, config })
})

test('adding an index seeds answer fields of a new result type; removing its last index prunes them and their filters', () => {
  let next = withIndex(emptyConfig(), catalog[2], schema)
  assert.deepEqual(next.answerFields, { company: ['title'] })
  next = withIndex(next, catalog[0], schema)
  next = withIndex(next, catalog[1], schema)
  assert.deepEqual(resultTypes(next, catalog), ['company', 'person'])
  next = { ...next, filters: [{ id: 'city', entityType: 'company', path: [{ relationTypeKey: 'located_in', direction: 'outgoing' }], field: 'name' }] }
  next = withoutIndex(next, 'person~default', catalog)
  assert.deepEqual(next.answerFields.person, ['name'], 'person_employment still finds people')
  next = withoutIndex(next, 'company~default', catalog)
  assert.equal('company' in next.answerFields, false)
  assert.deepEqual(next.filters, [])
  assert.deepEqual(defaultAnswerFields(schema.entityTypes[1]), ['title'])
})

test('relation subsets: undefined = all groups, a list = only these', () => {
  const next = withRelations({ ...config, indices: [{ index: 'person_employment' }] }, 'person_employment', ['works_for'])
  assert.deepEqual(next.indices, [{ index: 'person_employment', relations: ['works_for'] }])
  assert.deepEqual(withRelations(next, 'person_employment', undefined).indices, [{ index: 'person_employment' }])
})

test('filter paths reach own fields and up to two relations in both directions', () => {
  const fromPerson = filterChoices(schema, 'person')
  assert.deepEqual(fromPerson.map((c) => c.path.length), [0, 1, 2])
  assert.equal(fromPerson.some((c) => c.target.key === 'country'), false, 'three hops are out of reach')
  const fromCity = filterChoices(schema, 'city')
  assert.ok(fromCity.some((c) => c.path[0]?.direction === 'incoming' && c.target.key === 'company'))
  const filter = newFilter(config, 'person', fromPerson[2])
  assert.deepEqual(filter, { id: 'city_name', entityType: 'person', path: fromPerson[2].path, field: 'name' })
  assert.equal(newFilter({ ...config, filters: [filter] }, 'person', fromPerson[2]).id, 'city_name_2')
  assert.equal(filterLabel(filter, schema), 'Person · works for → Company · located in → City · Name')
})

test('client problems name what blocks a save', () => {
  const messages = (c: RetrieverConfig) => draftProblems(c, catalog, schema).map((p) => `${p.path}: ${p.message}`)
  assert.deepEqual(messages(config), [])
  assert.deepEqual(messages(emptyConfig()), ['indices: Choose at least one search index.'])
  assert.match(messages({ ...config, indices: [{ index: 'gone' }] }).join('\n'), /indices\[0\]\.index: Index gone is not available/)
  assert.match(messages({ ...config, indices: [{ index: 'person_employment', relations: [] }] }).join('\n'), /at least one relation group/)
  assert.match(messages({ ...config, indices: [{ index: 'person~default', relations: ['works_for'] }] }).join('\n'), /has no relation group works_for/)
  assert.match(messages({ ...config, answerFields: { person: [] } }).join('\n'), /answerFields\.person: Choose at least one answer field for Person/)
  assert.deepEqual(messages({ ...config, answerFields: { person: ['name', 'bio'] } }), [], 'documents are allowed as answer fields (truncated)')
  assert.match(messages({ ...config, answerFields: { person: ['gone'] } }).join('\n'), /gone of Person is not visible/)
  assert.match(messages({ ...config, answerFields: { ...config.answerFields, company: ['title'] } }).join('\n'), /which no chosen index finds/)
  assert.match(messages({ ...config, threshold: 2, answerFieldCharacters: 50 }).join('\n'), /threshold[\s\S]*answerFieldCharacters/)
  const twice = { id: 'x', entityType: 'person', path: [], field: 'name' }
  assert.match(messages({ ...config, filters: [twice, twice] }).join('\n'), /used twice/)
  assert.match(messages({ ...config, filters: [{ ...twice, entityType: 'company' }] }).join('\n'), /not a result type/)
  assert.match(messages({ ...config, filters: [{ ...twice, field: 'gone' }] }).join('\n'), /choose a field/)
  assert.deepEqual(messages({ ...config, filters: [{ ...twice, field: 'bio' }] }), [], 'a visible document field stays valid; it is only not offered')
})

test('imports need a version 2 export whose key is free', () => {
  const body = { key: 'people', name: 'People', description: null, configVersion: 2, config }
  assert.equal(importProblem(body, []), null)
  assert.match(importProblem(body, ['people']) ?? '', /already exists/)
  assert.match(importProblem({ ...body, configVersion: 1 }, []) ?? '', /version 2/)
})

test('a plan: planned filters read from their carried definition, relation groups by their label', () => {
  // The label comes from the definition the planned filter carries, not from a configuration.
  assert.equal(plannedFilterText({ id: 'own', entityType: 'person', path: [], field: 'email', value: 'a@b.c', quote: 'a@b.c' }, schema), 'Person · Email = a@b.c (from “a@b.c”)')
  const hop = { relationTypeKey: 'works_for', direction: 'outgoing' as const }
  assert.equal(plannedFilterText({ id: 'employer', entityType: 'person', path: [hop], field: 'title', value: 'ACME', quote: 'at ACME' }, schema), 'Person · works for → Company · Title = ACME (from “at ACME”)')
  assert.equal(plannedFilterText({ id: 'gone', entityType: 'unknown', path: [], field: 'x', value: 'x', quote: '' }, schema), 'gone = x')
  assert.equal(relationName('works_for', ['person_employment'], catalog, schema), 'Employment')
  assert.equal(relationName('works_for', ['person~default'], catalog, schema), 'works for')
})

function stream(events: unknown[]) {
  return new Response(events.map((event) => JSON.stringify(event)).join('\n'), { headers: { 'content-type': 'application/x-ndjson' } })
}

const T = { type: 'thread', threadId: 't1' }

const PLAN = {
  subQueries: [{ indices: ['person~default'], relations: [], query: 'Bob role at ACME', variants: [], mode: 'keyword', filters: [{ id: 'own', value: 'x', quote: 'x', entityType: 'person', path: [], field: 'email' }], previous: null }],
  unsupportedReason: null,
}

test('the stream reader reads the retriever\'s phases and its steps in diagnostics, a planning step with its plan', async () => {
  const events = [
    T,
    { type: 'retriever.phase', phase: 'plan', status: 'start' },
    { type: 'diagnostics', steps: [{ index: 1, name: 'plan', model: true, startMs: 1, durationMs: 900, usage: { input: 1, output: 2 }, plan: PLAN }] },
    { type: 'retriever.phase', phase: 'plan', status: 'end' },
    { type: 'retriever.phase', phase: 'retrieve', status: 'start' },
    { type: 'diagnostics', steps: [{ index: 2, name: 'retrieve', startMs: 902, durationMs: 40 }] },
    { type: 'retriever.phase', phase: 'retrieve', status: 'end' },
    { type: 'diagnostics', durationMs: 960 },
    { type: 'final', reply: 'Ada' },
  ]
  const received: unknown[] = []
  await readRetrieverStream(stream(events), (event) => received.push(event), new AbortController().signal)
  assert.deepEqual(received, events)
  await assert.rejects(readRetrieverStream(stream([T, { type: 'retriever.phase', phase: 'plan', status: 'paused' }]), () => {}, new AbortController().signal), /Invalid event/)
  await assert.rejects(readRetrieverStream(stream([T, { type: 'delta', text: 'Partial' }]), () => {}, new AbortController().signal), /Connection closed/)
  // The final answer must be the streamed text.
  await assert.rejects(readRetrieverStream(stream([T, { type: 'delta', text: 'Ada' }, { type: 'final', reply: 'Bob' }]), () => {}, new AbortController().signal), /Invalid final/)
})

test('kind events the retriever does not know are ignored; the old unprefixed ones fail the turn', async () => {
  const received: { type: string }[] = []
  await readRetrieverStream(stream([T, { type: 'retriever.future', x: 1 }, { type: 'agent.tool_call' }, { type: 'final', reply: 'Hi' }]),
    (event) => received.push(event), new AbortController().signal)
  assert.deepEqual(received.map((e) => e.type), ['thread', 'final'])
  await assert.rejects(readRetrieverStream(stream([T, { type: 'meta' }]), () => {}, new AbortController().signal), /Invalid event/)
})

test('cancelled streams stop before buffered events complete a stale turn', async () => {
  const controller = new AbortController()
  const received: unknown[] = []
  await assert.rejects(readRetrieverStream(stream([
    T, { type: 'retriever.phase', phase: 'plan', status: 'start' }, { type: 'delta', text: 'Stale' }, { type: 'final', reply: 'Stale' },
  ]), (event) => { received.push(event); controller.abort() }, controller.signal), { name: 'AbortError' })
  assert.equal(received.length, 1)
})

test('chat and save use the assistant routes and never send browser configuration or an export key', async () => {
  const original = globalThis.fetch
  const requests: { path: string; method?: string; body: unknown }[] = []
  globalThis.fetch = async (input, init) => {
    requests.push({ path: String(input), method: init?.method, body: init?.body ? JSON.parse(String(init.body)) : null })
    return String(input).endsWith('/chat') ? stream([T, { type: 'final', reply: 'Answer' }])
      : new Response(JSON.stringify(agent()), { headers: { 'content-type': 'application/json' } })
  }
  try {
    await chatRetriever('example', 'main', 'people', { message: 'Who?', threadId: 't1', diagnostics: true }, () => {}, new AbortController().signal)
    const reviewed = { key: 'people', ...toInput(draftOf(agent())) }
    await saveRetriever('example', 'main', reviewed.key, reviewed)
    assert.equal(requests[0].path, '/api/ontologies/example/runtime/lenses/main/ai/assistants/retrievers/people/chat')
    assert.deepEqual(requests[0].body, { message: 'Who?', threadId: 't1', diagnostics: true })
    assert.equal(requests[1].path, '/api/ontologies/example/model/lenses/main/assistants/retrievers/people')
    assert.equal(requests[1].method, 'PUT')
    assert.deepEqual(requests[1].body, { name: 'People', description: null, configVersion: 2, config })
  } finally { globalThis.fetch = original }
})

test('a step\'s plan reads as a retriever plan only in its shape; the steps have readable names', () => {
  assert.equal(retrieverPlan(PLAN), PLAN)
  assert.deepEqual(retrieverPlan({ subQueries: [], unsupportedReason: 'already answered' }), { subQueries: [], unsupportedReason: 'already answered' })
  for (const bad of [
    null, 'plan', {}, { subQueries: {} },
    { subQueries: [{ ...PLAN.subQueries[0], indices: 'person~default' }] },
    { subQueries: [{ ...PLAN.subQueries[0], variants: undefined }] },
    { subQueries: [{ ...PLAN.subQueries[0], filters: [{ id: 'own' }] }] },
    { subQueries: [], unsupportedReason: 3 },
  ]) assert.equal(retrieverPlan(bad), null, JSON.stringify(bad))
  assert.deepEqual(['plan', 'replan', 'retrieve', 'answer', 'other'].map(phaseName), ['Plan question', 'Plan question again', 'Search indices', 'Write answer', 'other'])
})
