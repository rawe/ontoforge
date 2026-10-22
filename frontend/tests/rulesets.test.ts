import { test } from 'node:test'
import assert from 'node:assert/strict'
import type { PathStep, Ruleset, RulesetView } from '../src/api/types.ts'
import {
  anchoredHereText,
  anchorOptionLabel,
  anchorPlacement,
  anchorsAt,
  anchorWritesLine,
  danglingWarningText,
  DEFAULT_RULES,
  deletedAnchorCount,
  loosenedRules,
  rulesetKeyProblem,
  rulesetMcpUrl,
  rulesetPatch,
  WRITE_ACCESS_LEVELS,
  writeAccessLevel,
} from '../src/components/rulesets/rulesets.ts'

const step = (type: string, id: string, name: string | null): PathStep => ({ type, id, name })
const acme = step('customer', 'c-acme', 'ACME')
const p1 = step('project', 'p-1', 'P1')
const p2 = step('project', 'p-2', 'P2')
const t1 = step('task', 't-1', 'T1')

const found: Ruleset = {
  key: 'agent-a',
  anchor: { type: 'project', id: 'p-1', state: 'found' },
  writeAccess: 'propose',
}
const noAnchor: Ruleset = { key: 'agent-u', anchor: null, writeAccess: 'full' }
const deleted: Ruleset = {
  key: 'agent-d',
  anchor: { type: 'project', id: '7f3a9c00-0000-0000-0000-000000000000', state: 'deleted' },
  writeAccess: 'full',
}
const typeName = (key: string) => ({ project: 'Project', customer: 'Customer' })[key] ?? key

const seen: RulesetView = {
  key: 'agent-a',
  writeAccess: 'propose',
  anchor: { type: 'project', id: 'p-1', name: 'P1', state: 'found', visible: true, path: [acme, p1] },
}
const hidden: RulesetView = {
  ...seen,
  anchor: { type: null, id: null, name: null, state: 'found', visible: false, path: [] },
}
const goneView: RulesetView = {
  ...seen,
  anchor: { type: null, id: null, name: null, state: 'deleted', visible: true, path: [] },
}

test('rulesetKeyProblem mirrors the lens-resource rule, max 64, and refuses an existing key', () => {
  assert.equal(rulesetKeyProblem('agent-a', []), null)
  assert.equal(rulesetKeyProblem('a_1-b', []), null)
  assert.equal(rulesetKeyProblem('a'.repeat(64), []), null)
  assert.equal(rulesetKeyProblem('', []), 'A key is required.')
  for (const bad of ['Agent', '1agent', '-agent', 'agent a', 'agent.a']) {
    assert.match(rulesetKeyProblem(bad, []) ?? '', /must start with a letter/, bad)
  }
  assert.equal(rulesetKeyProblem('a'.repeat(65), []), 'At most 64 characters.')
  assert.equal(rulesetKeyProblem('agent-a', ['agent-a']), 'The ruleset agent-a already exists.')
})

test('the write access levels run none → propose → full, each with its texts', () => {
  assert.deepEqual(
    WRITE_ACCESS_LEVELS.map((l) => l.level),
    ['none', 'propose', 'full'],
  )
  assert.deepEqual(writeAccessLevel('none'), {
    level: 'none',
    title: 'Read only',
    line: 'Reads the lens. Cannot write, cannot stage changes.',
    short: 'Read only: no writes, no changesets.',
  })
  assert.deepEqual(writeAccessLevel('propose'), {
    level: 'propose',
    title: 'Proposes changes',
    line: 'Stages writes into a changeset and submits it. Cannot write at once or commit: a person commits.',
    short: 'Stages writes into a changeset and submits it; a person commits.',
  })
  assert.deepEqual(writeAccessLevel('full'), {
    level: 'full',
    title: 'Writes as the lens allows',
    line: 'Writes at once or through a changeset, and commits.',
    short: 'Writes as the lens allows, at once or through a changeset.',
  })
  assert.equal(DEFAULT_RULES.writeAccess, 'full')
  assert.equal(DEFAULT_RULES.anchor, null)
})

