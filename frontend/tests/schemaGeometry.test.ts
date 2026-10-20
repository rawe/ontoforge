import { test } from 'node:test'
import assert from 'node:assert/strict'
import {
  borderPoint,
  edgeGeometry,
  edgeSpecs,
  freeSpot,
  placeLabels,
  type Box,
} from '../src/components/studio/graph/geometry.ts'

const box = (x: number, y: number, w = 200, h = 100): Box => ({ x, y, w, h })

test('borderPoint lies on the box border (plus the gap) towards the target', () => {
  const b = box(0, 0)
  const right = borderPoint(b, { x: 1000, y: 50 }, 0)
  assert.deepEqual(right, { x: 200, y: 50 })
  const above = borderPoint(b, { x: 100, y: -500 }, 0)
  assert.deepEqual(above, { x: 100, y: 0 })
  const diagonal = borderPoint(b, { x: 400, y: 250 }, 0)
  const onVertical = Math.abs(diagonal.x - 200) < 1e-9 && diagonal.y >= 0 && diagonal.y <= 100
  const onHorizontal = Math.abs(diagonal.y - 100) < 1e-9 && diagonal.x >= 0 && diagonal.x <= 200
  assert.ok(onVertical || onHorizontal)
  assert.deepEqual(borderPoint(b, { x: 1000, y: 50 }), { x: 202, y: 50 })
})

test('edgeSpecs: a single edge is straight', () => {
  const specs = edgeSpecs([{ id: 'r', source: 'a', target: 'b' }])
  assert.deepEqual(specs.get('r'), { offset: 0, loopIndex: 0 })
})

test('edgeSpecs: two and three parallel edges get symmetric offsets', () => {
  const two = edgeSpecs([
    { id: 'r1', source: 'a', target: 'b' },
    { id: 'r2', source: 'a', target: 'b' },
  ])
  assert.equal(two.get('r1')!.offset, -two.get('r2')!.offset)
  assert.notEqual(two.get('r1')!.offset, 0)

  const three = edgeSpecs([
    { id: 'r1', source: 'a', target: 'b' },
    { id: 'r2', source: 'a', target: 'b' },
    { id: 'r3', source: 'a', target: 'b' },
  ])
  assert.deepEqual(
    ['r1', 'r2', 'r3'].map((id) => three.get(id)!.offset),
    [-34, 0, 34],
  )
})

test('edgeSpecs: opposite directions share one group and bulge apart', () => {
  const specs = edgeSpecs([
    { id: 'ab', source: 'a', target: 'b' },
    { id: 'ba', source: 'b', target: 'a' },
  ])
  // The offset is relative to each edge's own direction; seen from a → b, b → a's flips.
  const ab = specs.get('ab')!.offset
  const baSeenFromAb = -specs.get('ba')!.offset
  assert.equal(Math.abs(ab), 17)
  assert.equal(ab, -baSeenFromAb)
})

test('edgeSpecs: self-loops get increasing loop indices per node', () => {
  const specs = edgeSpecs([
    { id: 'l1', source: 'a', target: 'a' },
    { id: 'x', source: 'a', target: 'b' },
    { id: 'l2', source: 'a', target: 'a' },
    { id: 'l3', source: 'b', target: 'b' },
  ])
  assert.deepEqual(specs.get('l1'), { offset: 0, loopIndex: 0 })
  assert.deepEqual(specs.get('l2'), { offset: 0, loopIndex: 1 })
  assert.deepEqual(specs.get('l3'), { offset: 0, loopIndex: 0 })
  assert.equal(specs.get('x')!.offset, 0)
})

test('placeLabels keeps the middle when it is free', () => {
  const boxes = new Map([
    ['a', box(0, 0)],
    ['b', box(600, 0)],
  ])
  const t = placeLabels([{ id: 'r', source: 'a', target: 'b', label: 'works_on', offset: 0, loopIndex: 0 }], boxes)
  assert.equal(t.get('r'), 0.5)
})

