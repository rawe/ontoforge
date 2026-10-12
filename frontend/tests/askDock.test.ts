import { test } from 'node:test'
import assert from 'node:assert/strict'
import {
  DEFAULT_SETTINGS,
  MAX_WIDTH,
  chooseAssistant,
  choiceValue,
  parseChoice,
  parseSettings,
} from '../src/components/explore/askDockModel.ts'

/* --------------------------------- settings -------------------------------- */

test('settings: nothing or something malformed remembered reads as the defaults', () => {
  assert.deepEqual(parseSettings(null), DEFAULT_SETTINGS)
  assert.deepEqual(parseSettings('open'), DEFAULT_SETTINGS)
  assert.deepEqual(parseSettings([]), DEFAULT_SETTINGS)
  assert.deepEqual(parseSettings({}), DEFAULT_SETTINGS)
})

test('settings: a setting from before kinds keeps its navigator', () => {
  assert.deepEqual(
    parseSettings({ open: true, width: 420, assistant: 'hall_guide', autoAdd: true }),
    { open: true, width: 420, kind: 'navigators', assistant: 'hall_guide', autoAdd: true },
  )
})

test('settings: the kind and assistant read back; an unknown kind drops its assistant', () => {
  assert.deepEqual(parseSettings({ kind: 'agents', assistant: 'helper' }), { ...DEFAULT_SETTINGS, kind: 'agents', assistant: 'helper' })
  assert.deepEqual(parseSettings({ kind: 'oracles', assistant: 'x' }), DEFAULT_SETTINGS)
  assert.deepEqual(parseSettings({ kind: 'retrievers', assistant: 7 }), { ...DEFAULT_SETTINGS, kind: 'retrievers' })
  assert.equal(parseSettings({ width: 5000 }).width, MAX_WIDTH)
})

/* --------------------------------- choosing -------------------------------- */

const items = (...keys: string[]) => keys.map((key) => ({ key }))

test('choosing: the remembered assistant when its kind still lists it', () => {
  const lists = { navigators: items('_default'), agents: items('_default', 'helper') }
  assert.deepEqual(chooseAssistant(lists, { kind: 'agents', key: 'helper' }), { kind: 'agents', key: 'helper' })
})

test('choosing: a gone one falls back to its kind\'s Default, else its first', () => {
  assert.deepEqual(chooseAssistant({ retrievers: items('a', '_default') }, { kind: 'retrievers', key: 'gone' }), { kind: 'retrievers', key: '_default' })
  assert.deepEqual(chooseAssistant({ retrievers: items('a', 'b') }, { kind: 'retrievers', key: 'gone' }), { kind: 'retrievers', key: 'a' })
})

test('choosing: a kind without assistants, or not read, falls back to the first kind that has any', () => {
  const lists = { navigators: items(), retrievers: undefined, agents: items('helper', '_default') }
  assert.deepEqual(chooseAssistant(lists, { kind: 'retrievers', key: 'x' }), { kind: 'agents', key: '_default' })
  assert.deepEqual(chooseAssistant({ navigators: items(), agents: items() }, { kind: 'navigators', key: '_default' }), null)
})

test('a choice as a picker value and back; a key may hold a colon', () => {
  assert.deepEqual(parseChoice(choiceValue({ kind: 'agents', key: 'a:b' })), { kind: 'agents', key: 'a:b' })
  assert.equal(parseChoice('oracles:x'), null)
  assert.equal(parseChoice('agents'), null)
})
