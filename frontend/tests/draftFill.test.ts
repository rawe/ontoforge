import { test } from 'node:test'
import assert from 'node:assert/strict'
import {
  aiMarks, applyFill, changedFields, isStale, proposalOf, undoFill, type DraftProposal, type DraftState,
} from '../src/assistants/draft/draftFillModel.ts'

const fields = { name: 'Support', description: '', systemPrompt: 'Be brief.', tools: ['get_schema'] as string[] | null }
const open: DraftState = { ontologyKey: 'fair', target: { lensKey: 'hr', agentKey: 'support' }, version: 7, fields }
const proposal: DraftProposal = {
  target: { lensKey: 'hr', agentKey: 'support' }, sourceVersion: 7, fields: { name: 'Helpdesk', tools: ['search', 'get_entity'] },
}

test('reads a draft proposal from the tool result, and nothing else', () => {
  assert.deepEqual(proposalOf(proposal), proposal)
  assert.deepEqual(proposalOf({ ...proposal, target: { lensKey: 'hr', agentKey: null } })?.target, { lensKey: 'hr', agentKey: null })
  assert.equal(proposalOf({ error: { message: 'no' } }), null)
  assert.equal(proposalOf({ ...proposal, sourceVersion: '7' }), null)
  assert.equal(proposalOf(null), null)
})

test('a proposal fits only the same editor at the same version', () => {
  assert.equal(isStale(open, 'fair', proposal), false)
  assert.equal(isStale(null, 'fair', proposal), true)
  assert.equal(isStale({ ...open, version: 8 }, 'fair', proposal), true)
  assert.equal(isStale(open, 'other', proposal), true)
  assert.equal(isStale({ ...open, target: { lensKey: 'hr', agentKey: 'other' } }, 'fair', proposal), true)
  assert.equal(isStale({ ...open, target: { lensKey: 'sales', agentKey: 'support' } }, 'fair', proposal), true)
  // A new agent's session is only its own: the version never repeats across sessions.
  const draftOfNew = { ...open, target: { lensKey: 'hr', agentKey: null } }
  assert.equal(isStale(draftOfNew, 'fair', proposal), true)
  assert.equal(isStale(draftOfNew, 'fair', { ...proposal, target: { lensKey: 'hr', agentKey: null } }), false)
})

test('the diff lists the fields the proposal changes; a list is a set', () => {
  assert.deepEqual(changedFields(fields, { name: 'Support', tools: ['get_schema'], systemPrompt: 'Be kind.' }), ['systemPrompt'])
  assert.deepEqual(changedFields(fields, { tools: null, unknown: 'x' }), ['tools'])
  assert.deepEqual(changedFields({ ...fields, tools: ['a', 'b'] }, { tools: ['b', 'a'] }), [])
})

test('a fill changes the proposed fields and records each before and after', () => {
  const { fields: next, edit } = applyFill(fields, proposal.fields, {})
  assert.deepEqual(next, { ...fields, name: 'Helpdesk', tools: ['search', 'get_entity'] })
  assert.deepEqual(edit, {
    name: { before: 'Support', after: 'Helpdesk' },
    tools: { before: ['get_schema'], after: ['search', 'get_entity'] },
  })
  assert.deepEqual(Object.keys(aiMarks(next, edit)), ['name', 'tools'])
  // An unchanged proposed field gets no mark.
  assert.deepEqual(applyFill(fields, { name: 'Support' }, {}).edit, {})
})

test('a second fill keeps the value from before the first for a field the person left alone', () => {
  const first = applyFill(fields, { name: 'Helpdesk', description: 'HR' }, {})
  const person = { ...first.fields, description: 'Own words' }
  const second = applyFill(person, { name: 'Help desk', description: 'HR again' }, first.edit)
  assert.deepEqual(second.edit.name, { before: 'Support', after: 'Help desk' })
  assert.deepEqual(second.edit.description, { before: 'Own words', after: 'HR again' })
  // Back at the value from before: no AI change.
  assert.equal(applyFill(second.fields, { name: 'Support' }, second.edit).edit.name, undefined)
})

test('undo restores the AI-changed fields and keeps those the person edited since', () => {
  const { fields: filled, edit } = applyFill(fields, { name: 'Helpdesk', systemPrompt: 'Answer from the schema.', tools: null }, {})
  const edited = { ...filled, systemPrompt: 'My own prompt.' }
  assert.deepEqual(Object.keys(aiMarks(edited, edit)), ['name', 'tools'])
  assert.deepEqual(undoFill(edited, edit), { ...fields, systemPrompt: 'My own prompt.' })
  assert.deepEqual(undoFill(fields, {}), fields)
})
