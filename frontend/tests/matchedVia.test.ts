import { test } from 'node:test'
import assert from 'node:assert/strict'
import { matchedViaText, type MatchedViaSchema } from '../src/lib/matchedVia.ts'
import type { Matched, SearchCatalogEntry } from '../src/api/types.ts'

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
  target: { id: '0123456789abcdef', type: 'company', label: 'ACME' },
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
  const noLabel = { ...employment, target: { id: '0123456789abcdef', type: 'company', label: null } }
  assert.equal(matchedViaText(noLabel, schema), 'via Works for → 0123456789ab')
  assert.equal(matchedViaText({ ...employment, target: null }, schema), 'via Works for')
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