test('deletedAnchorCount counts only deleted anchors', () => {
  assert.equal(deletedAnchorCount([]), 0)
  assert.equal(deletedAnchorCount([found, noAnchor, deleted]), 1)
})

test('anchorsAt finds the keys whose anchor is one entity, by type and id', () => {
  const second: Ruleset = { ...found, key: 'agent-b' }
  assert.deepEqual(anchorsAt([found, noAnchor, second], 'project', 'p-1'), ['agent-a', 'agent-b'])
  assert.deepEqual(anchorsAt([found], 'task', 'p-1'), [])
  assert.deepEqual(anchorsAt([found], 'project', 'p-2'), [])
})

test('the chip and the delete warning name the rulesets', () => {
  assert.equal(anchoredHereText(['agent-a']), 'agent-a is anchored here')
  assert.equal(anchoredHereText(['agent-a', 'agent-b']), 'agent-a and agent-b are anchored here')
  assert.equal(
    anchoredHereText(['agent-a', 'agent-b', 'agent-c']),
    'agent-a, agent-b and agent-c are anchored here',
  )
  assert.equal(danglingWarningText(['agent-a']), 'agent-a is anchored here and will be dangling')
})

test('anchorPlacement: found, no anchor, deleted, hidden and loading', () => {
  assert.deepEqual(anchorPlacement(found, seen, typeName), {
    kind: 'path',
    primary: 'ACME › P1',
    secondary: 'Project · P1',
  })
  assert.deepEqual(anchorPlacement(noAnchor, undefined, typeName), {
    kind: 'none',
    primary: 'No anchor',
    secondary: null,
  })
  assert.deepEqual(anchorPlacement(deleted, undefined, typeName), {
    kind: 'deleted',
    primary: 'Project 7f3a… was deleted',
    secondary: 'Every write is refused',
  })
  // A delete racing the list: the view reports deleted.
  assert.equal(anchorPlacement(found, goneView, typeName).kind, 'deleted')
  assert.deepEqual(anchorPlacement(found, hidden, typeName), {
    kind: 'hidden',
    primary: 'Hidden by this lens',
    secondary: 'Writes through this lens are refused',
  })
  assert.deepEqual(anchorPlacement(found, undefined, typeName), { kind: 'loading', primary: '…', secondary: null })
})

test('rulesetPatch sends only the rules that changed', () => {
  const stored = { writeAccess: 'propose' as const, anchor: { type: 'project', id: 'p-1' } }
  assert.deepEqual(rulesetPatch(DEFAULT_RULES, DEFAULT_RULES), {})
  assert.deepEqual(rulesetPatch(stored, { ...stored, anchor: { type: 'project', id: 'p-1' } }), {})
  assert.deepEqual(rulesetPatch(stored, { ...stored, writeAccess: 'none' }), { writeAccess: 'none' })
  assert.deepEqual(rulesetPatch(stored, { ...stored, anchor: null }), { anchor: null })
  assert.deepEqual(rulesetPatch(stored, { ...stored, anchor: { type: 'project', id: 'p-2' } }), {
    anchor: { type: 'project', id: 'p-2' },
  })
  assert.deepEqual(rulesetPatch(DEFAULT_RULES, { writeAccess: 'none', anchor: { type: 'project', id: 'p-1' } }), {
    writeAccess: 'none',
    anchor: { type: 'project', id: 'p-1' },
  })
})

