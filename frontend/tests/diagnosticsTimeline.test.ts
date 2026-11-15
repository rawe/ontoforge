import { test } from 'node:test'
import assert from 'node:assert/strict'
import { applyEvent, pendingTurn, type Turn } from '../src/assistants/conversation/chatModel.ts'
import type { Diagnostics, DiagnosticsStep } from '../src/assistants/diagnostics/diagnostics.ts'
import {
  SEGMENT_GAP_PX, SEGMENT_MIN_PX, answerSummary, answerTime, barLeastWidth, barWidth, diagnosedTurns, drawerTurn, stepName, stepRows, stepping, stepsEnd,
  stripFacts, stripLabel, stripSegments, stripText,
} from '../src/assistants/diagnostics/timeline.ts'
import { agentTurns, toolLabel } from '../src/assistants/steps/toolCallModel.ts'
import { graphTurns, stepLabel } from '../src/components/assistants/graph/graphTurnModel.ts'

const model = (index: number, startMs: number, durationMs: number, extra: Partial<DiagnosticsStep> = {}): DiagnosticsStep =>
  ({ index, model: true, startMs, durationMs, ...extra })
const work = (index: number, name: string, startMs: number, durationMs: number, extra: Partial<DiagnosticsStep> = {}): DiagnosticsStep =>
  ({ index, name, startMs, durationMs, ...extra })
const sum = (values: number[]) => values.reduce((a, b) => a + b, 0)
const close = (actual: number, expected: number) => assert.ok(Math.abs(actual - expected) < 1e-9, `${actual} ≈ ${expected}`)
const ended = (diagnostics: Diagnostics, status: Turn<unknown>['status'] = 'complete') => ({ status, diagnostics })

/* ------------------------------- one to many -------------------------------- */

test('one model call: one segment, the whole bar; one row over the whole answer', () => {
  const turn = ended({ steps: [model(1, 0, 1800, { usage: { input: 5210, output: 96 }, finishReason: 'stop' })], durationMs: 1800 })
  const { facts, segments } = answerSummary(turn, 0)
  assert.deepEqual(segments, [{ key: 'step-1', tone: 'model', failed: false, share: 1 }])
  assert.equal(barWidth(segments.length), 64)
  assert.equal(stripText(facts), '1.8 s · 1 model call · 5,306 tokens')
  const rows = stepRows(turn.diagnostics.steps!, 1800)
  assert.deepEqual(rows.map((r) => [r.index, r.label, r.tone, r.left, r.width, r.facts]), [[1, 'Model call', 'model', 0, 100, ['5,210 in', '96 out', 'finish: stop']]])
})

/**
 * Twenty model calls with tool calls between them; after the third, three
 * tool calls run in parallel: 41 steps.
 */
function longRun(): DiagnosticsStep[] {
  const steps: DiagnosticsStep[] = []
  let t = 0
  for (let k = 1; k <= 20; k++) {
    steps.push(model(steps.length + 1, t, 600))
    t += 600
    if (k === 20) break
    const durations = k === 3 ? [300, 100, 380] : [200]
    for (const ms of durations) steps.push(work(steps.length + 1, k === 3 && ms === 100 ? 'get_entity' : 'search', t + 5, ms))
    t += 5 + Math.max(...durations) + 5
  }
  return steps
}

