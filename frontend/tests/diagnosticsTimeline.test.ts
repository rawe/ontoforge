import { test } from 'node:test'
import assert from 'node:assert/strict'
import { applyEvent, pendingTurn, type Turn } from '../src/assistants/conversation/chatModel.ts'
import { mergeDiagnostics, type ModelCall } from '../src/assistants/diagnostics/diagnostics.ts'
import {
  SEGMENT_GAP_PX, SEGMENT_MIN_PX, answerSummary, answerTime, barWidth, diagnosedTurns, drawerTurn, segments, stepping, stripFacts, stripLabel, stripText, timeline,
} from '../src/assistants/diagnostics/timeline.ts'
import { agentTurns, toolLoopParts } from '../src/assistants/steps/toolCallModel.ts'
import { graphParts, graphTurns, type GraphInsight } from '../src/components/assistants/graph/graphTurnModel.ts'
import { retrieverParts, retrieverTurns } from '../src/components/assistants/retrievers/retrieverModel.ts'
import type { ToolCall } from '../src/api/types.ts'

const model = (index: number, durationMs: number, arrivedAt: number, extra: Partial<ModelCall> = {}): ModelCall => ({ index, durationMs, arrivedAt, ...extra })
const tool = (callId: string, startedAt: number, finishedAt?: number, name = 'search'): ToolCall => ({
  callId, tool: name, args: {}, startedAt, ...(finishedAt === undefined ? { status: 'pending' } : { status: 'completed', finishedAt }),
})
const sum = (values: number[]) => values.reduce((a, b) => a + b, 0)
const close = (actual: number, expected: number) => assert.ok(Math.abs(actual - expected) < 1e-9, `${actual} ≈ ${expected}`)

/* ------------------------------ arrival stamps ------------------------------ */

test('a model call keeps when its entry first arrived; a later update does not move it', () => {
  let d = mergeDiagnostics({}, { modelCalls: [{ index: 1, durationMs: 5 }] }, 100)
  d = mergeDiagnostics(d, { modelCalls: [{ index: 1, durationMs: 6 }, { index: 2, durationMs: 7 }] }, 200)
  assert.deepEqual(d.modelCalls, [{ index: 1, durationMs: 6, arrivedAt: 100 }, { index: 2, durationMs: 7, arrivedAt: 200 }])
  // Without a clock nothing is stamped.
  assert.deepEqual(mergeDiagnostics({}, { modelCalls: [{ index: 1, durationMs: 5 }] }).modelCalls, [{ index: 1, durationMs: 5 }])
})

test('a turn that asks for diagnostics has them from the start; one that does not has none', () => {
  assert.deepEqual(pendingTurn('a', 'q', [], 0, true).diagnostics, {})
  assert.equal(pendingTurn('a', 'q', [], 0).diagnostics, undefined)
})

/* ---------------------------------- agent ----------------------------------- */

test('agent, one model call: one model part, the whole bar', () => {
  const parts = toolLoopParts([model(1, 1800, 1900)], [], false, 2000)
  assert.deepEqual(parts, [{ key: 'model-1', label: 'Model call 1', kind: 'model', state: 'done', durationMs: 1800 }])
  const time = timeline(parts)
  assert.equal(time.totalMs, 1800)
  assert.deepEqual(segments(time), [{ key: 'model-1', kind: 'model', state: 'done', share: 1 }])
  assert.equal(barWidth(1), 64)
})

