import { test } from 'node:test'
import assert from 'node:assert/strict'
import {
  checkDiagnostics, diagnosticsOf, mergeDiagnostics, modelCallTotals, usageParts, type ModelCall,
} from '../src/assistants/diagnostics/diagnostics.ts'

const call = (index: number, extra: Partial<ModelCall> = {}): ModelCall => ({ index, durationMs: 10 * index, ...extra })

test('merge: model calls upsert by index in index order, timings merge by key, limitations dedupe, other fields replace', () => {
  let d = mergeDiagnostics({}, { modelCalls: [call(2, { name: 'answer' })] })
  d = mergeDiagnostics(d, { modelCalls: [call(1, { name: 'plan' })], timings: { plan: 5 }, limitations: ['a'], plan: { subQueries: [] } })
  d = mergeDiagnostics(d, { modelCalls: [call(2, { name: 'answer', failed: true })], timings: { answer: 7, plan: 6 }, limitations: ['a', 'b'], plan: { subQueries: [{}] } })
  assert.deepEqual(d.modelCalls?.map((c) => [c.index, c.name, c.failed]), [[1, 'plan', undefined], [2, 'answer', true]])
  assert.deepEqual(d.timings, { plan: 6, answer: 7 })
  assert.deepEqual(d.limitations, ['a', 'b'])
  assert.deepEqual(d.plan, { subQueries: [{}] })
  // An event without a field leaves it as it was.
  assert.equal(mergeDiagnostics(d, { searchCalls: 2 }).modelCalls, d.modelCalls)
})

test('diagnosticsOf drops the event type', () => {
  assert.deepEqual(diagnosticsOf({ type: 'diagnostics', modelCalls: [call(1)] }), { modelCalls: [call(1)] })
})

test('check: the shared fields are checked, the kind checks its own, extra fields pass', () => {
  const ok = { type: 'diagnostics', modelCalls: [{ index: 1, name: 'understand', durationMs: 4, usage: { input: 900, output: 0 }, finishReason: 'stop' }, { index: 2, durationMs: 0, failed: true }], extra: 1 }
  assert.equal(checkDiagnostics(ok), ok)
  for (const bad of [
    { modelCalls: {} },
    { modelCalls: [{ durationMs: 1 }] },
    { modelCalls: [{ index: 0, durationMs: 1 }] },
    { modelCalls: [{ index: 1.5, durationMs: 1 }] },
    { modelCalls: [{ index: 1 }] },
    { modelCalls: [{ index: 1, durationMs: 1, usage: { input: -1 } }] },
    { modelCalls: [{ index: 1, durationMs: 1, usage: { output: '3' } }] },
    { modelCalls: [{ index: 1, durationMs: 1, failed: false }] },
    { modelCalls: [{ index: 1, durationMs: 1, name: 2 }] },
    { timings: { plan: 'slow' } },
    { limitations: [1] },
  ]) assert.throws(() => checkDiagnostics({ type: 'diagnostics', ...bad }), /Invalid diagnostics/, JSON.stringify(bad))
  assert.throws(() => checkDiagnostics({ type: 'diagnostics', plan: 1 }, (e) => e.plan === undefined), /Invalid diagnostics/)
})

test('totals: calls, failures, summed duration; each token field summed over the calls that reported it', () => {
  const totals = modelCallTotals([
    call(1, { usage: { input: 5210, output: 31, cacheRead: 4800 } }),
    call(2, { failed: true }),
    call(3, { usage: { input: 100, output: 0, cacheWrite: 0 } }),
  ])
  assert.deepEqual(totals, { calls: 3, failed: 1, durationMs: 60, usage: { input: 5310, output: 31, cacheRead: 4800, cacheWrite: 0 } })
  assert.deepEqual(modelCallTotals([call(1)]).usage, {})
})

test('usage parts show only what was reported, a reported 0 included', () => {
  assert.deepEqual(usageParts({ input: 5210, output: 312, cacheRead: 4800, cacheWrite: 0 }), ['5,210 in', '312 out', '4,800 cache read', '0 cache write'])
  assert.deepEqual(usageParts({ output: 0 }), ['0 out'])
  assert.deepEqual(usageParts({}), [])
  assert.deepEqual(usageParts(undefined), [])
})