test('twenty model calls with tool calls between them, three in parallel: the strip has every step in order, parallel ones in one segment; the drawer has a row each, overlapping where they ran together', () => {
  const steps = longRun()
  assert.equal(steps.length, 41)
  const total = stepsEnd(steps) + 10
  const bar = stripSegments(steps)
  // 41 steps, the three parallel ones in one segment.
  assert.equal(bar.length, 39)
  assert.equal(bar.filter((s) => s.tone === 'model').length, 20)
  close(sum(bar.map((s) => s.share)), 1)
  const parallel = bar[5]!
  assert.equal(parallel.tone, 'work')
  close(parallel.share, 380 / (20 * 600 + 18 * 200 + 380))
  // The bar has room for every segment at its least width, with the gaps, and never grows past its most width.
  assert.ok(barWidth(bar.length) >= bar.length * SEGMENT_MIN_PX + (bar.length - 1) * SEGMENT_GAP_PX)
  assert.equal(barWidth(17), 102)
  assert.equal(barWidth(99), 240)
  // Squeezed, the bar keeps room for every gap and one px per segment.
  assert.equal(barLeastWidth(3), 32)
  assert.equal(barLeastWidth(39), 78)
  assert.ok(barLeastWidth(99) - 98 * SEGMENT_GAP_PX >= 99)

  const rows = stepRows(steps, total, toolLabel)
  assert.equal(rows.length, 41)
  assert.deepEqual(rows.map((r) => r.index), steps.map((s) => s.index))
  assert.deepEqual(rows.slice(4, 9).map((r) => r.label), ['Model call', 'Search', 'Get entity', 'Search', 'Model call'])
  // Each bar sits at its real start; the parallel three start together.
  rows.forEach((row, i) => close(row.left, (steps[i]!.startMs / total) * 100))
  assert.equal(new Set(rows.slice(5, 8).map((r) => r.left)).size, 1)
  assert.equal(stripText(stripFacts({ steps, durationMs: total }, total, false)), `${(total / 1000).toFixed(1)} s · 20 model calls`)
})

test('agent, through the turn as the server sends it: two parallel tool calls overlap and share one segment, the total ends it', () => {
  let t = pendingTurn('t', 'q', agentTurns.empty(), 0, true)
  for (const event of [
    { type: 'thread', threadId: 'th' },
    { type: 'diagnostics', steps: [{ index: 1, model: true, startMs: 12, durationMs: 1 }] },
    { type: 'agent.tool_call', callId: 'a', tool: 'list_saved_queries', args: {} },
    { type: 'agent.tool_call', callId: 'b', tool: 'get_entity', args: { entity_type_key: 'person', entity_id: 'missing' } },
    { type: 'diagnostics', steps: [{ index: 2, name: 'list_saved_queries', startMs: 16, durationMs: 1 }] },
    { type: 'agent.tool_result', callId: 'a', result: [] },
    { type: 'diagnostics', steps: [{ index: 3, name: 'get_entity', startMs: 16, durationMs: 22 }] },
    { type: 'agent.tool_result', callId: 'b', result: { error: 'Entity missing' } },
    { type: 'diagnostics', steps: [{ index: 4, model: true, startMs: 38, durationMs: 0 }] },
    { type: 'diagnostics', durationMs: 41 },
    { type: 'final', reply: 'Done.' },
  ] as const) t = applyEvent(agentTurns, t, event)
  const { facts, segments } = answerSummary(t, 99999)
  assert.deepEqual(segments.map((s) => [s.key, s.tone]), [['step-1', 'model'], ['step-2', 'work'], ['step-4', 'model']])
  close(segments[1]!.share, 22 / 23)
  assert.equal(stripText(facts), '41 ms · 2 model calls')
  const rows = stepRows(t.diagnostics!.steps!, facts.timeMs, toolLabel)
  assert.deepEqual(rows.map((r) => r.label), ['Model call', 'List saved queries', 'Get entity', 'Model call'])
  assert.equal(rows[1]!.left, rows[2]!.left)
  // A tool that answered with an error is not a failed step.
  assert.equal(facts.failed, 0)
})

/* --------------------------------- running ---------------------------------- */

