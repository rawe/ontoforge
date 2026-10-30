import { test } from 'node:test'
import assert from 'node:assert/strict'
import { ApiError } from '../src/api/http.ts'
import type { SearchTreeNode } from '../src/api/types.ts'
import {
  addAt,
  canonicalTree,
  cleanTree,
  conditionProblem,
  conditionsOf,
  newNode,
  nodeAt,
  nodeOfPath,
  placeErrors,
  removal,
  removeAt,
  replaceAt,
  resultUnit,
  updateAt,
  wrapAt,
} from '../src/components/studio/namedsearches/namedSearchModel.ts'

const kw = (index: string, text = '$query'): SearchTreeNode => ({ kind: 'keywordSearch', index, text })
const sem = (index: string): SearchTreeNode => ({ kind: 'semanticSearch', index, text: '$query' })
const defaults = { index: 'person', entityType: 'person', unit: 'entities' as const }

/* ------------------------------ canonical tree ------------------------------ */

test('the canonical tree: cut over fuse over a group per method over a merge per index', () => {
  assert.deepEqual(
    canonicalTree({ unit: 'entities', indices: ['person', 'company'], methods: ['keyword', 'semantic'], limit: 20 }),
    {
      kind: 'cut',
      limit: 20,
      input: {
        kind: 'fuse',
        inputs: [
          { kind: 'group', key: 'entity', input: { kind: 'merge', inputs: [kw('person'), kw('company')] } },
          { kind: 'group', key: 'entity', input: { kind: 'merge', inputs: [sem('person'), sem('company')] } },
        ],
      },
    },
  )
})

test('a layer with a single input disappears', () => {
  assert.deepEqual(canonicalTree({ unit: 'passages', indices: ['doc'], methods: ['keyword'], limit: 10 }), {
    kind: 'cut',
    limit: 10,
    input: { kind: 'group', key: 'passage', input: kw('doc') },
  })
  assert.deepEqual(
    canonicalTree({ unit: 'entities', indices: ['a'], methods: ['keyword', 'semantic'], limit: 5 }),
    {
      kind: 'cut',
      limit: 5,
      input: {
        kind: 'fuse',
        inputs: [
          { kind: 'group', key: 'entity', input: kw('a') },
          { kind: 'group', key: 'entity', input: sem('a') },
        ],
      },
    },
  )
})

test('an index searches only by the methods it has; a method without an index drops out', () => {
  const modes = { a: ['keyword' as const], b: ['keyword' as const, 'semantic' as const] }
  assert.deepEqual(
    canonicalTree({ unit: 'entities', indices: ['a', 'b'], methods: ['keyword', 'semantic'], limit: 10 }, modes),
    {
      kind: 'cut',
      limit: 10,
      input: {
        kind: 'fuse',
        inputs: [
          { kind: 'group', key: 'entity', input: { kind: 'merge', inputs: [kw('a'), kw('b')] } },
          { kind: 'group', key: 'entity', input: sem('b') },
        ],
      },
    },
  )
  assert.deepEqual(
    canonicalTree({ unit: 'entities', indices: ['a'], methods: ['keyword', 'semantic'], limit: 10 }, modes),
    { kind: 'cut', limit: 10, input: { kind: 'group', key: 'entity', input: kw('a') } },
  )
})

test('nothing to search writes no tree', () => {
  assert.equal(canonicalTree({ unit: 'entities', indices: [], methods: ['keyword'], limit: 10 }), null)
  assert.equal(canonicalTree({ unit: 'entities', indices: ['a'], methods: [], limit: 10 }), null)
  assert.equal(
    canonicalTree({ unit: 'entities', indices: ['a'], methods: ['semantic'], limit: 10 }, { a: ['keyword'] }),
    null,
  )
})

/* -------------------------------- tree edits -------------------------------- */

const tree = canonicalTree({ unit: 'entities', indices: ['a', 'b'], methods: ['keyword', 'semantic'], limit: 10 })!

