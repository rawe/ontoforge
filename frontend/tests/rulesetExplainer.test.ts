import { test } from 'node:test'
import assert from 'node:assert/strict'
import { EXAMPLE, FLOW, RULE_IDS, STORY, ladder, logUpTo } from '../src/components/rulesets/explainer/rulesetExplainerStory.ts'

const nodes = new Set(FLOW.nodes.map((node) => node.id))
const edges = new Map(FLOW.edges.map((edge) => [edge.id, edge]))
const entities = new Set<string>(EXAMPLE.entities.map((entity) => entity.id))
const reachesData = (step: (typeof STORY)[number]) => step.edges.map((id) => edges.get(id)!).filter((edge) => edge.to === 'data')

test('every story step points at the flow and the example hierarchy, and its edges join its nodes', () => {
  for (const edge of FLOW.edges) assert.ok(nodes.has(edge.from) && nodes.has(edge.to), edge.id)
  for (const [from, to] of EXAMPLE.links) assert.ok(entities.has(from) && entities.has(to), `${from}-${to}`)
  for (const step of STORY) {
    for (const id of step.nodes) assert.ok(nodes.has(id), `${step.title}: node ${id}`)
    for (const id of step.edges) {
      const edge = edges.get(id)
      assert.ok(edge, `${step.title}: edge ${id}`)
      assert.ok(step.nodes.includes(edge.from) && step.nodes.includes(edge.to), `${step.title}: ${id} leaves its nodes`)
    }
    for (const id of [...Object.keys(step.entities), ...Object.keys(step.badges ?? {})]) assert.ok(entities.has(id), `${step.title}: entity ${id}`)
  }
})

test('every refused node lies on the step’s way, where a lit edge ends', () => {
  for (const step of STORY) {
    for (const id of step.refused ?? []) {
      assert.ok(step.nodes.includes(id), `${step.title}: ${id} off its way`)
      assert.ok(step.edges.some((edge) => edges.get(edge)!.to === id), `${step.title}: no lit edge ends at ${id}`)
    }
  }
})

test('at none no client edge reaches the data; at propose only a person’s commit does', () => {
  const none = STORY.filter((step) => step.writeAccess === 'none')
  const propose = STORY.filter((step) => step.writeAccess === 'propose')
  assert.ok(none.length > 0 && propose.length > 0)
  for (const step of none) {
    assert.deepEqual(reachesData(step).filter((edge) => edge.lane === 'client'), [], step.title)
    for (const edge of step.edges.map((id) => edges.get(id)!).filter((e) => e.from === 'client')) {
      assert.ok(step.refused?.includes(edge.to), `${step.title}: ${edge.id} not refused`)
    }
  }
  for (const step of propose) {
    for (const edge of reachesData(step)) assert.equal(edge.id, 'commit-data', step.title)
    if (step.edges.includes('client-write')) assert.ok(step.refused?.includes('write'), step.title)
  }
  assert.ok(propose.some((step) => step.edges.includes('commit-data')), 'no propose step shows the person’s commit')
})

test('the story tells the ruleset, then write access, then the anchor, then both, then the escapes', () => {
  assert.equal(STORY.length, 11)
  assert.deepEqual(STORY.map((step) => step.rule), [
    'ruleset', 'writeAccess', 'writeAccess', 'writeAccess', 'writeAccess',
    'anchor', 'anchor', 'anchor', 'both', 'anchor', 'escapes',
  ])
  assert.deepEqual(STORY.slice(1, 5).map((step) => step.writeAccess), ['full', 'propose', 'propose', 'none'])
  assert.ok(STORY.slice(0, 5).every((step) => step.anchor === 'none'))
  assert.ok(STORY.slice(5, 10).every((step) => step.anchor === 'found' || step.anchor === 'deleted'))
  assert.ok(STORY.slice(0, 10).every((step) => step.writeAccess !== null), 'a rule step without a level')
  assert.equal(STORY[10].writeAccess, null, 'the escapes step shows no level')
  assert.equal(STORY[10].anchor, null, 'the escapes step shows no anchor')
})

test('every step’s rule is a rule with a card, or one of the story-wide cards, and every rule has its steps', () => {
  const rules = new Set<string>(RULE_IDS)
  for (const step of STORY) {
    assert.ok(rules.has(step.rule) || ['ruleset', 'both', 'escapes'].includes(step.rule), `${step.title}: rule ${step.rule}`)
  }
  for (const id of RULE_IDS) assert.ok(STORY.some((step) => step.rule === id), `no step about ${id}`)
})

test('the staircase marks the current level and strikes what the levels above add; with no level, neither', () => {
  assert.deepEqual(ladder('none').map((s) => [s.level, s.place]), [['none', 'current'], ['propose', 'above'], ['full', 'above']])
  assert.deepEqual(ladder('propose').map((s) => [s.level, s.place]), [['none', 'below'], ['propose', 'current'], ['full', 'above']])
  assert.deepEqual(ladder('full').map((s) => [s.level, s.place]), [['none', 'below'], ['propose', 'below'], ['full', 'current']])
  assert.deepEqual(ladder(null).map((s) => s.place), ['unset', 'unset', 'unset'])
  assert.deepEqual(ladder('propose').map((s) => s.adds), ['read', '+ stage, submit', '+ write at once, commit'])
})

test('the anchor and its subtree are in the example, and the log grows with the story', () => {
  assert.ok(entities.has(EXAMPLE.anchor))
  assert.ok(EXAMPLE.subtree.every((id) => entities.has(id)))
  assert.ok(EXAMPLE.free.every((id) => entities.has(id) && !(EXAMPLE.subtree as readonly string[]).includes(id)))
  assert.equal(logUpTo(STORY.length - 1).length, STORY.flatMap((step) => step.log).length)
})
