import { test } from 'node:test'
import assert from 'node:assert/strict'
import type { Anchor, AnchorView, PathStep } from '../src/api/types.ts'
import {
  anchoredHereText,
  anchoredMcpUrl,
  anchorKeyProblem,
  anchorOptionLabel,
  anchorPlacement,
  anchorsAt,
  danglingCount,
  danglingWarningText,
  repointConfirmation,
  anchorWritesLine,
  unanchorConfirmation,
} from '../src/components/anchors/anchors.ts'

const step = (type: string, id: string, name: string | null): PathStep => ({ type, id, name })
const acme = step('customer', 'c-acme', 'ACME')
const p1 = step('project', 'p-1', 'P1')
const p2 = step('project', 'p-2', 'P2')

const anchored: Anchor = { key: 'agent-a', entity: { type: 'project', id: 'p-1' }, state: 'anchored' }
const unanchored: Anchor = { key: 'agent-u', entity: null, state: 'unanchored' }
const dangling: Anchor = {
  key: 'agent-d',
  entity: { type: 'project', id: '7f3a9c00-0000-0000-0000-000000000000' },
  state: 'dangling',
}
const typeName = (key: string) => ({ project: 'Project', customer: 'Customer' })[key] ?? key

test('anchorKeyProblem mirrors the lens-resource rule, max 64, and refuses an existing key', () => {
  assert.equal(anchorKeyProblem('agent-a', []), null)
  assert.equal(anchorKeyProblem('a_1-b', []), null)
  assert.equal(anchorKeyProblem('a'.repeat(64), []), null)
  assert.equal(anchorKeyProblem('', []), 'A key is required.')
  for (const bad of ['Agent', '1agent', '-agent', 'agent a', 'agent.a']) {
    assert.match(anchorKeyProblem(bad, []) ?? '', /must start with a letter/, bad)
  }
  assert.equal(anchorKeyProblem('a'.repeat(65), []), 'At most 64 characters.')
  assert.equal(anchorKeyProblem('agent-a', ['agent-a']), 'The anchor agent-a already exists.')
})

test('danglingCount counts only dangling anchors', () => {
  assert.equal(danglingCount([]), 0)
  assert.equal(danglingCount([anchored, unanchored, dangling]), 1)
})

test('anchorsAt finds the keys pointing at one entity, by type and id', () => {
  const second: Anchor = { ...anchored, key: 'agent-b' }
  assert.deepEqual(anchorsAt([anchored, unanchored, second], 'project', 'p-1'), ['agent-a', 'agent-b'])
  assert.deepEqual(anchorsAt([anchored], 'task', 'p-1'), [])
  assert.deepEqual(anchorsAt([anchored], 'project', 'p-2'), [])
})

test('the chip and the delete warning name the anchors', () => {
  assert.equal(anchoredHereText(['agent-a']), 'agent-a is anchored here')
  assert.equal(anchoredHereText(['agent-a', 'agent-b']), 'agent-a and agent-b are anchored here')
  assert.equal(
    anchoredHereText(['agent-a', 'agent-b', 'agent-c']),
    'agent-a, agent-b and agent-c are anchored here',
  )
  assert.equal(danglingWarningText(['agent-a']), 'agent-a is anchored here and will be dangling')
})

test('anchorPlacement covers the three states, a hidden entity and loading', () => {
  const view: AnchorView = { key: 'agent-a', state: 'anchored', visible: true, entity: p1, path: [acme, p1] }
  assert.deepEqual(anchorPlacement(anchored, view, typeName), {
    primary: 'ACME › P1',
    secondary: 'Project · P1',
    tone: 'path',
  })
  assert.deepEqual(anchorPlacement(unanchored, undefined, typeName), {
    primary: 'No restriction, like the plain lens',
    secondary: null,
    tone: 'muted',
  })
  assert.deepEqual(anchorPlacement(dangling, undefined, typeName), {
    primary: 'Project 7f3a… was deleted',
    secondary: 'Every write is refused',
    tone: 'bad',
  })
  // A delete racing the list: the view reports dangling.
  const raced: AnchorView = { key: 'agent-a', state: 'dangling', visible: true, entity: null, path: [] }
  assert.equal(anchorPlacement(anchored, raced, typeName).tone, 'bad')
  const hidden: AnchorView = { key: 'agent-a', state: 'anchored', visible: false, entity: null, path: [] }
  assert.equal(anchorPlacement(anchored, hidden, typeName).primary, 'Hidden by this lens')
  assert.equal(anchorPlacement(anchored, undefined, typeName).primary, '…')
})

test('repointConfirmation names the new and the old path', () => {
  assert.equal(
    repointConfirmation('agent-a', [acme, p1], [acme, p2]),
    'Anchor agent-a at ACME › P2? Was ACME › P1. Its next call works under P2.',
  )
  assert.equal(
    repointConfirmation('agent-a', [], [acme, p2]),
    'Anchor agent-a at ACME › P2? Was an entity this lens hides. Its next call works under P2.',
  )
})

test('unanchorConfirmation names the lens', () => {
  assert.equal(unanchorConfirmation('agent-b', 'work'), 'agent-b will be able to write anywhere in lens work.')
})

test('anchoredMcpUrl extends the runtime MCP URL by the anchor', () => {
  assert.equal(
    anchoredMcpUrl('https://of.example', 'acme-ops', 'work', 'agent-a'),
    'https://of.example/mcp/ontologies/acme-ops/runtime/lenses/work/anchors/agent-a',
  )
  assert.equal(
    anchoredMcpUrl(null, 'acme-ops', 'work', 'agent-a'),
    '<server-url>/mcp/ontologies/acme-ops/runtime/lenses/work/anchors/agent-a',
  )
})

test('the Connect Anchor select: an option label and the line under it, per state', () => {
  const view: AnchorView = { key: 'agent-a', state: 'anchored', visible: true, entity: p1, path: [acme, p1] }
  const hidden: AnchorView = { ...view, visible: false, entity: null, path: [] }
  const goneView: AnchorView = { ...view, state: 'dangling', entity: null, path: [] }

  assert.equal(anchorOptionLabel(anchored, view), 'agent-a · ACME › P1')
  assert.equal(anchorOptionLabel(anchored, undefined), 'agent-a')
  assert.equal(anchorOptionLabel(anchored, hidden), 'agent-a · hidden by this lens')
  assert.equal(anchorOptionLabel(anchored, goneView), 'agent-a · dangling')
  assert.equal(anchorOptionLabel(unanchored, undefined), 'agent-u · unanchored')
  assert.equal(anchorOptionLabel(dangling, undefined), 'agent-d · dangling')

  assert.equal(anchorWritesLine(anchored, view), 'Hierarchy writes only under P1; other types are free.')
  assert.equal(anchorWritesLine(anchored, undefined), null)
  assert.equal(
    anchorWritesLine(anchored, hidden),
    'This lens hides its entity: every write through it is refused.',
  )
  assert.equal(anchorWritesLine(anchored, goneView), 'Its entity was deleted: every write is refused.')
  assert.equal(anchorWritesLine(unanchored, undefined), 'No restriction, like the plain lens.')
  assert.equal(anchorWritesLine(dangling, undefined), 'Its entity was deleted: every write is refused.')
  // B18: the anchor line never says "covers".
  for (const line of [view, hidden, goneView, undefined].map((v) => anchorWritesLine(anchored, v))) {
    assert.doesNotMatch(line ?? '', /cover/i)
  }
})
