import { test } from 'node:test'
import assert from 'node:assert/strict'
import { EXAMPLE, EXPLAINERS, litEdges, logUpTo, passedNodes } from '../src/components/assistants/explainers/assistantExplainerStories.ts'

const entityIds = new Set<string>(EXAMPLE.entities.map((entity) => entity.id))
const linkIds = new Set<string>(EXAMPLE.links.map((link) => link.id))

for (const explainer of Object.values(EXPLAINERS)) {
  test(`${explainer.kind}: every story step points at its own flow, the example graph and its settings`, () => {
    const nodes = new Set(explainer.flow.nodes.map((node) => node.id))
    const edges = new Set(explainer.flow.edges.map((edge) => edge.id))
    const settings = new Set(explainer.settings.map((setting) => setting.label))
    for (const edge of explainer.flow.edges) assert.ok(nodes.has(edge.from) && nodes.has(edge.to), edge.id)
    for (const step of explainer.story) {
      assert.ok(nodes.has(step.node), `${step.title}: node ${step.node}`)
      for (const id of step.edges ?? []) assert.ok(edges.has(id), `${step.title}: edge ${id}`)
      for (const label of step.settings) assert.ok(settings.has(label), `${step.title}: setting ${label}`)
      for (const id of [...Object.keys(step.entities), ...Object.keys(step.badges ?? {}), ...(step.frame?.around ?? [])]) assert.ok(entityIds.has(id), `${step.title}: entity ${id}`)
      for (const id of Object.keys(step.links)) assert.ok(linkIds.has(id), `${step.title}: link ${id}`)
      assert.ok(step.log.length > 0, `${step.title}: logs nothing`)
    }
  })

  test(`${explainer.kind}: the flow runs from the question to the reply, and every setting steers a step`, () => {
    assert.deepEqual(litEdges(explainer, 0).map((id) => explainer.flow.edges.find((edge) => edge.id === id)!.from), ['question'])
    const last = explainer.story.length - 1
    assert.ok(litEdges(explainer, last).some((id) => explainer.flow.edges.find((edge) => edge.id === id)!.to === 'reply'))
    assert.ok(passedNodes(explainer, last).has('reply'))
    assert.ok(!passedNodes(explainer, 0).has('reply'))
    for (const setting of explainer.settings) assert.ok(explainer.story.some((step) => step.settings.includes(setting.label)), setting.label)
  })
}

test('the run log grows with the story and remembers the step of each entry', () => {
  const navigator = EXPLAINERS.navigators
  assert.deepEqual(logUpTo(navigator, 0).map((entry) => entry.step), [0, 0])
  assert.equal(logUpTo(navigator, navigator.story.length - 1).length, navigator.story.flatMap((step) => step.log).length)
})

test('the retriever and the navigator call the model twice, in their first and last step', () => {
  for (const explainer of [EXPLAINERS.retrievers, EXPLAINERS.navigators]) {
    const model = explainer.flow.nodes.filter((node) => node.role === 'model').map((node) => node.id)
    assert.equal(model.length, 2)
    assert.deepEqual([explainer.story[0].node, explainer.story.at(-1)!.node], model)
  }
})
