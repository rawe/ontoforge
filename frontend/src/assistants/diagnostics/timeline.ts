/**
 * Where an answer's time went, the same for every assistant kind: the kind
 * names its parts in order (model calls, tool calls, steps, phases) and
 * this lays them end to end — each part starts where the one before ended.
 * The strip under an answer draws them as one small bar, the diagnostics
 * drawer as one bar per part. Also the strip's numbers and stepping
 * between the conversation's answers that have diagnostics.
 *
 * No React, no I/O — unit-tested with `node --test`.
 */
import { formatDuration, turnDuration, type Turn } from '../conversation/chatModel.ts'
import { modelCallTotals, type Diagnostics } from './diagnostics.ts'

/** A model call, or other work (tools, search, a walk). */
export type PartKind = 'model' | 'work'

/**
 * `done`, `failed` and `running` took time; `skipped`, `stopped`, `not-run`
 * and `waiting` (not started yet) took none and show only in the drawer.
 */
export type PartState = 'done' | 'failed' | 'running' | 'skipped' | 'stopped' | 'not-run' | 'waiting'

/** One part as the kind names it. */
export interface PartInput {
  key: string
  label: string
  kind: PartKind
  state: PartState
  /** Omitted for the running part: it gets the time the others leave of the elapsed time. */
  durationMs?: number
  /** One line under the label (the tools of a group). */
  detail?: string
}

/** One part laid out. */
export interface TimePart extends PartInput {
  durationMs: number
  /** Where it starts: the sum of the timed parts before it. */
  offsetMs: number
}

export interface Timeline {
  parts: TimePart[]
  /** The sum of the timed parts. */
  totalMs: number
}

const TIMED: ReadonlySet<PartState> = new Set(['done', 'failed', 'running'])

/** Whether the part took time (and is drawn in the strip's bar). */
export const isTimed = (part: Pick<PartInput, 'state'>) => TIMED.has(part.state)

/**
 * The parts laid out end to end. While the answer runs (`elapsedMs` given),
 * the running part without a duration gets what the elapsed time leaves;
 * without one, a "Working" part at the end does — so the bar grows.
 */
export function timeline(input: readonly PartInput[], elapsedMs?: number): Timeline {
  const known = input.reduce((sum, part) => sum + (isTimed(part) ? part.durationMs ?? 0 : 0), 0)
  const rest = elapsedMs === undefined ? 0 : Math.max(0, elapsedMs - known)
  const open = input.findIndex((part) => part.state === 'running' && part.durationMs === undefined)
  const all: PartInput[] = elapsedMs !== undefined && open === -1
    ? [...input, { key: 'working', label: 'Working', kind: 'work', state: 'running', durationMs: rest }]
    : [...input]
  let offset = 0
  const parts = all.map((part, i): TimePart => {
    const durationMs = !isTimed(part) ? 0 : i === open ? (part.durationMs ?? rest) : part.durationMs ?? 0
    const laid = { ...part, durationMs, offsetMs: offset }
    offset += durationMs
    return laid
  })
  return { parts, totalMs: offset }
}

/** One segment of the strip's bar: a timed part and its share (0–1) of the bar. */
export interface Segment {
  key: string
  kind: PartKind
  state: PartState
  share: number
}

/** The strip's bar: every timed part in order, none left out; with no time at all, equal shares. */
export function segments(time: Timeline): Segment[] {
  const timed = time.parts.filter(isTimed)
  return timed.map((part) => ({
    key: part.key,
    kind: part.kind,
    state: part.state,
    share: time.totalMs > 0 ? part.durationMs / time.totalMs : 1 / timed.length,
  }))
}

/** Each segment's least width and the gap between two, in px. */
export const SEGMENT_MIN_PX = 2
export const SEGMENT_GAP_PX = 1
const BAR_MIN_PX = 64

/**
 * The bar's width in px: 64, or wider with many segments so each keeps at
 * least its least width and the gaps; the strip may still narrow it to
 * the room it has.
 */
export const barWidth = (count: number) =>
  Math.max(BAR_MIN_PX, count * (SEGMENT_MIN_PX + SEGMENT_GAP_PX + 1))

