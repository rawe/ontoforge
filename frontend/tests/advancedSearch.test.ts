import { test } from 'node:test'
import assert from 'node:assert/strict'
import {
  countText,
  entityLabel,
  entityLink,
  fieldErrorsAt,
  isEntitySearchResponse,
  limitationSentence,
  ranText,
  scopeSummary,
  searchBody,
  sharedType,
  unplacedFieldErrors,
  type LimitationNames,
  type SearchForm,
} from '../src/components/advancedsearch/searchModel.ts'

const form = (patch: Partial<SearchForm>): SearchForm => ({
  mode: 'entities',
  query: ' Ada ',
  scope: { field: 'types', keys: [] },
  keyword: { on: false, match: 'any' },
  semantic: { on: false, minSimilarity: '' },
  filter: undefined,
  limit: '',
  perEntity: '',
  ...patch,
})

test('an untouched form sends the trimmed query only: no scope, no block', () => {
  assert.deepEqual(searchBody(form({})), { query: 'Ada' })
})

test('the scope sends its one field when it names keys', () => {
  assert.deepEqual(searchBody(form({ scope: { field: 'types', keys: ['person', 'company'] } })), {
    query: 'Ada',
    types: ['person', 'company'],
  })
  assert.deepEqual(searchBody(form({ scope: { field: 'indices', keys: ['person~default'] } })), {
    query: 'Ada',
    indices: ['person~default'],
  })
  const documents = form({ scope: { field: 'documents', keys: ['person.bio'] } })
  assert.deepEqual(searchBody({ ...documents, mode: 'passages' }), { query: 'Ada', documents: ['person.bio'] })
  // Documents are the passage search's only.
  assert.deepEqual(searchBody(documents), { query: 'Ada' })
})

test('a checked method sends its block; an empty floor sends an empty semantic block', () => {
  assert.deepEqual(searchBody(form({ keyword: { on: true, match: 'all' } })), {
    query: 'Ada',
    keyword: { match: 'all' },
  })
  assert.deepEqual(searchBody(form({ semantic: { on: true, minSimilarity: '' } })), { query: 'Ada', semantic: {} })
  assert.deepEqual(searchBody(form({ semantic: { on: true, minSimilarity: '0.8' } })), {
    query: 'Ada',
    semantic: { minSimilarity: 0.8 },
  })
  // An unchecked method sends nothing, whatever its settings.
  assert.deepEqual(searchBody(form({ semantic: { on: false, minSimilarity: '0.8' } })), { query: 'Ada' })
})

test('filter values go as strings; limit and per entity as numbers, per entity in passages only', () => {
  const body = searchBody(
    form({ filter: { status: 'active', age__gte: 30, email__exists: true }, limit: '5', perEntity: '2' }),
  )
  assert.deepEqual(body, {
    query: 'Ada',
    filter: { status: 'active', age__gte: '30', email__exists: 'true' },
    limit: 5,
  })
  assert.deepEqual(searchBody(form({ mode: 'passages', limit: '5', perEntity: '2' })), {
    query: 'Ada',
    limit: 5,
    perEntity: 2,
  })
})

test('field errors land at their control by request path; the rest stay unplaced', () => {
  const fields = {
    query: 'Required non-empty query',
    'types.1': "Entity type 'ghost' not found",
    'keyword.match': 'Expected any or all',
    'filter.works_for:out.ghost': "Unknown filter property or relation type: 'ghost'",
    perEntity: 'Expected integer from 1 to limit',
    elsewhere: 'Something else',
  }
  assert.deepEqual(fieldErrorsAt(fields, 'types'), ["Entity type 'ghost' not found"])
  assert.deepEqual(fieldErrorsAt(fields, 'keyword'), ['Expected any or all'])
  assert.deepEqual(fieldErrorsAt(fields, 'filter'), ["Unknown filter property or relation type: 'ghost'"])
  assert.deepEqual(fieldErrorsAt(fields, 'perEntity'), ['Expected integer from 1 to limit'])
  assert.deepEqual(fieldErrorsAt(fields, 'limit'), [])
  assert.deepEqual(unplacedFieldErrors(fields), ['elsewhere: Something else'])
})

