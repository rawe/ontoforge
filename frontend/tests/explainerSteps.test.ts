import { test } from 'node:test'
import assert from 'node:assert/strict'
import { FIRST_STEP, advance, goTo, isRunning, togglePlay } from '../src/components/explainer/explainerSteps.ts'

const last = 4

test('an explainer opens on its first step, paused', () => {
  assert.deepEqual(FIRST_STEP, { index: 0, playing: false })
  assert.equal(isRunning(FIRST_STEP, last), false)
})

test('a step chosen by hand stays within the story and stops auto-play', () => {
  assert.deepEqual(goTo(2, last), { index: 2, playing: false })
  assert.deepEqual(goTo(-1, last), { index: 0, playing: false })
  assert.deepEqual(goTo(last + 1, last), { index: last, playing: false })
})

test('auto-play runs until the last step, then stops there', () => {
  let state = togglePlay(FIRST_STEP, last)
  assert.deepEqual(state, { index: 0, playing: true })
  while (isRunning(state, last)) state = advance(state, last)
  assert.deepEqual(state, { index: last, playing: true })
  assert.deepEqual(advance(state, last), state)
})

test('play pauses a running story and resumes on the same step', () => {
  const paused = togglePlay({ index: 2, playing: true }, last)
  assert.deepEqual(paused, { index: 2, playing: false })
  assert.deepEqual(togglePlay(paused, last), { index: 2, playing: true })
})

test('play at the end starts the story over', () => {
  assert.deepEqual(togglePlay({ index: last, playing: false }, last), { index: 0, playing: true })
  assert.deepEqual(togglePlay({ index: last, playing: true }, last), { index: 0, playing: true })
})