/** The answer's time: elapsed while it runs, else the kind's reported total, the client's, or the parts' sum. */
export function answerTime(
  turn: Pick<Turn<unknown>, 'status' | 'startedAt' | 'finishedAt'>,
  reportedMs: number | undefined,
  partsMs: number,
  now: number,
): number {
  if (turn.status === 'pending' && turn.startedAt !== undefined) return Math.max(0, now - turn.startedAt)
  return reportedMs ?? turnDuration(turn) ?? partsMs
}

/** The strip's numbers. */
export interface StripFacts {
  timeMs: number
  running: boolean
  calls: number
  failed: number
  /** Input plus output tokens, as far as reported; absent when none were. */
  tokens?: number
}

export function stripFacts(diagnostics: Diagnostics, timeMs: number, running: boolean): StripFacts {
  const totals = modelCallTotals(diagnostics.modelCalls ?? [])
  const { input, output } = totals.usage
  return {
    timeMs,
    running,
    calls: totals.calls,
    failed: totals.failed,
    ...(input !== undefined || output !== undefined ? { tokens: (input ?? 0) + (output ?? 0) } : {}),
  }
}

const plural = (n: number, one: string, many: string) => `${n.toLocaleString('en-US')} ${n === 1 ? one : many}`

/** `4.4 s · 2 model calls · 10,840 tokens` — what the strip says beside its bar. */
export function stripText(facts: StripFacts): string {
  return [
    `${formatDuration(facts.timeMs)}${facts.running ? ' so far' : ''}`,
    plural(facts.calls, 'model call', 'model calls'),
    ...(facts.tokens !== undefined ? [plural(facts.tokens, 'token', 'tokens')] : []),
  ].join(' · ')
}

/** `1 failed`, or null when no call failed. */
export const failedText = (facts: StripFacts) => (facts.failed > 0 ? `${facts.failed} failed` : null)

/** The strip button's accessible name: what it shows, and what it does. */
export function stripLabel(facts: StripFacts): string {
  const failed = failedText(facts)
  return `Diagnostics: ${stripText(facts)}${failed !== null ? ` · ${failed}` : ''}. Open the details.`
}

/** What a kind reports about an answer's time: its parts in order, and its own total where it measures one. */
export interface AnswerTime {
  parts: PartInput[]
  totalMs?: number
}

/** An answer's time laid out and the strip's numbers, at `now` (which matters only while it runs). */
export function answerSummary(
  turn: Pick<Turn<unknown>, 'status' | 'startedAt' | 'finishedAt' | 'diagnostics'>,
  given: AnswerTime,
  now: number,
): { time: Timeline; facts: StripFacts } {
  const running = turn.status === 'pending'
  const time = timeline(given.parts, running && turn.startedAt !== undefined ? Math.max(0, now - turn.startedAt) : undefined)
  return { time, facts: stripFacts(turn.diagnostics ?? {}, answerTime(turn, given.totalMs, time.totalMs, now), running) }
}

/** The conversation's answers that have diagnostics, in order. */
export const diagnosedTurns = <I>(turns: readonly Turn<I>[]) => turns.filter((turn) => turn.diagnostics !== undefined)

/** The answer the drawer shows: the chosen one, else (null) the latest with diagnostics. */
export function drawerTurn<I>(turns: readonly Turn<I>[], id: string | null): Turn<I> | undefined {
  const diagnosed = diagnosedTurns(turns)
  return (id === null ? undefined : diagnosed.find((turn) => turn.id === id)) ?? diagnosed.at(-1)
}

/** Where an answer stands among those with diagnostics, and its neighbours ‹ ›. */
export function stepping<I>(turns: readonly Turn<I>[], id: string): { position: number; count: number; previous: string | null; next: string | null } {
  const diagnosed = diagnosedTurns(turns)
  const at = diagnosed.findIndex((turn) => turn.id === id)
  return {
    position: at + 1,
    count: diagnosed.length,
    previous: at > 0 ? diagnosed[at - 1]!.id : null,
    next: at !== -1 && at < diagnosed.length - 1 ? diagnosed[at + 1]!.id : null,
  }
}