const names: LimitationNames = {
  type: (key) => ({ person: 'Person', company: 'Company' })[key] ?? key,
  index: (key) => ({ employment_new: 'New employment' })[key] ?? key,
  document: (key) => ({ 'person.notes': 'Person · Notes' })[key] ?? key,
}

test('each limitation code reads as a sentence naming its types, documents or indices', () => {
  assert.equal(
    limitationSentence({ code: 'not-searchable', message: 'm', types: ['company'] }, 'entities', names),
    'No search index this lens can search for Company, so nothing was searched there.',
  )
  assert.equal(
    limitationSentence({ code: 'not-searchable', message: 'm', documents: ['person.notes'] }, 'passages', names),
    'No passage index this lens can search for Person · Notes, so nothing was searched there.',
  )
  assert.equal(
    limitationSentence(
      { code: 'switched-off', message: 'm', method: 'keyword', indices: ['employment_new'] },
      'entities',
      names,
    ),
    'Keyword search is switched off on New employment.',
  )
  assert.equal(
    limitationSentence(
      { code: 'not-ready', message: 'm', method: 'semantic', indices: ['employment_new', 'other'] },
      'entities',
      names,
    ),
    'Semantic search entries of New employment, other are not built yet.',
  )
  assert.equal(
    limitationSentence(
      { code: 'filter-excludes-all-types', message: 'm', types: ['company', 'person'] },
      'entities',
      names,
    ),
    'None of Company, Person declares every filter key, so nothing was searched.',
  )
  // Nothing named: the server's own message.
  assert.equal(
    limitationSentence({ code: 'not-searchable', message: 'The server says so' }, 'entities', names),
    'The server says so',
  )
})

test('ran and the count read as short lines', () => {
  assert.equal(ranText([]), 'No method ran')
  assert.equal(ranText(['keyword']), 'Ran keyword search')
  assert.equal(ranText(['semantic', 'keyword']), 'Ran semantic and keyword search, fused by rank')
  assert.equal(countText('entities', 1), '1 entity')
  assert.equal(countText('entities', 0), '0 entities')
  assert.equal(countText('passages', 3), '3 passages')
})

test('a saved query run is told apart by its shape; a found entity reads by name, else id', () => {
  assert.equal(isEntitySearchResponse({ ran: ['keyword'], items: [], limitations: [] }), true)
  assert.equal(isEntitySearchResponse({ columns: ['p'], results: [] }), false)
  const entity = { _id: 'e-1', _entityTypeKey: 'person', name: null }
  assert.equal(entityLabel(entity), 'e-1')
  assert.equal(entityLabel({ ...entity, name: 'Ada' }), 'Ada')
  assert.equal(entityLink('onto', 'all', entity), '/o/onto/w/all/e/person/e-1')
})

test('the filter type is the one type every chosen scope item belongs to', () => {
  const typeOf = (key: string) => key.split('~')[0]
  assert.equal(sharedType([], typeOf), undefined)
  assert.equal(sharedType(['person~default', 'person~cv'], typeOf), 'person')
  assert.equal(sharedType(['person~default', 'company~default'], typeOf), undefined)
  // An unknown key has no type, so nothing is shared.
  assert.equal(sharedType(['person~default', 'gone'], (key) => (key === 'gone' ? undefined : 'person')), undefined)
})

test('the scope summary counts what is chosen; nothing chosen reads as all', () => {
  assert.equal(scopeSummary('types', 0, 5), 'All 5 types')
  assert.equal(scopeSummary('types', 2, 5), '2 of 5 types')
  assert.equal(scopeSummary('indices', 0, 62), 'Every type’s managed indices')
  assert.equal(scopeSummary('indices', 1, 62), '1 of 62 indices')
  assert.equal(scopeSummary('documents', 0, 1), 'The one document')
})
