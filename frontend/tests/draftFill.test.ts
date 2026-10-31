import { test } from 'node:test'
import assert from 'node:assert/strict'
import {
  aiMarks, applyFill, changedFields, fillRefusal, isStale, proposalOf, undoFill, withoutEdited,
  type AiEdit, type DraftProposal, type DraftState,
} from '../src/assistants/draft/draftFillModel.ts'
import {
  agentFields, draftOf, sameDraft, withAgentFields, withKey, withName, type AgentDraft,
} from '../src/components/studio/assistants/agentDraft.ts'

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

test('the editor refuses a fill while it saves or deletes, and a stale one as stale', () => {
  assert.equal(fillRefusal(open, false, 'fair', proposal), null)
  assert.equal(fillRefusal(open, true, 'fair', proposal), 'busy')
  assert.equal(fillRefusal({ ...open, version: 8 }, true, 'fair', proposal), 'stale')
  assert.equal(fillRefusal(null, false, 'fair', proposal), 'stale')
})

// The agent editor's draft as `useDraftFill` keeps it: a fill, the person's change, undo.
interface Editor { draft: AgentDraft; edit: AiEdit }
const fillAgent = (s: Editor, proposed: Record<string, unknown>): Editor => {
  const filled = applyFill(agentFields(s.draft), proposed, s.edit)
  return { draft: withAgentFields(s.draft, filled.fields), edit: filled.edit }
}
const personChange = (s: Editor, next: (d: AgentDraft) => AgentDraft): Editor => {
  const draft = next(s.draft)
  return { draft, edit: withoutEdited(s.edit, agentFields(s.draft), agentFields(draft)) }
}
const undoAgent = (s: Editor): Editor => ({ draft: withAgentFields(s.draft, undoFill(agentFields(s.draft), s.edit)), edit: {} })

test('a field the person edits is theirs for good, even back at the AI value; others stay undoable', () => {
  const saved = draftOf({ key: 'support', name: 'Support', description: null, systemPrompt: 'Be brief.', tools: ['get_schema'] })
  let s = fillAgent({ draft: saved, edit: {} }, { name: 'Helpdesk', systemPrompt: 'Answer.', tools: ['search'] })
  s = personChange(s, (d) => withName(d, 'Help desk'))
  s = personChange(s, (d) => withName(d, 'Helpdesk'))
  s = personChange(s, (d) => ({ ...d, allTools: true }))
  s = personChange(s, (d) => ({ ...d, allTools: false }))
  assert.deepEqual(Object.keys(aiMarks(agentFields(s.draft), s.edit)), ['systemPrompt'])
  const undone = undoAgent(s).draft
  assert.equal(undone.name, 'Helpdesk')
  assert.deepEqual(undone.tools, ['search'])
  assert.equal(undone.systemPrompt, 'Be brief.')
})

test("a new agent's key follows a typed or filled name until the person edits the key; undo follows only then", () => {
  const typed = { draft: withName(draftOf(null), 'Support'), edit: {} }
  assert.equal(typed.draft.key, 'support')
  const filled = fillAgent(typed, { name: 'Helpdesk' })
  assert.equal(filled.draft.key, 'helpdesk')
  assert.deepEqual(undoAgent(filled).draft, typed.draft)
  // The key edited after the fill: undo restores the name, the person's key stays.
  const ownKey = personChange(filled, (d) => withKey(d, 'desk'))
  assert.deepEqual(ownKey.edit, filled.edit)
  assert.equal(sameDraft(ownKey.draft, filled.draft), false)
  assert.deepEqual(undoAgent(ownKey).draft, { ...typed.draft, key: 'desk', keyTouched: true })
  // A key the person set back to the derived value still does not follow.
  const chosen = { draft: withKey(withName(draftOf(null), 'Support'), 'support'), edit: {} }
  assert.equal(fillAgent(chosen, { name: 'Helpdesk' }).draft.key, 'support')
  assert.equal(withName(chosen.draft, 'Other').key, 'support')
})
