import { test } from 'node:test'
import assert from 'node:assert/strict'
import {
  diagnosticsOf, mergeDiagnostics, stepTotals, usageParts, type DiagnosticsStep,
} from '../src/assistants/diagnostics/diagnostics.ts'

const step = (index: number, extra: Partial<DiagnosticsStep> = {}): DiagnosticsStep => ({ index, startMs: 10 * index, durationMs: 5, ...extra })

test('merge: steps upsert by index and stay in index order; the turn\'s time replaces', () => {
  let d = mergeDiagnostics({}, { steps: [step(2, { name: 'search' })] })
  d = mergeDiagnostics(d, { steps: [step(1, { model: true })] })
  d = mergeDiagnostics(d, { steps: [step(2, { name: 'search', failed: true })] })
  assert.deepEqual(d.steps?.map((s) => [s.index, s.name, s.failed]), [[1, undefined, undefined], [2, 'search', true]])
  assert.equal(d.durationMs, undefined)
  d = mergeDiagnostics(d, { durationMs: 40 })
  d = mergeDiagnostics(d, { durationMs: 41 })
  assert.equal(d.durationMs, 41)
  // An event without steps leaves them as they were.
  assert.equal(mergeDiagnostics(d, { durationMs: 42 }).steps, d.steps)
})

test('diagnosticsOf keeps the steps and the time, without the event type', () => {
  assert.deepEqual(diagnosticsOf({ type: 'diagnostics', steps: [step(1)] }), { steps: [step(1)] })
  assert.deepEqual(diagnosticsOf({ type: 'diagnostics', durationMs: 7 }), { durationMs: 7 })
})

test('totals: model calls are the model steps, failed counts every failed step, each token field summed over the steps that reported it', () => {
  const totals = stepTotals([
    step(1, { model: true, usage: { input: 5210, output: 31, cacheRead: 4800 } }),
    step(2, { name: 'get_entity', failed: true }),
    step(3, { model: true, usage: { input: 100, output: 0, cacheWrite: 0 } }),
    step(4, { model: true, failed: true }),
  ])
  assert.deepEqual(totals, { modelCalls: 3, failed: 2, usage: { input: 5310, output: 31, cacheRead: 4800, cacheWrite: 0 } })
  assert.deepEqual(stepTotals([step(1, { model: true })]).usage, {})
})

test('usage parts show only what was reported, a reported 0 included', () => {
  assert.deepEqual(usageParts({ input: 5210, output: 312, cacheRead: 4800, cacheWrite: 0 }), ['5,210 in', '312 out', '4,800 cache read', '0 cache write'])
  assert.deepEqual(usageParts({ output: 0 }), ['0 out'])
  assert.deepEqual(usageParts({}), [])
  assert.deepEqual(usageParts(undefined), [])
})
