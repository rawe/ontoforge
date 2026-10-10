import { test } from 'node:test'
import assert from 'node:assert/strict'
import { dagreLayout, estimateHeight, NODE_WIDTH } from '../src/components/studio/graph/layout.ts'
import { allCollapsedOf, prunePositions, toggleAll } from '../src/components/studio/graph/graphStore.ts'

const nodes = ['person', 'team', 'project', 'skill'].map((id) => ({ id, width: NODE_WIDTH, height: 120 }))
const edges = [
  { source: 'person', target: 'team' },
  { source: 'person', target: 'project' },
  { source: 'project', target: 'skill' },
  { source: 'person', target: 'person' }, // self-loop
  { source: 'person', target: 'team' }, // parallel
]

test('dagreLayout positions every node without overlaps', () => {
  const pos = dagreLayout(nodes, edges)
  assert.deepEqual(Object.keys(pos).sort(), nodes.map((n) => n.id).sort())
  const boxes = nodes.map((n) => ({ ...pos[n.id]!, w: n.width, h: n.height }))
  for (let i = 0; i < boxes.length; i++) {
    for (let j = i + 1; j < boxes.length; j++) {
      const a = boxes[i]!
      const b = boxes[j]!
      const overlap = a.x < b.x + b.w && b.x < a.x + a.w && a.y < b.y + b.h && b.y < a.y + a.h
      assert.equal(overlap, false, `${nodes[i]!.id} overlaps ${nodes[j]!.id}`)
    }
  }
})

test('dagreLayout lays out left to right: a source ranks before its target', () => {
  const pos = dagreLayout(nodes, edges)
  assert.ok(pos.person!.x < pos.team!.x)
  assert.ok(pos.person!.x < pos.project!.x)
  assert.ok(pos.project!.x < pos.skill!.x)
})

test('dagreLayout ignores self-loops and edges to unknown nodes', () => {
  const pos = dagreLayout([{ id: 'a', width: NODE_WIDTH, height: 80 }], [
    { source: 'a', target: 'a' },
    { source: 'a', target: 'ghost' },
  ])
  assert.deepEqual(Object.keys(pos), ['a'])
})

test('dagreLayout keeps room above a node for its self-loops', () => {
  // a and b are both targets of r, so they share a rank and stack vertically.
  const three = ['r', 'a', 'b'].map((id) => ({ id, width: NODE_WIDTH, height: 100 }))
  const fanOut = [
    { source: 'r', target: 'a' },
    { source: 'r', target: 'b' },
  ]
  const gap = (pos: Record<string, { x: number; y: number }>) => {
    const [upper, lower] = [pos.a!, pos.b!].sort((p, q) => p.y - q.y)
    return lower!.y - (upper!.y + 100)
  }
  const plain = dagreLayout(three, fanOut)
  const looped = dagreLayout(three, [...fanOut, { source: 'a', target: 'a' }, { source: 'b', target: 'b' }])
  assert.ok(gap(looped) > gap(plain))
})

test('estimateHeight: collapsed is shortest, rows grow up to the truncation, then "+N more"', () => {
  const collapsed = estimateHeight(10, true)
  const three = estimateHeight(3)
  const six = estimateHeight(6)
  const ten = estimateHeight(10)
  assert.ok(collapsed < three)
  assert.ok(three < six)
  assert.ok(six < ten)
  assert.equal(estimateHeight(7), ten) // rows stop at 6, the "+N more" line is added once
  assert.equal(estimateHeight(0), estimateHeight(1)) // "No properties" takes one row
})

test('allCollapsedOf needs every listed id, and at least one', () => {
  assert.equal(allCollapsedOf({}, []), false)
  assert.equal(allCollapsedOf({ a: true }, ['a']), true)
  assert.equal(allCollapsedOf({ a: true }, ['a', 'b']), false)
})

test('toggleAll collapses all unless all are collapsed, then expands all', () => {
  assert.deepEqual(toggleAll({}, ['a', 'b']), { a: true, b: true })
  assert.deepEqual(toggleAll({ a: true }, ['a', 'b']), { a: true, b: true })
  assert.deepEqual(toggleAll({ a: true, b: true }, ['a', 'b']), {})
})

test('prunePositions drops unknown ids', () => {
  const pos = { a: { x: 1, y: 2 }, gone: { x: 3, y: 4 } }
  assert.deepEqual(prunePositions(pos, ['a', 'b']), { a: { x: 1, y: 2 } })
})