test('a running answer: its time is the client clock; the time since the last finished step pulses at the end of the strip and as a last row', () => {
  const running = { status: 'pending' as const, startedAt: 1000, diagnostics: { steps: [model(1, 2, 1400)] } }
  const at = (now: number) => answerSummary(running, now)
  assert.deepEqual(at(3000).segments.map((s) => [s.key, s.tone]), [['step-1', 'model'], ['running', 'running']])
  // The segments cover the step and the time after it, not the 2 ms before the first step.
  close(at(3000).segments[1]!.share, (2000 - 1402) / (1400 + 2000 - 1402))
  // It grows with the clock.
  assert.ok(at(5000).segments[1]!.share > at(3000).segments[1]!.share)
  assert.equal(stripText(at(3000).facts), '2.0 s so far · 1 model call')
  const rows = stepRows(running.diagnostics.steps, 2000, undefined, 2000)
  assert.deepEqual(rows.map((r) => [r.label, r.tone]), [['Model call', 'model'], ['Running', 'running']])
  close(rows[1]!.left, 70.1)
  close(rows[1]!.width, 29.9)
  // Before any step finished: only the running segment.
  assert.deepEqual(answerSummary({ status: 'pending', startedAt: 0, diagnostics: {} }, 500).segments, [{ key: 'running', tone: 'running', failed: false, share: 1 }])
  // Server times may run ahead of the client's elapsed time: the running part is then empty, never negative.
  const ahead = answerSummary({ ...running, startedAt: 2000 }, 3000).segments
  assert.deepEqual(ahead.map((s) => s.share), [1, 0])
  // Once the total arrives and the answer ends, the server's time replaces the clock.
  assert.equal(answerTime({ status: 'complete', startedAt: 1000, diagnostics: { durationMs: 1500 } }, 9000), 1500)
})

/* --------------------------------- failure ---------------------------------- */

test('a failed step: red in the strip and the drawer, counted; a failed answer keeps its steps and, without the total, ends where its last step did', () => {
  const steps = [model(1, 1, 900, { name: 'plan', usage: { input: 3100, output: 210 } }), work(2, 'retrieve', 903, 40), model(3, 950, 30, { name: 'answer', failed: true })]
  const failed = ended({ steps }, 'failed')
  assert.equal(answerTime(failed, 0), 980)
  const { facts, segments } = answerSummary(failed, 0)
  assert.deepEqual(segments.map((s) => s.failed), [false, false, true])
  assert.deepEqual(facts, { timeMs: 980, running: false, modelCalls: 2, failed: 1, tokens: 3310 })
  assert.equal(stripLabel(facts), 'Diagnostics: 980 ms · 2 model calls · 3,310 tokens · 1 failed. Open the details.')
  const rows = stepRows(steps, 980)
  assert.deepEqual(rows.map((r) => [r.label, r.failed]), [['plan', false], ['retrieve', false], ['answer', true]])
  assert.deepEqual(rows[2]!.facts, [])
  // With the total it ends there.
  assert.equal(answerTime(ended({ steps, durationMs: 1000 }, 'failed'), 0), 1000)
})

/* ---------------------------------- plans ----------------------------------- */

test('a step with a plan carries it to its row; steps have readable names, an unnamed model step is a model call', () => {
  const plan = { summary: 'Looking for Project · starting at “Lena”' }
  const rows = stepRows([model(1, 1, 300, { name: 'understand', plan }), work(2, 'anchor', 302, 10)], 400, (name) => name.toUpperCase())
  assert.deepEqual(rows.map((r) => [r.label, r.plan]), [['UNDERSTAND', plan], ['ANCHOR', undefined]])
  assert.equal(stepName({}), 'Model call')
  assert.equal(stepName({ name: 'get_entity' }, toolLabel), 'Get entity')
  assert.equal(stepName({ name: 'walk' }), 'walk')
})

