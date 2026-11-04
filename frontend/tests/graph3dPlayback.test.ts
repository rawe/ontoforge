import assert from 'node:assert/strict'
import test from 'node:test'
import { PlaybackClock } from '../src/components/graph3d/playback.ts'

test('pausing preserves both camera-flight progress and the remaining tour dwell', () => {
  const clock = new PlaybackClock()
  const flightStart = clock.time(1000)
  clock.pause(1400)
  assert.equal(clock.time(9000) - flightStart, 400)
  clock.resume(10000)
  assert.equal(clock.time(10000) - flightStart, 400)
  assert.equal(clock.time(10850) - flightStart, 1250)
  assert.equal(clock.time(15599) - flightStart < 6000, true)
  assert.equal(clock.time(15600) - flightStart, 6000)
})

test('repeated pause/resume calls are idempotent and multiple pauses do not restart playback', () => {
  const clock = new PlaybackClock()
  clock.pause(100)
  clock.pause(200)
  assert.equal(clock.time(1000), 100)
  clock.resume(1000)
  clock.resume(1100)
  assert.equal(clock.time(1200), 300)
  clock.pause(1200)
  clock.resume(2200)
  assert.equal(clock.time(2300), 400)
  assert.equal(clock.paused, false)
})
