import { test } from 'node:test'
import assert from 'node:assert/strict'
import { entityMatchText, matchedViaText, type MatchedViaSchema } from '../src/lib/matchedVia.ts'
import type { EntityMatch, Matched, SearchCatalogEntry } from '../src/api/types.ts'

const schema: MatchedViaSchema = {
  entityTypes: [
    { key: 'person', properties: [{ key: 'name', displayName: 'Name' }, { key: 'bio', displayName: 'Biography' }] },
    { key: 'company', properties: [{ key: 'name', displayName: 'Name' }] },
  ],
  relationTypes: [{ key: 'works_for', displayName: 'Works for' }],
}

const matched = (patch: Partial<Matched>): Matched => ({
  index: 'person~default', partKind: 'self', relationType: null, relationId: null, target: null,
  snippet: 'Person: Ada', charOffset: null, charLength: null, ...patch,
})

const catalogEntry = (patch: Partial<SearchCatalogEntry>): SearchCatalogEntry => ({
  key: 'person_employment', kind: 'custom', name: 'People by employment', description: '',
  entityType: 'person', fields: ['name'], relations: [], documentProperty: null,
  modes: ['semantic', 'keyword'], status: 'ready', ...patch,
})

const employment = matched({
  index: 'person_employment', partKind: 'relation', relationType: 'works_for', relationId: 'r1',
  target: { id: '0123456789abcdef', type: 'company', label: 'ACME', identity: null },
})

test('no matched (old server) and self parts give no line', () => {
  assert.equal(matchedViaText(undefined, schema), null)
  assert.equal(matchedViaText(matched({}), schema), null)
})

test('a relation part names the group label and the target label', () => {
  const catalog = [catalogEntry({
    relations: [{ relationType: 'works_for', direction: 'outgoing', label: 'Employment' }],
  })]
  assert.equal(matchedViaText(employment, schema, catalog), 'via Employment → ACME')
})

test('without a group label the relation type display name is used, else its key', () => {
  const catalog = [catalogEntry({
    relations: [{ relationType: 'works_for', direction: 'outgoing', label: null }],
  })]
  assert.equal(matchedViaText(employment, schema, catalog), 'via Works for → ACME')
  assert.equal(matchedViaText(employment, schema), 'via Works for → ACME')
  assert.equal(matchedViaText(employment, undefined), 'via works_for → ACME')
})

test('a target without a label falls back to its truncated id; no target drops the arrow', () => {
  const noLabel = { ...employment, target: { id: '0123456789abcdef', type: 'company', label: null, identity: null } }
  assert.equal(matchedViaText(noLabel, schema), 'via Works for → 0123456789ab')
  assert.equal(matchedViaText({ ...employment, target: null }, schema), 'via Works for')
})

test("a target's identity follows its label", () => {
  const identified = { ...employment, target: { id: '0123456789abcdef', type: 'company', label: 'ACME', identity: 'C-7' } }
  assert.equal(matchedViaText(identified, schema), 'via Works for → ACME (C-7)')
})

test('a passage names the document property display name from the catalog', () => {
  const custom = matched({ index: 'people_cv', partKind: 'passage', charOffset: 0, charLength: 400 })
  const catalog = [catalogEntry({ key: 'people_cv', documentProperty: 'bio' })]
  assert.equal(matchedViaText(custom, schema, catalog), 'via passage in Biography')
})

test('a managed passage key names its document property without the catalog', () => {
  const managed = matched({ index: 'person~bio', partKind: 'passage' })
  assert.equal(matchedViaText(managed, schema), 'via passage in Biography')
  assert.equal(matchedViaText(managed, undefined), 'via passage in bio')
})

test('a passage of an unknown custom index still says it matched a passage', () => {
  assert.equal(matchedViaText(matched({ index: 'people_cv', partKind: 'passage' }), schema), 'via passage')
})

test('the line never carries a score or the snippet', () => {
  const line = matchedViaText({ ...employment, snippet: 'secret snippet 0.93' }, schema) ?? ''
  assert.doesNotMatch(line, /snippet|0\.93/)
})

const relationMatch: EntityMatch = {
  index: 'person_employment', part: 'relation', snippet: 'CTO', relationType: 'works_for',
  target: { _id: '0123456789abcdef', _entityTypeKey: 'company', name: 'ACME' },
}

test("an entity search item's own fields give no line; a relation names the group and the target", () => {
  assert.equal(entityMatchText({ index: 'person~default', part: 'self', snippet: 'Ada' }, 'person', schema), null)
  const catalog = [catalogEntry({
    relations: [{ relationType: 'works_for', direction: 'outgoing', label: 'Employment' }],
  })]
  assert.equal(entityMatchText(relationMatch, 'person', schema, catalog), 'via Employment → ACME')
  assert.equal(entityMatchText(relationMatch, 'person', schema), 'via Works for → ACME')
  const unnamed = { ...relationMatch, target: { _id: '0123456789abcdef', _entityTypeKey: 'company', name: null } }
  assert.equal(entityMatchText(unnamed, 'person', schema), 'via Works for → 0123456789ab')
})

test("an entity search item's passage names its document; a hidden one just the passage", () => {
  const passage: EntityMatch = { index: 'people_cv', part: 'passage', snippet: null, property: 'bio', charOffset: 0, charLength: 9 }
  assert.equal(entityMatchText(passage, 'person', schema), 'via passage in Biography')
  assert.equal(entityMatchText(passage, 'person', undefined), 'via passage in bio')
  assert.equal(entityMatchText({ ...passage, property: null }, 'person', schema), 'via passage')
})