test('loosenedRules: one line per loosened rule, none when a save only tightens', () => {
  const paths = { lensKey: 'work', fromPath: [acme, p1], toPath: [acme, p2] }
  const lines = (ruleset: Ruleset, patch: Parameters<typeof loosenedRules>[1], p = paths) =>
    loosenedRules(ruleset, patch, p).map((l) => `${l.rule}: ${l.text}`)

  // Raising write access.
  assert.deepEqual(lines({ ...found, writeAccess: 'none' }, { writeAccess: 'propose' }), [
    'Write access: raised to propose. agent-a will be able to stage and submit changesets.',
  ])
  assert.deepEqual(lines(found, { writeAccess: 'full' }), [
    'Write access: raised to full. agent-a will write at once, and it can commit.',
  ])
  assert.deepEqual(lines({ ...found, writeAccess: 'none' }, { writeAccess: 'full' }), [
    'Write access: raised to full. agent-a will write at once, and it can commit.',
  ])
  // Moving and removing the anchor, together with a raise: write access first.
  assert.deepEqual(lines(found, { writeAccess: 'full', anchor: { type: 'project', id: 'p-2' } }), [
    'Write access: raised to full. agent-a will write at once, and it can commit.',
    'Anchor: moves from ACME › P1 to ACME › P2. Its next call works under P2.',
  ])
  assert.deepEqual(lines(found, { anchor: null }), [
    'Anchor: removed. agent-a will be able to write anywhere in lens work.',
  ])
  assert.deepEqual(lines(deleted, { anchor: null }), [
    'Anchor: removed. agent-d will be able to write anywhere in lens work.',
  ])
  // The old anchor hidden by the lens.
  assert.deepEqual(lines(found, { anchor: { type: 'project', id: 'p-2' } }, { ...paths, fromPath: [] }), [
    'Anchor: moves from an entity this lens hides to ACME › P2. Its next call works under P2.',
  ])

  // Tightening saves at once.
  assert.deepEqual(lines(found, {}), [])
  assert.deepEqual(lines(found, { writeAccess: 'none' }), [])
  assert.deepEqual(lines(noAnchor, { anchor: { type: 'project', id: 'p-1' } }), [])
  // Narrowing into the subtree.
  assert.deepEqual(
    lines(found, { anchor: { type: 'task', id: 't-1' } }, { ...paths, toPath: [acme, p1, t1] }),
    [],
  )
  // Re-pointing a deleted anchor, which refused every write.
  assert.deepEqual(lines(deleted, { anchor: { type: 'project', id: 'p-2' } }, { ...paths, fromPath: [] }), [])
})

test('rulesetMcpUrl extends the runtime MCP URL by the ruleset', () => {
  assert.equal(
    rulesetMcpUrl('https://of.example', 'acme-ops', 'work', 'agent-a'),
    'https://of.example/mcp/ontologies/acme-ops/runtime/lenses/work/rulesets/agent-a',
  )
  assert.equal(
    rulesetMcpUrl(null, 'acme-ops', 'work', 'agent-a'),
    '<server-url>/mcp/ontologies/acme-ops/runtime/lenses/work/rulesets/agent-a',
  )
})

test('the Connect select: an option label and the line under it, per anchor state', () => {
  assert.equal(anchorOptionLabel(found, seen), 'agent-a · ACME › P1')
  assert.equal(anchorOptionLabel(found, undefined), 'agent-a')
  assert.equal(anchorOptionLabel(found, hidden), 'agent-a · hidden by this lens')
  assert.equal(anchorOptionLabel(found, goneView), 'agent-a · deleted')
  assert.equal(anchorOptionLabel(noAnchor, undefined), 'agent-u · no anchor')
  assert.equal(anchorOptionLabel(deleted, undefined), 'agent-d · deleted')

  assert.equal(anchorWritesLine(found, seen), 'Hierarchy writes only under P1; other types are free.')
  assert.equal(anchorWritesLine(found, undefined), null)
  assert.equal(
    anchorWritesLine(found, hidden),
    'This lens hides its entity: every write through it is refused.',
  )
  assert.equal(anchorWritesLine(found, goneView), 'Its entity was deleted: every write is refused.')
  assert.equal(anchorWritesLine(noAnchor, undefined), 'No restriction, like the plain lens.')
  assert.equal(anchorWritesLine(deleted, undefined), 'Its entity was deleted: every write is refused.')
  // B18: the anchor line never says "covers".
  for (const line of [seen, hidden, goneView, undefined].map((v) => anchorWritesLine(found, v))) {
    assert.doesNotMatch(line ?? '', /cover/i)
  }
})
