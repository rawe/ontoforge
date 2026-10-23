import { test } from 'node:test'
import assert from 'node:assert/strict'
import { FLOW, PHASES, STORY, passedNodes } from '../src/components/changesets/explainer/changesetExplainerStory.ts'

const nodes = new Set(FLOW.nodes.map((node) => node.id))
const edges = new Map(FLOW.edges.map((edge) => [edge.id, edge]))

test('every story step points at the workflow', () => {
  for (const edge of FLOW.edges) assert.ok(nodes.has(edge.from) && nodes.has(edge.to), edge.id)
  for (const step of STORY) {
    assert.ok(nodes.has(step.node), `${step.title}: node ${step.node}`)
    for (const id of step.edges) {
      const edge = edges.get(id)
      assert.ok(edge, `${step.title}: edge ${id}`)
      assert.equal(edge.to, step.node, `${step.title}: edge ${id} ends elsewhere`)
      assert.match(edge.who, new RegExp(step.actor), `${step.title}: ${id} does not name the ${step.actor}`)
    }
  }
})

test('one staged object per entity, one value per property; a delete has none', () => {
  for (const step of STORY) {
    const ids = step.objects.map((object) => object.id)
    assert.equal(new Set(ids).size, ids.length, step.title)
    for (const object of step.objects) {
      const keys = object.values.map((value) => value.property)
      assert.equal(new Set(keys).size, keys.length, `${step.title}: ${object.id}`)
      if (object.action === 'delete') assert.deepEqual(object.values, [], `${step.title}: ${object.id}`)
      assert.ok(PHASES.some((phase) => phase.action === object.action), object.action)
    }
  }
})

test('a removed object or a cut value is gone at the next step', () => {
  for (let i = 1; i < STORY.length; i++) {
    const [before, step] = [STORY[i - 1], STORY[i]]
    for (const object of before.objects) {
      const now = step.objects.find((o) => o.id === object.id)
      if (object.removed) assert.equal(now, undefined, `${step.title}: ${object.id}`)
      for (const value of object.values.filter((v) => v.cut)) {
        assert.equal(now?.values.find((v) => v.property === value.property), undefined, `${step.title}: ${value.property}`)
      }
    }
  }
})

test('the example starts as an empty draft at version 1 and ends committed with the version on the screen', () => {
  assert.deepEqual([STORY[0].state, STORY[0].version, STORY[0].edges, STORY[0].objects], ['draft', 1, ['start'], []])
  const last = STORY.at(-1)!
  assert.equal(last.state, 'committed')
  assert.equal(last.actor, 'person')
  assert.equal(last.version, STORY.at(-2)!.version)
})

test('the version rises with every change of the set and every submit or unsubmit, never on a read', () => {
  for (let i = 1; i < STORY.length - 1; i++) {
    const [before, step] = [STORY[i - 1], STORY[i]]
    assert.equal(step.version, before.version + step.changes + (step.state === before.state ? 0 : 1), step.title)
  }
})

test('reads never see a staged value before the commit', () => {
  const committed = STORY.at(-1)!.stored.filter((item) => !STORY[0].stored.includes(item))
  for (const step of STORY.slice(0, -1)) {
    for (const item of committed) assert.ok(!step.stored.includes(item), `${step.title}: ${item}`)
  }
})

test('passed states lead up to the current one', () => {
  assert.deepEqual([...passedNodes(0)], ['start'])
  assert.ok(passedNodes(STORY.length - 1).has('submitted'))
})
