import assert from 'node:assert/strict'
import test from 'node:test'
import { edgeLanes, layoutGraph } from '../src/components/graph3d/layout.ts'

test('3D layout handles empty, singleton, disconnected and self-related graphs', () => {
  assert.equal(layoutGraph([], []).size, 0)
  assert.deepEqual(layoutGraph([{ id: 'solo' }], [{ source: 'solo', target: 'solo' }]).get('solo'), { x: 0, y: 0, z: 0 })
  const nodes = Array.from({ length: 30 }, (_, i) => ({ id: `n${i}` }))
  const positions = layoutGraph(nodes, [{ source: 'n1', target: 'gone' }])
  assert.equal(positions.size, nodes.length)
  for (const p of positions.values()) assert.ok([p.x, p.y, p.z].every(Number.isFinite))
  assert.equal(new Set([...positions.values()].map(p => JSON.stringify(p))).size, nodes.length)
})

test('3D layout is independent of server node/edge order and responds to topology', () => {
  const nodes = ['a', 'b', 'c', 'd', 'e'].map(id => ({ id }))
  const edges = [{ source: 'a', target: 'b' }, { source: 'b', target: 'c' }]
  assert.deepEqual(layoutGraph(nodes, edges), layoutGraph([...nodes].reverse(), [...edges].reverse()))
  assert.notDeepEqual(layoutGraph(nodes, edges), layoutGraph(nodes, []))
})

test('parallel and reversed relations receive stable distinct lanes, including loops', () => {
  const edges = [
    { id: 'a', source: 'one', target: 'two' },
    { id: 'b', source: 'two', target: 'one' },
    { id: 'c', source: 'one', target: 'two' },
    { id: 'loop1', source: 'one', target: 'one' },
    { id: 'loop2', source: 'one', target: 'one' },
  ]
  const lanes = edgeLanes(edges)
  assert.deepEqual(lanes, edgeLanes([...edges].reverse()))
  assert.equal(new Set(['a', 'b', 'c'].map(id => lanes.get(id))).size, 3)
  assert.notEqual(lanes.get('loop1'), lanes.get('loop2'))
})