test('agent, twenty model calls with tool calls between them, some parallel: every part in order, none dropped', () => {
  // Call k arrives at 1000k; after each but the last, tools start 10 ms later.
  // After call 3, three tools run in parallel (100–400, 150–250, 120–500 ms after it).
  const calls = Array.from({ length: 20 }, (_, i) => model(i + 1, 600, 1000 * (i + 1)))
  const tools: ToolCall[] = []
  for (let k = 1; k < 20; k++) {
    if (k === 3) tools.push(tool('p1', 3100, 3400, 'search'), tool('p2', 3150, 3250, 'get_entity'), tool('p3', 3120, 3500, 'search'))
    else tools.push(tool(`t${k}`, 1000 * k + 10, 1000 * k + 210, 'get_neighbors'))
  }
  const parts = toolLoopParts(calls, tools, false, 21000)
  assert.equal(parts.length, 39)
  assert.deepEqual(parts.slice(0, 7).map((p) => p.label), [
    'Model call 1', 'Get neighbours', 'Model call 2', 'Get neighbours', 'Model call 3', '3 tool calls', 'Model call 4',
  ])
  assert.equal(parts.at(-1)!.label, 'Model call 20')
  // The parallel group: from the first start to the last end, its tools named once each.
  const group = parts[5]!
  assert.equal(group.durationMs, 400)
  assert.equal(group.detail, 'Search, Get entity')
  assert.equal(group.kind, 'work')

  const time = timeline(parts)
  assert.equal(time.totalMs, 20 * 600 + 18 * 200 + 400)
  // Each part starts where the one before ended.
  time.parts.forEach((part, i) => assert.equal(part.offsetMs, i === 0 ? 0 : time.parts[i - 1]!.offsetMs + time.parts[i - 1]!.durationMs))
  const bar = segments(time)
  assert.equal(bar.length, 39)
  close(sum(bar.map((s) => s.share)), 1)
  assert.deepEqual(bar.filter((s) => s.kind === 'model').length, 20)
  // The bar has room for every segment at its least width, with the gaps,
  // and never grows past its most width, however many calls an answer made.
  assert.ok(barWidth(bar.length) >= bar.length * SEGMENT_MIN_PX + (bar.length - 1) * SEGMENT_GAP_PX)
  assert.equal(barWidth(17), 102)
  assert.equal(barWidth(99), 240)
})

test('agent, running: a running tool group grows to now; with no tool running, the next model call runs', () => {
  // Call 1 arrived at 1500 (took 1400), two tools started, one still running at 2600.
  const calls = [model(1, 1400, 1500)]
  const running = toolLoopParts(calls, [tool('a', 1510, 1700), tool('b', 1520)], true, 2600)
  assert.deepEqual(running.map((p) => [p.label, p.state, p.durationMs]), [['Model call 1', 'done', 1400], ['2 tool calls', 'running', 1090]])
  // The tools ended; model call 2 is under way and gets the time not yet accounted for.
  const thinking = toolLoopParts(calls, [tool('a', 1510, 1700), tool('b', 1520, 1900)], true, 3000)
  assert.deepEqual(thinking.at(-1), { key: 'model-2', label: 'Model call 2', kind: 'model', state: 'running' })
  const time = timeline(thinking, 3000 - 0)
  assert.equal(time.parts.at(-1)!.durationMs, 3000 - 1400 - 390)
  assert.equal(time.totalMs, 3000)
  // Before any model call arrived: model call 1 runs.
  assert.deepEqual(toolLoopParts([], [], true, 10).map((p) => p.label), ['Model call 1'])
})

test('agent, a failed model call is marked; the strip counts it', () => {
  const calls = [model(1, 900, 1000, { usage: { input: 5210, output: 312 } }), model(2, 40, 1300, { failed: true })]
  const parts = toolLoopParts(calls, [tool('a', 1010, 1200)], false, 1400)
  assert.deepEqual(parts.map((p) => p.state), ['done', 'done', 'failed'])
  const facts = stripFacts({ modelCalls: calls }, 1400, false)
  assert.deepEqual(facts, { timeMs: 1400, running: false, calls: 2, failed: 1, tokens: 5522 })
  assert.equal(stripText(facts), '1.4 s · 2 model calls · 5,522 tokens')
  assert.equal(stripLabel(facts), 'Diagnostics: 1.4 s · 2 model calls · 5,522 tokens · 1 failed. Open the details.')
})

test('agent, through the turn: each model call is placed by when it arrived', () => {
  let t = pendingTurn('t', 'q', agentTurns.empty(), 0, true)
  t = applyEvent(agentTurns, t, { type: 'diagnostics', modelCalls: [{ index: 1, durationMs: 900 }] }, 1000)
  t = applyEvent(agentTurns, t, { type: 'agent.tool_call', callId: 'c', tool: 'search', args: {} }, 1010)
  t = applyEvent(agentTurns, t, { type: 'agent.tool_result', callId: 'c', result: [] }, 1300)
  t = applyEvent(agentTurns, t, { type: 'diagnostics', modelCalls: [{ index: 2, durationMs: 700 }] }, 2100)
  t = applyEvent(agentTurns, t, { type: 'final', reply: 'ok' }, 2150)
  const parts = toolLoopParts(t.diagnostics!.modelCalls!, t.insight, false, t.finishedAt!)
  assert.deepEqual(parts.map((p) => [p.label, p.durationMs]), [['Model call 1', 900], ['Search', 290], ['Model call 2', 700]])
})

/* --------------------------------- generic ---------------------------------- */

