import { test } from 'node:test'
import assert from 'node:assert/strict'
import { EXAMPLE, FLOW, STORY, logUpTo } from '../src/components/anchors/explainer/anchorExplainerStory.ts'

const nodes = new Set(FLOW.nodes.map((node) => node.id))
const edges = new Map(FLOW.edges.map((edge) => [edge.id, edge]))
const entities = new Set<string>(EXAMPLE.entities.map((entity) => entity.id))

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
    if (step.refused) assert.ok(step.nodes.includes(step.refused), `${step.title}: refused off its way`)
    for (const id of [...Object.keys(step.entities), ...Object.keys(step.badges ?? {})]) assert.ok(entities.has(id), `${step.title}: entity ${id}`)
    assert.ok(step.log.length > 0, `${step.title}: logs nothing`)
  }
})

test('with staged-only on, nothing reaches the data but through a person’s commit', () => {
  const stagedOnly = STORY.filter((step) => step.stagedOnly)
  assert.ok(stagedOnly.length > 0)
  for (const step of stagedOnly) {
    assert.ok(!step.edges.includes('write-hold') && !step.edges.includes('hold-data'), step.title)
    if (step.edges.includes('client-write')) assert.equal(step.refused, 'write', step.title)
    if (step.edges.includes('commit-data')) assert.equal(step.actor, 'person', step.title)
  }
  assert.ok(stagedOnly.at(-1)!.edges.includes('commit-data'))
})

test('the anchor and its subtree are in the example, and the log grows with the story', () => {
  assert.ok(entities.has(EXAMPLE.anchor))
  assert.ok(EXAMPLE.subtree.every((id) => entities.has(id)))
  assert.equal(logUpTo(STORY.length - 1).length, STORY.flatMap((step) => step.log).length)
})