test('nodeAt follows input, inputs.<i> and filters.<i>', () => {
  assert.equal(nodeAt(tree, ''), tree)
  assert.equal(nodeAt(tree, 'input')?.kind, 'fuse')
  assert.deepEqual(nodeAt(tree, 'input.inputs.1.input.inputs.0'), sem('a'))
  assert.equal(nodeAt(tree, 'input.inputs.7'), undefined)
  assert.equal(nodeAt(tree, 'input.index'), undefined)
})

test('updateAt and replaceAt change one node and leave the rest', () => {
  const next = updateAt(tree, 'input.inputs.0.input.inputs.1', (n) => ({ ...n, text: 'x $query' }) as SearchTreeNode)
  assert.deepEqual(nodeAt(next, 'input.inputs.0.input.inputs.1'), kw('b', 'x $query'))
  assert.deepEqual(nodeAt(next, 'input.inputs.1'), nodeAt(tree, 'input.inputs.1'))
  assert.deepEqual(nodeAt(tree, 'input.inputs.0.input.inputs.1'), kw('b'), 'the original is untouched')
  assert.deepEqual(nodeAt(replaceAt(tree, 'input', kw('c')), 'input'), kw('c'))
  assert.equal(replaceAt(tree, 'input.inputs.9', kw('c')), tree, 'no node there: unchanged')
})

test('addAt appends to a merge or fuse its inputs, to a restrict its filters', () => {
  const added = addAt(tree, 'input.inputs.0.input', kw('c'))
  assert.deepEqual(nodeAt(added, 'input.inputs.0.input.inputs.2'), kw('c'))
  const restrict: SearchTreeNode = { kind: 'restrict', input: kw('a'), filters: [] }
  const filter = newNode('filter', defaults)
  assert.deepEqual(nodeAt(addAt(restrict, '', filter), 'filters.0'), filter)
  assert.equal(addAt(tree, '', kw('c')), tree, 'a cut takes no list')
})

test('wrapAt puts a new node above, the old one its input', () => {
  const wrapped = wrapAt(tree, 'input', 'restrict', defaults)
  assert.equal(nodeAt(wrapped, 'input')?.kind, 'restrict')
  assert.deepEqual(nodeAt(wrapped, 'input.input'), nodeAt(tree, 'input'))
  const merged = wrapAt(tree, 'input.inputs.0.input.inputs.0', 'merge', defaults)
  assert.deepEqual(nodeAt(merged, 'input.inputs.0.input.inputs.0'), { kind: 'merge', inputs: [kw('a')] })
})

test('removing: a list item leaves its list, a node with one input gives way to it', () => {
  assert.equal(removal(tree, 'input.inputs.1'), 'list')
  const fewer = removeAt(tree, 'input.inputs.1')
  assert.equal((nodeAt(fewer, 'input') as { inputs: unknown[] }).inputs.length, 1)
  assert.equal(removal(tree, 'input.inputs.0.input.inputs.0'), 'list')
  assert.deepEqual(nodeAt(removeAt(tree, 'input.inputs.0.input.inputs.0'), 'input.inputs.0.input'), {
    kind: 'merge',
    inputs: [kw('b')],
  })
  assert.equal(removal(tree, 'input.inputs.0'), 'list')
  assert.equal(removal(tree, ''), 'unwrap')
  assert.deepEqual(removeAt(tree, ''), nodeAt(tree, 'input'))
  const single = canonicalTree({ unit: 'entities', indices: ['a'], methods: ['keyword'], limit: 10 })!
  assert.equal(removal(single, 'input.input'), null, 'the only search of a group stays')
  assert.equal(removeAt(single, 'input.input'), single)
  assert.equal(removal(single, 'input'), 'unwrap')
  const restrict: SearchTreeNode = { kind: 'restrict', input: kw('a'), filters: [newNode('filter', defaults)] }
  assert.deepEqual(removeAt(restrict, 'filters.0'), { kind: 'restrict', input: kw('a'), filters: [] })
})

test('new nodes that take an input come with a grouped search', () => {
  assert.deepEqual(newNode('cut', defaults), {
    kind: 'cut',
    limit: 10,
    input: { kind: 'group', key: 'entity', input: kw('person') },
  })
  assert.deepEqual(newNode('group', { ...defaults, unit: 'passages' }), {
    kind: 'group',
    key: 'passage',
    input: kw('person'),
  })
  assert.deepEqual(newNode('fuse', defaults), { kind: 'fuse', inputs: [] })
})