test('placeLabels moves a label off a node that covers the middle', () => {
  const boxes = new Map([
    ['a', box(0, 0)],
    ['b', box(600, 0)],
    ['c', box(350, 30, 100, 40)], // sits on the middle of a → b
  ])
  const t = placeLabels([{ id: 'r', source: 'a', target: 'b', label: 'works_on', offset: 0, loopIndex: 0 }], boxes)
  assert.notEqual(t.get('r'), 0.5)
})

test('placeLabels moves the second of two labels that would overlap', () => {
  const boxes = new Map([
    ['a', box(0, 0)],
    ['b', box(600, 0)],
    ['c', box(0, 200)],
    ['d', box(600, 200)],
  ])
  // a → d and c → b cross in the middle.
  const t = placeLabels(
    [
      { id: 'ad', source: 'a', target: 'd', label: 'first', offset: 0, loopIndex: 0 },
      { id: 'cb', source: 'c', target: 'b', label: 'second', offset: 0, loopIndex: 0 },
    ],
    boxes,
  )
  assert.equal(t.get('ad'), 0.5)
  assert.notEqual(t.get('cb'), 0.5)
})

test('placeLabels keeps a label clear of nodes when every slot is taken by labels', () => {
  const boxes = new Map([
    ['a', box(0, 0)],
    ['b', box(600, 0)],
    ['c', box(350, 30, 100, 40)], // sits on the middle of a → b
  ])
  // Ten edges along the same line: the later ones find every slot taken by a label.
  const edges = Array.from({ length: 10 }, (_, i) => ({
    id: `r${i}`,
    source: 'a',
    target: 'b',
    label: 'works_on',
    offset: 0,
    loopIndex: 0,
  }))
  const t = placeLabels(edges, boxes)
  const c = boxes.get('c')!
  for (const e of edges) {
    const p = edgeGeometry(boxes.get('a')!, boxes.get('b')!, false, e, t.get(e.id)).label
    const onC = p.x + 30 > c.x && p.x - 30 < c.x + c.w && p.y + 9 > c.y && p.y - 9 < c.y + c.h
    assert.equal(onC, false, `${e.id} is hidden behind c`)
  }
})

test('freeSpot returns the start when it is free', () => {
  assert.deepEqual(freeSpot({ x: 0, y: 0 }, [box(1000, 1000)], 232, 120), { x: 0, y: 0 })
})

test('freeSpot returns a spot clear of every taken box when the start is taken', () => {
  const taken = [box(0, 0, 232, 120), box(-300, -150, 232, 120)]
  const spot = freeSpot({ x: 10, y: 10 }, taken, 232, 120)
  assert.notDeepEqual(spot, { x: 10, y: 10 })
  assert.equal(spot.x, 10, 'the nearest free spot is straight below, not beside')
  const mine = { x: spot.x, y: spot.y, w: 232, h: 120 }
  for (const b of taken) {
    const overlap = mine.x < b.x + b.w && b.x < mine.x + mine.w && mine.y < b.y + b.h && b.y < mine.y + mine.h
    assert.equal(overlap, false)
  }
})

test('edgeGeometry returns the end points at the source and the target node', () => {
  const a = box(0, 0)
  const b = box(400, 0)
  const straight = edgeGeometry(a, b, false, { offset: 0, loopIndex: 0 })
  assert.deepEqual(straight.start, { x: 202, y: 50 })
  assert.deepEqual(straight.end, { x: 398, y: 50 })
  assert.ok(straight.path.startsWith('M 202 50'))
  const curved = edgeGeometry(a, b, false, { offset: 34, loopIndex: 0 })
  assert.ok(curved.path.startsWith(`M ${curved.start.x} ${curved.start.y}`))
  assert.ok(curved.path.endsWith(`${curved.end.x} ${curved.end.y}`))
  const loop = edgeGeometry(a, a, true, { offset: 0, loopIndex: 0 })
  assert.ok(loop.path.startsWith(`M ${loop.start.x} ${loop.start.y}`))
  assert.ok(loop.path.endsWith(`${loop.end.x} ${loop.end.y}`))
})