test('timeline, running without a running part: a Working part at the end takes the rest of the elapsed time', () => {
  const time = timeline([{ key: 'a', label: 'A', kind: 'model', state: 'done', durationMs: 300 }], 1000)
  assert.deepEqual(time.parts.map((p) => [p.label, p.state, p.offsetMs, p.durationMs]), [['A', 'done', 0, 300], ['Working', 'running', 300, 700]])
  // Server times may exceed the client's elapsed time: the rest is never negative.
  assert.equal(timeline([{ key: 'a', label: 'A', kind: 'model', state: 'done', durationMs: 1300 }], 1000).parts.at(-1)!.durationMs, 0)
  // No time at all: equal shares.
  assert.deepEqual(segments(timeline([], 0)).map((s) => s.share), [1])
})

test('answer time: elapsed while running, else the reported total, the client clock, or the parts', () => {
  assert.equal(answerTime({ status: 'pending', startedAt: 100 }, 5, 7, 1600), 1500)
  assert.equal(answerTime({ status: 'complete', startedAt: 100, finishedAt: 600 }, 450, 7, 0), 450)
  assert.equal(answerTime({ status: 'complete', startedAt: 100, finishedAt: 600 }, undefined, 7, 0), 500)
  assert.equal(answerTime({ status: 'complete' }, undefined, 7, 0), 7)
})

test('strip text: a running answer says so far; no tokens reported, none shown', () => {
  assert.equal(stripText(stripFacts({}, 3200, true)), '3.2 s so far · 0 model calls')
  assert.equal(stripText(stripFacts({ modelCalls: [{ index: 1, durationMs: 1, usage: { output: 0 } }] }, 400, false)), '400 ms · 1 model call · 0 tokens')
})

test('answer summary: a running answer grows with the clock; an ended one keeps its time', () => {
  const parts = [{ key: 'a', label: 'A', kind: 'model' as const, state: 'done' as const, durationMs: 500 }]
  const running = { status: 'pending' as const, startedAt: 1000, diagnostics: {} }
  assert.deepEqual([2000, 3000].map((now) => answerSummary(running, { parts }, now).time.totalMs), [1000, 2000])
  assert.equal(answerSummary(running, { parts }, 3000).facts.running, true)
  const ended = answerSummary({ status: 'failed', startedAt: 1000, finishedAt: 1800, diagnostics: {} }, { parts }, 9000)
  assert.deepEqual([ended.time.totalMs, ended.facts.timeMs, ended.facts.running], [500, 800, false])
})

/* -------------------------------- navigator --------------------------------- */

test('navigator: each run in order, a repeated step per round, a skipped step without time, model steps as model calls', () => {
  const insight: GraphInsight = {
    graph: {
      steps: [
        { id: 'understand', label: 'Understand', description: '', model: true },
        { id: 'anchor', label: 'Anchor', description: '' },
        { id: 'walk', label: 'Walk', description: '' },
        { id: 'focus', label: 'Focus', description: '' },
        { id: 'answer', label: 'Answer', description: '', model: true },
      ],
      edges: [],
    },
    steps: [
      { id: 'understand', round: 1, status: 'done', durationMs: 1200 },
      { id: 'anchor', round: 1, status: 'done', durationMs: 100 },
      { id: 'walk', round: 1, status: 'done', durationMs: 200 },
      { id: 'walk', round: 2, status: 'done', durationMs: 100 },
      { id: 'focus', round: 1, status: 'skipped' },
      { id: 'answer', round: 1, status: 'running' },
    ],
    summary: null,
  }
  const parts = graphParts(insight)
  assert.deepEqual(parts.map((p) => [p.label, p.kind, p.state]), [
    ['Understand', 'model', 'done'], ['Anchor', 'work', 'done'], ['Walk · round 1', 'work', 'done'], ['Walk · round 2', 'work', 'done'],
    ['Focus', 'work', 'skipped'], ['Answer', 'model', 'running'],
  ])
  const time = timeline(parts, 4000)
  assert.equal(time.parts.find((p) => p.key === 'answer-1')!.durationMs, 4000 - 1600)
  // The skipped step is in the drawer's list but not in the bar.
  assert.equal(time.parts.find((p) => p.key === 'focus-1')!.durationMs, 0)
  assert.deepEqual(segments(time).map((s) => s.key), ['understand-1', 'anchor-1', 'walk-1', 'walk-2', 'answer-1'])
  // A stopped answer: the run that did not finish took no time we know of.
  const stopped = graphTurns.end!(insight, 0)
  assert.equal(graphParts(stopped).at(-1)!.state, 'stopped')
})