/* --------------------------------- reading --------------------------------- */

test('the result unit is the first group key below the root', () => {
  assert.equal(resultUnit(tree), 'entities')
  assert.equal(resultUnit(canonicalTree({ unit: 'passages', indices: ['d'], methods: ['keyword'], limit: 3 })!), 'passages')
  assert.equal(resultUnit(kw('a')), null)
  assert.equal(resultUnit({ kind: 'fuse', inputs: [] }), null)
})

test('cleanTree drops condition rows without a key', () => {
  const restrict: SearchTreeNode = {
    kind: 'restrict',
    input: kw('a'),
    filters: [{ kind: 'filter', entityType: 'person', conditions: { year: '2020', ' ': 'x', '': '' } }],
  }
  assert.deepEqual(cleanTree({ kind: 'cut', limit: 5, input: restrict }), {
    kind: 'cut',
    limit: 5,
    input: { ...restrict, filters: [{ kind: 'filter', entityType: 'person', conditions: { year: '2020' } }] },
  })
})

test('typing a second key through an existing one keeps both conditions', () => {
  const typed = (key: string) => [['age', '30'], [key, '']] as const
  // On the way to `age__gte` the new row's key is briefly `age`: it is flagged, the existing condition stays.
  assert.deepEqual(conditionsOf(typed('age')), { age: '30' })
  assert.equal(conditionProblem(typed('age'), 0), null)
  assert.match(conditionProblem(typed('age'), 1) ?? '', /already used/)
  assert.deepEqual(conditionsOf(typed('age__gte')), { age: '30', age__gte: '' })
  assert.equal(conditionProblem(typed('age__gte'), 1), null)
})

test('a condition row without a key is flagged only once it has a value', () => {
  assert.equal(conditionProblem([['', '']], 0), null)
  assert.match(conditionProblem([[' ', 'x']], 0) ?? '', /without a key/)
  assert.deepEqual(conditionsOf([['year', '2020'], ['', ''], ['', 'x']]), { year: '2020', '': '' })
})

/* ---------------------------------- errors ---------------------------------- */

test('a server path names a node and the field below it', () => {
  assert.deepEqual(nodeOfPath('tree.input.inputs.1.index'), { node: 'input.inputs.1', field: 'index' })
  assert.deepEqual(nodeOfPath('tree'), { node: '', field: '' })
  assert.deepEqual(nodeOfPath('/tree/input/filters/0/conditions/year'), { node: 'input.filters.0', field: 'conditions.year' })
  assert.deepEqual(nodeOfPath('tree.inputs[2].text'), { node: 'inputs.2', field: 'text' })
  assert.equal(nodeOfPath('name'), null)
})

const validation = (details: Record<string, unknown>) =>
  new ApiError(422, 'VALIDATION_ERROR', "Named search 'x' validation failed", details)

test('reasons as strings or objects land on their node and in the summary', () => {
  const placed = placeErrors(
    validation({
      errors: [
        "tree.input.inputs.1.index: Search index 'gone' is not searchable in this lens",
        { path: 'tree.input', message: 'A fuse combines rankings of one result unit' },
        { path: 'tree', message: 'At least one search text contains $query' },
        'Something about the whole',
      ],
    }),
  )
  assert.deepEqual(placed.byNode, {
    'input.inputs.1': ["index: Search index 'gone' is not searchable in this lens"],
    input: ['A fuse combines rankings of one result unit'],
    '': ['At least one search text contains $query'],
  })
  assert.deepEqual(placed.summary, [
    "tree.input.inputs.1.index: Search index 'gone' is not searchable in this lens",
    'tree.input: A fuse combines rankings of one result unit',
    'tree: At least one search text contains $query',
    'Something about the whole',
  ])
})

test('field errors and plain failures go to the summary', () => {
  assert.deepEqual(placeErrors(validation({ fields: { name: 'Required' } })), {
    summary: ['name: Required'],
    byNode: {},
  })
  assert.deepEqual(placeErrors(new Error('Network down')), { summary: ['Network down'], byNode: {} })
})
