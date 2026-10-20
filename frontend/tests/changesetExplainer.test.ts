import { test } from 'node:test'
import assert from 'node:assert/strict'
import { EXAMPLE, FLOW, ROLES, STORY, logUpTo, passedNodes } from '../src/components/changesets/explainer/changesetExplainerStory.ts'

const nodes = new Set(FLOW.nodes.map((node) => node.id))
const edges = new Map(FLOW.edges.map((edge) => [edge.id, edge]))
const seqs = new Set<number>(EXAMPLE.writes.map((write) => write.seq))

test('every story step points at the workflow, its side’s actions and the example writes', () => {
  for (const edge of FLOW.edges) assert.ok(nodes.has(edge.from) && nodes.has(edge.to), edge.id)
  for (const step of STORY) {
    assert.ok(nodes.has(step.node), `${step.title}: node ${step.node}`)
    assert.ok(ROLES[step.actor].actions.includes(step.action), `${step.title}: ${step.actor} may not ${step.action}`)
    for (const id of step.edges) {
      const edge = edges.get(id)
      assert.ok(edge, `${step.title}: edge ${id}`)
      assert.equal(edge.to, step.node, `${step.title}: edge ${id} ends elsewhere`)
      assert.match(edge.who, new RegExp(step.actor), `${step.title}: ${id} does not name the ${step.actor}`)
    }
    for (const seq of [...step.writes, ...(step.unstaged ?? [])]) assert.ok(seqs.has(seq), `${step.title}: seq ${seq}`)
    assert.ok(step.log.length > 0, `${step.title}: logs nothing`)
  }
})

test('the example starts as a draft at version 1 and ends committed with the version on the screen', () => {
  assert.deepEqual([STORY[0].state, STORY[0].version, STORY[0].edges], ['draft', 1, ['start']])
  const last = STORY.at(-1)!
  assert.equal(last.state, 'committed')
  assert.equal(last.actor, 'person')
  assert.equal(last.version, STORY.at(-2)!.version)
})

test('the version rises with every staged or unstaged write and every submit or unsubmit, never on a read', () => {
  for (let i = 1; i < STORY.length - 1; i++) {
    const [before, step] = [STORY[i - 1], STORY[i]]
    const added = step.writes.filter((seq) => !before.writes.includes(seq)).length
    const removed = before.writes.filter((seq) => !step.writes.includes(seq)).length
    const changes = added + removed + (step.state === before.state ? 0 : 1)
    assert.equal(step.version, before.version + changes, step.title)
  }
})

test('reads see the stored data alone until the commit', () => {
  const stored = STORY[0].stored
  for (const step of STORY.slice(0, -1)) assert.deepEqual(step.stored, stored, step.title)
  assert.notDeepEqual(STORY.at(-1)!.stored, stored)
})

test('the log grows with the story; passed states lead up to the current one', () => {
  assert.equal(logUpTo(STORY.length - 1).length, STORY.flatMap((step) => step.log).length)
  assert.deepEqual([...passedNodes(0)], ['start'])
  assert.ok(passedNodes(STORY.length - 1).has('submitted'))
})