/* -------------------------------- retriever --------------------------------- */

test('retriever: stopped after planning — plan timed, retrieve stopped, answer not run; only plan in the bar', () => {
  const parts = retrieverParts({ timings: { plan: 1100, planModel: 900 } }, { phase: 'retrieve' }, 'failed')
  assert.deepEqual(parts.map((p) => [p.label, p.kind, p.state, p.durationMs]), [
    ['Plan question', 'model', 'done', 1100], ['Search indices', 'work', 'stopped', undefined], ['Write answer', 'model', 'not-run', undefined],
  ])
  assert.deepEqual(segments(timeline(parts)).map((s) => s.key), ['plan'])
})

test('retriever: planning failed — the plan is marked failed with its time, the later steps did not run', () => {
  // The server ends the phase with its time, then the error: nothing was searched.
  let t = pendingTurn('t', 'q', retrieverTurns.empty(), 0, true)
  t = applyEvent(retrieverTurns, t, { type: 'retriever.phase', phase: 'plan', status: 'start' }, 1)
  t = applyEvent(retrieverTurns, t, { type: 'retriever.phase', phase: 'plan', status: 'end', durationMs: 900 }, 901)
  t = applyEvent(retrieverTurns, t, { type: 'error', error: { code: 'MODEL_ERROR', message: 'failed' } }, 902)
  const parts = retrieverParts(t.diagnostics!, t.insight, t.status)
  assert.deepEqual(parts.map((p) => [p.key, p.state, p.durationMs]), [['plan', 'failed', 900], ['retrieve', 'not-run', undefined], ['answer', 'not-run', undefined]])
  assert.deepEqual(segments(timeline(parts)).map((s) => [s.key, s.state]), [['plan', 'failed']])
})

test('retriever, running: an ended phase is timed before its timings arrive; the started one runs, later ones wait', () => {
  let t = pendingTurn('t', 'q', retrieverTurns.empty(), 0, true)
  t = applyEvent(retrieverTurns, t, { type: 'retriever.phase', phase: 'plan', status: 'start' }, 1)
  t = applyEvent(retrieverTurns, t, { type: 'retriever.phase', phase: 'plan', status: 'end', durationMs: 1100 }, 1101)
  t = applyEvent(retrieverTurns, t, { type: 'retriever.phase', phase: 'retrieve', status: 'start' }, 1102)
  const parts = retrieverParts(t.diagnostics!, t.insight, t.status)
  assert.deepEqual(parts.map((p) => [p.key, p.state, p.durationMs]), [['plan', 'done', 1100], ['retrieve', 'running', undefined], ['answer', 'waiting', undefined]])
  assert.equal(timeline(parts, 1500).parts[1]!.durationMs, 400)
  // A complete answer: its timings decide.
  assert.deepEqual(retrieverParts({ timings: { plan: 1000, retrieve: 300, answer: 2000 } }, {}, 'complete').map((p) => p.durationMs), [1000, 300, 2000])
})

/* ------------------------------- conversation ------------------------------- */

test('several answers in one conversation: each keeps its own diagnostics; the drawer follows the latest or the chosen one and steps between them', () => {
  const turn = (id: string, diagnostics?: object): Turn<null> => ({
    id, question: id, reply: '', status: 'complete', entities: [], links: [], insight: null, ...(diagnostics && { diagnostics }),
  })
  const turns = [turn('a', { modelCalls: [{ index: 1, durationMs: 1 }] }), turn('b'), turn('c', {}), turn('d', { modelCalls: [] })]
  assert.deepEqual(diagnosedTurns(turns).map((t) => t.id), ['a', 'c', 'd'])
  assert.equal(drawerTurn(turns, null)?.id, 'd')
  assert.equal(drawerTurn(turns, 'a')?.id, 'a')
  // An answer without diagnostics, or one gone, falls back to the latest.
  assert.equal(drawerTurn(turns, 'b')?.id, 'd')
  assert.equal(drawerTurn([turn('x')], null), undefined)
  assert.deepEqual(stepping(turns, 'a'), { position: 1, count: 3, previous: null, next: 'c' })
  assert.deepEqual(stepping(turns, 'c'), { position: 2, count: 3, previous: 'a', next: 'd' })
  assert.deepEqual(stepping(turns, 'd'), { position: 3, count: 3, previous: 'c', next: null })
  // Each answer's numbers are its own.
  assert.deepEqual(diagnosedTurns(turns).map((t) => stripFacts(t.diagnostics!, 0, false).calls), [1, 0, 0])
})
