import { test } from 'node:test'
import assert from 'node:assert/strict'
import {
  buildSchemaUrl,
  parseSchemaUrl,
  type SchemaUrlState,
} from '../src/components/studio/schema/schemaUrl.ts'

const OK = 'org_graph'

/** Builds the address of a state, then parses it back. */
function roundTrip(state: SchemaUrlState): SchemaUrlState {
  const url = new URL(buildSchemaUrl(OK, state.view, state.sel, state.prop), 'http://x')
  return parseSchemaUrl(url.pathname, url.search)
}

test('graph addresses round-trip with and without sel and prop', () => {
  const states: SchemaUrlState[] = [
    { view: 'graph', sel: null, prop: null },
    { view: 'graph', sel: { kind: 'entity-types', key: 'person' }, prop: null },
    { view: 'graph', sel: { kind: 'entity-types', key: 'person' }, prop: 'email' },
    { view: 'graph', sel: { kind: 'relation-types', key: 'works_on' }, prop: 'since' },
  ]
  for (const state of states) assert.deepEqual(roundTrip(state), state)
})

test('classic addresses round-trip for the list and both type pages', () => {
  const states: SchemaUrlState[] = [
    { view: 'classic', sel: null, prop: null },
    { view: 'classic', sel: { kind: 'entity-types', key: 'person' }, prop: null },
    { view: 'classic', sel: { kind: 'entity-types', key: 'person' }, prop: 'email' },
    { view: 'classic', sel: { kind: 'relation-types', key: 'member_of' }, prop: null },
  ]
  for (const state of states) assert.deepEqual(roundTrip(state), state)
})

test('build writes readable addresses and keeps the ontology prefix', () => {
  const person = { kind: 'entity-types', key: 'person' } as const
  assert.equal(buildSchemaUrl(OK, 'graph', null), '/o/org_graph/studio/schema/graph')
  assert.equal(
    buildSchemaUrl(OK, 'graph', person, 'email'),
    '/o/org_graph/studio/schema/graph?sel=entity:person&prop=email',
  )
  assert.equal(buildSchemaUrl(OK, 'classic', null), '/o/org_graph/studio/schema/types')
  assert.equal(
    buildSchemaUrl(OK, 'classic', { kind: 'relation-types', key: 'works_on' }, 'since'),
    '/o/org_graph/studio/schema/types/relation/works_on?prop=since',
  )
})

test('prop without sel is dropped', () => {
  assert.equal(buildSchemaUrl(OK, 'graph', null, 'email'), '/o/org_graph/studio/schema/graph')
  assert.equal(buildSchemaUrl(OK, 'classic', null, 'email'), '/o/org_graph/studio/schema/types')
  assert.deepEqual(parseSchemaUrl('/o/org_graph/studio/schema/graph', '?prop=email'), {
    view: 'graph',
    sel: null,
    prop: null,
  })
  assert.deepEqual(parseSchemaUrl('/o/org_graph/studio/schema/types', '?prop=email'), {
    view: 'classic',
    sel: null,
    prop: null,
  })
})

test('an unknown kind segment gives no selection', () => {
  assert.equal(parseSchemaUrl('/o/org_graph/studio/schema/types/thing/person', '').sel, null)
  assert.equal(parseSchemaUrl('/o/org_graph/studio/schema/graph', '?sel=thing:person').sel, null)
  assert.equal(parseSchemaUrl('/o/org_graph/studio/schema/graph', '?sel=person').sel, null)
  assert.equal(parseSchemaUrl('/o/org_graph/studio/schema/graph', '?sel=entity:').sel, null)
})

test('the view is detected from the path', () => {
  assert.equal(parseSchemaUrl('/o/org_graph/studio/schema/graph', '').view, 'graph')
  assert.equal(parseSchemaUrl('/o/org_graph/studio/schema/types', '').view, 'classic')
  assert.equal(parseSchemaUrl('/o/org_graph/studio/schema/types/entity/person', '').view, 'classic')
  // A classic path ignores a stray `sel` parameter.
  assert.equal(parseSchemaUrl('/o/org_graph/studio/schema/types', '?sel=entity:person').sel, null)
})

test('an ontology key that reads like a path segment does not confuse parsing', () => {
  assert.deepEqual(parseSchemaUrl('/o/types/studio/schema/graph', '?sel=entity:person'), {
    view: 'graph',
    sel: { kind: 'entity-types', key: 'person' },
    prop: null,
  })
})