test('navigator, through the turn: steps named by its pipeline, a repeated walk two rows, the understand step with its plan', () => {
  let t = pendingTurn('t', 'q', graphTurns.empty(), 0, true)
  const steps = ['understand', 'anchor', 'walk', 'focus', 'answer'].map((id) => ({ id, label: id[0]!.toUpperCase() + id.slice(1), description: '' }))
  for (const event of [
    { type: 'thread', threadId: 'th' },
    { type: 'navigator.graph', steps, edges: [] },
    { type: 'diagnostics', steps: [{ index: 1, name: 'understand', model: true, startMs: 1, durationMs: 1200, plan: { summary: 'starting at “Lena”' } }] },
    { type: 'diagnostics', steps: [{ index: 2, name: 'anchor', startMs: 1201, durationMs: 90 }] },
    { type: 'diagnostics', steps: [{ index: 3, name: 'walk', startMs: 1291, durationMs: 180 }] },
    { type: 'diagnostics', steps: [{ index: 4, name: 'walk', startMs: 1471, durationMs: 100 }] },
    { type: 'diagnostics', steps: [{ index: 5, name: 'focus', startMs: 1571, durationMs: 20 }] },
    { type: 'diagnostics', steps: [{ index: 6, name: 'answer', model: true, startMs: 1591, durationMs: 2400, usage: { input: 6020, output: 380 } }] },
    { type: 'diagnostics', durationMs: 4100 },
    { type: 'final', reply: 'Nothing.' },
  ] as const) t = applyEvent(graphTurns, t, event)
  const rows = stepRows(t.diagnostics!.steps!, answerTime(t, 0), (name) => stepLabel(t.insight, name))
  assert.deepEqual(rows.map((r) => [r.index, r.label, r.tone]), [
    [1, 'Understand', 'model'], [2, 'Anchor', 'work'], [3, 'Walk', 'work'], [4, 'Walk', 'work'], [5, 'Focus', 'work'], [6, 'Answer', 'model'],
  ])
  assert.deepEqual(rows[0]!.plan, { summary: 'starting at “Lena”' })
  assert.equal(stripText(answerSummary(t, 0).facts), '4.1 s · 2 model calls · 6,400 tokens')
})

/* ------------------------------- strip numbers ------------------------------ */

test('strip numbers: no tokens reported, none shown; a reported 0 shown', () => {
  assert.equal(stripText(stripFacts({}, 3200, true)), '3.2 s so far · 0 model calls')
  assert.equal(stripText(stripFacts({ steps: [model(1, 0, 1, { usage: { output: 0 } })] }, 400, false)), '400 ms · 1 model call · 0 tokens')
  assert.equal(stripText(stripFacts({ steps: [model(1, 0, 1, { usage: { cacheRead: 4800 } })] }, 400, false)), '400 ms · 1 model call')
  // No time at all: equal shares.
  assert.deepEqual(stripSegments([work(1, 'a', 0, 0), work(2, 'b', 0, 0)]).map((s) => s.share), [0.5, 0.5])
})

/* ------------------------------- conversation ------------------------------- */

test('several answers in one conversation: each keeps its own diagnostics; the drawer follows the latest or the chosen one and steps between them', () => {
  const turn = (id: string, diagnostics?: Diagnostics): Turn<null> => ({
    id, question: id, reply: '', status: 'complete', entities: [], links: [], insight: null, ...(diagnostics && { diagnostics }),
  })
  const turns = [
    turn('a', { steps: [model(1, 0, 10)], durationMs: 12 }),
    turn('b'),
    turn('c', {}),
    turn('d', { steps: [model(1, 0, 5), work(2, 'search', 6, 3), model(3, 10, 4)], durationMs: 15 }),
  ]
  assert.deepEqual(diagnosedTurns(turns).map((t) => t.id), ['a', 'c', 'd'])
  assert.equal(drawerTurn(turns, null)?.id, 'd')
  assert.equal(drawerTurn(turns, 'a')?.id, 'a')
  // An answer without diagnostics, or one gone, falls back to the latest.
  assert.equal(drawerTurn(turns, 'b')?.id, 'd')
  assert.equal(drawerTurn([turn('x')], null), undefined)
  assert.deepEqual(stepping(turns, 'a'), { position: 1, count: 3, previous: null, next: 'c' })
  assert.deepEqual(stepping(turns, 'c'), { position: 2, count: 3, previous: 'a', next: 'd' })
  assert.deepEqual(stepping(turns, 'd'), { position: 3, count: 3, previous: 'c', next: null })
  // Each answer's numbers and bar are its own.
  assert.deepEqual(diagnosedTurns(turns).map((t) => stripText(answerSummary(t, 0).facts)), ['12 ms · 1 model call', '0 ms · 0 model calls', '15 ms · 2 model calls'])
  assert.deepEqual(diagnosedTurns(turns).map((t) => answerSummary(t, 0).segments.length), [1, 0, 3])
})

test('a turn that asks for diagnostics has them from the start; one that does not has none', () => {
  assert.deepEqual(pendingTurn('a', 'q', [], 0, true).diagnostics, {})
  assert.equal(pendingTurn('a', 'q', [], 0).diagnostics, undefined)
})
