import assert from 'node:assert/strict'
import test from 'node:test'
import { followTourDetails, manualDetails, reconcileDetails, shownDetail, type DetailState } from '../src/components/graph3d/details.ts'
import { focusNeighborhood } from '../src/components/graph3d/focus.ts'

const initial: DetailState = { manualNodeId: 'a', manualEdgeId: null, tourNodeId: null, followTour: true, pinned: null }
const nodes = [{ id: 'a' }, { id: 'b' }, { id: 'c' }]

test('a tour preview cannot expand the manually focused neighbourhood along a chain', () => {
  const edges = [{ source: 'a', target: 'b' }, { source: 'b', target: 'c' }]
  for (const tourNodeId of ['a', 'b']) {
    const state = { ...initial, tourNodeId }
    const members = focusNeighborhood(state.manualNodeId, edges)
    assert.deepEqual(nodes.filter(node => members.has(node.id)).map(node => node.id), ['a', 'b'])
    assert.deepEqual(shownDetail(state), { kind: 'node', id: tourNodeId })
  }
  assert.equal(focusNeighborhood(null, edges).size, 0)
})

test('tour details preview the current stop without changing the host selection and remain after stopping', () => {
  const stopped = { ...initial, tourNodeId: 'b' }
  assert.deepEqual(shownDetail(stopped), { kind: 'node', id: 'b' })
  assert.equal(stopped.manualNodeId, 'a')
  assert.equal(reconcileDetails(stopped, 'a', null, nodes, []), stopped)
})

test('pinning retains the shown stop even without a host selection; following resumes at the current stop', () => {
  const pinned = followTourDetails({ ...initial, manualNodeId: null, tourNodeId: 'b' }, false)
  const nextStop = { ...pinned, tourNodeId: 'c' }
  assert.deepEqual(shownDetail(nextStop), { kind: 'node', id: 'b' })
  assert.deepEqual(shownDetail(followTourDetails(nextStop, true)), { kind: 'node', id: 'c' })
})

test('manual selection takes control of following or pinned details', () => {
  for (const followTour of [true, false]) {
    const next = manualDetails({ ...initial, followTour, tourNodeId: 'b' }, { kind: 'node', id: 'c' })
    const reconciled = reconcileDetails(next, 'c', null, nodes, [])
    assert.equal(reconciled.tourNodeId, null)
    assert.deepEqual(shownDetail(reconciled), { kind: 'node', id: 'c' })
  }
})

test('selecting the same host node still clears a tour preview', () => {
  const state = { ...initial, tourNodeId: 'b' }
  const selectedAgain = manualDetails(state, { kind: 'node', id: 'a' })
  assert.deepEqual(shownDetail(reconcileDetails(selectedAgain, 'a', null, nodes, [])), { kind: 'node', id: 'a' })
})

test('host relationship selection clears the tour preview and pins the new selection', () => {
  const next = reconcileDetails({ ...initial, followTour: false, tourNodeId: 'b', pinned: { kind: 'node', id: 'a' } }, null, 'relation', nodes, [{ id: 'relation' }])
  assert.equal(next.tourNodeId, null)
  assert.deepEqual(shownDetail(next), { kind: 'edge', id: 'relation' })
})

test('removing a tour stop or pinned item falls back to manual details; replacement and empty graphs drop stale previews', () => {
  for (const followTour of [true, false]) {
    const state: DetailState = { ...initial, followTour, tourNodeId: 'b', pinned: { kind: 'node', id: 'b' } }
    assert.deepEqual(shownDetail(reconcileDetails(state, 'a', null, [{ id: 'a' }], [])), { kind: 'node', id: 'a' })
    const replaced = reconcileDetails(state, null, null, [{ id: 'other' }], [])
    assert.equal(shownDetail(replaced), null)
    assert.equal(shownDetail(reconcileDetails(state, null, null, [], [])), null)
  }
})
