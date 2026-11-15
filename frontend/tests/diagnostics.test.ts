import { test } from 'node:test'
import assert from 'node:assert/strict'
import { readdirSync, readFileSync } from 'node:fs'
import { join, relative } from 'node:path'
import { checkDiagnostics, mergeDiagnostics, type DiagnosticsEvent, type DiagnosticsStep } from '../src/assistants/diagnostics/events.ts'
import { stepTotals, usageParts } from '../src/assistants/diagnostics/timeline.ts'

const step = (index: number, extra: Partial<DiagnosticsStep> = {}): DiagnosticsStep => ({ index, startMs: 10 * index, durationMs: 5, ...extra })

test('merge: steps upsert by index and stay in index order; the turn\'s time replaces', () => {
  let d = mergeDiagnostics(undefined, { steps: [step(2, { name: 'search' })] })
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

test('merge takes the event as it came: its steps and its time, never its type', () => {
  const stepEvent: DiagnosticsEvent = { type: 'diagnostics', steps: [step(1)] }
  const totalEvent: DiagnosticsEvent = { type: 'diagnostics', durationMs: 7 }
  assert.deepEqual(mergeDiagnostics({}, stepEvent), { steps: [step(1)] })
  assert.deepEqual(mergeDiagnostics({ steps: [step(1)] }, totalEvent), { steps: [step(1)], durationMs: 7 })
})

test('the check: a step\'s detail is a string of any text, and nothing about a step depends on the assistant kind', () => {
  const event = (extra: Record<string, unknown>) => ({ type: 'diagnostics', steps: [{ index: 1, name: 'plan', model: true, startMs: 0, durationMs: 3, ...extra }] })
  const detail = JSON.stringify({ subQueries: [], unsupportedReason: 'no salaries' }, null, 2)
  assert.equal(checkDiagnostics(event({ detail })).steps?.[0]?.detail, detail)
  assert.equal(checkDiagnostics(event({})).steps?.[0]?.detail, undefined)
  // A step of other work may carry one too.
  assert.equal(checkDiagnostics({ type: 'diagnostics', steps: [{ index: 2, name: 'retrieve', startMs: 3, durationMs: 9, detail: '3 entities' }] }).steps?.[0]?.detail, '3 entities')
  for (const bad of [{ subQueries: [] }, ['a'], 3, null]) assert.throws(() => checkDiagnostics(event({ detail: bad })), /Invalid diagnostics/, JSON.stringify(bad))
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

/* --------------------------------- the module -------------------------------- */

const SRC = join(import.meta.dirname, '../src')
const MODULE = 'assistants/diagnostics'

/** Every import of every source file: [file relative to src, what it imports]. */
function imports(): [string, string][] {
  const found: [string, string][] = []
  for (const entry of readdirSync(SRC, { recursive: true, withFileTypes: true })) {
    if (!entry.isFile() || !/\.tsx?$/.test(entry.name)) continue
    const path = join(entry.parentPath, entry.name)
    for (const match of readFileSync(path, 'utf8').matchAll(/\bfrom\s+['"]([^'"]+)['"]/g)) found.push([relative(SRC, path), match[1]!])
  }
  return found
}

test('the diagnostics module is closed: outside it only its two doors are imported, and it imports nothing of the chat or of an assistant kind', () => {
  const all = imports()
  const inside = (file: string) => file.startsWith(`${MODULE}/`)
  const outside = all.filter(([file, what]) => !inside(file) && /(^|\/)diagnostics(\/|$)/.test(what))
  assert.ok(outside.length > 0)
  // The shell takes the view from the folder itself, the stream reader and the turn model the event from `events.ts`.
  assert.deepEqual([...new Set(outside.map(([file, what]) => `${file} <- ${what}`))].sort(), [
    'assistants/conversation/chatModel.ts <- ../diagnostics/events.ts',
    'assistants/shell/AssistantChat.tsx <- ../diagnostics',
    'assistants/stream/chatStream.ts <- ../diagnostics/events.ts',
  ])
  // Inside: its own files, React, icons, the UI primitives, storage and the shared shape checks.
  const foreign = all.filter(([file, what]) => inside(file) &&
    !(what.startsWith('./') || what === 'react' || what === 'lucide-react' || what.startsWith('@/components/ui/') || what.startsWith('@/lib/') || what === '../../api/checks.ts'))
  assert.deepEqual(foreign, [])
})
