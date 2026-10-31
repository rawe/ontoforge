import { test } from 'node:test'
import assert from 'node:assert/strict'
import { EXPIRED_TEXT, pendingTurn, type Turn } from '../src/assistants/conversation/chatModel.ts'
import { conversationReducer, startConversation, type Conversation } from '../src/assistants/conversation/conversation.ts'

const turn = (id: string, patch: Partial<Turn<null>> = {}): Turn<null> => ({ ...pendingTurn(id, `q ${id}`, null, 0), ...patch })
const reduce = conversationReducer<null>

test('a conversation with a remembered thread restores before anything can be sent; one without starts ready', () => {
  assert.deepEqual(startConversation(true), { turns: [], restoring: true, notice: null })
  assert.equal(startConversation(false).restoring, false)
})

test('restored: the thread’s turns; an expired thread says so', () => {
  const restored = [turn('a', { status: 'complete', restored: true })]
  assert.deepEqual(reduce(startConversation(true), { type: 'restored', turns: restored, expired: false }), { turns: restored, restoring: false, notice: null })
  assert.deepEqual(reduce(startConversation(true), { type: 'restored', turns: [], expired: true }), { turns: [], restoring: false, notice: EXPIRED_TEXT })
})

test('a failed restore stops restoring and explains, keeping what is there', () => {
  const state = reduce(startConversation(true), { type: 'restoreFailed', error: 'offline' })
  assert.deepEqual(state, { turns: [], restoring: false, notice: 'Could not restore the conversation: offline' })
})

test('sending appends the turn and clears the notice; updates replace the turn by id', () => {
  let state: Conversation<null> = { turns: [turn('a', { status: 'complete' })], restoring: false, notice: EXPIRED_TEXT }
  state = reduce(state, { type: 'sent', turn: turn('b') })
  assert.deepEqual(state.turns.map((t) => t.id), ['a', 'b'])
  assert.equal(state.notice, null)
  state = reduce(state, { type: 'updated', turn: turn('b', { reply: 'Hi', status: 'complete' }) })
  assert.deepEqual(state.turns.map((t) => [t.id, t.reply, t.status]), [['a', '', 'complete'], ['b', 'Hi', 'complete']])
  // An update for a turn no longer there (the conversation started over) changes nothing.
  assert.deepEqual(reduce({ ...state, turns: [] }, { type: 'updated', turn: turn('b') }).turns, [])
})

test('an expired thread empties the conversation and says so; "New conversation" empties it silently', () => {
  const state: Conversation<null> = { turns: [turn('a')], restoring: false, notice: 'x' }
  assert.deepEqual(reduce(state, { type: 'expired' }), { turns: [], restoring: false, notice: EXPIRED_TEXT })
  assert.deepEqual(reduce(state, { type: 'cleared' }), { turns: [], restoring: false, notice: null })
})
