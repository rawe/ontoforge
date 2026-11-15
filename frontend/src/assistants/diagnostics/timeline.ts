/**
 * An answer's diagnostics laid out, the same for every assistant kind:
 * its steps where the server placed them (`startMs`, `durationMs` from the
 * turn's start), so parallel work overlaps. The strip under an answer draws
 * them as one small bar beside its numbers, the diagnostics drawer as one
 * row per step. Also stepping between the conversation's answers that have
 * diagnostics.
 *
 * No React, no I/O — unit-tested with `node --test`.
 */
import { formatDuration, type Turn } from '../conversation/chatModel.ts'
import { stepTotals, usageParts, type Diagnostics, type DiagnosticsStep } from './diagnostics.ts'

/** A model call, other work, or the time a running answer has spent since its last finished step. */
export type Tone = 'model' | 'work' | 'running'

const toneOf = (step: DiagnosticsStep): Tone => (step.model === true ? 'model' : 'work')

/** Where the steps end: the latest end, in ms since the turn began; 0 without steps. */
export const stepsEnd = (steps: readonly DiagnosticsStep[]) =>
  steps.reduce((end, step) => Math.max(end, step.startMs + step.durationMs), 0)

/**
 * The answer's time: elapsed by the client's clock while it runs (the one
 * number that ticks), else the turn's time the server reported, else — when
 * the turn ended before the server sent it — where its last step ended.
 */
export function answerTime(turn: Pick<Turn<unknown>, 'status' | 'startedAt' | 'diagnostics'>, now: number): number {
  if (turn.status === 'pending' && turn.startedAt !== undefined) return Math.max(0, now - turn.startedAt)
  return turn.diagnostics?.durationMs ?? stepsEnd(turn.diagnostics?.steps ?? [])
}

/** One segment of the strip's bar and its share (0–1) of the bar. */
export interface Segment {
  key: string
  tone: Tone
  failed: boolean
  share: number
}

/**
 * The strip's bar: the steps in the order they started, every one of them
 * in it. Steps that ran at the same time (parallel tool calls) share one
 * segment that spans them. While the answer runs (`elapsedMs` given), a
 * running segment at the end stands for the time since the last step
 * ended. Each segment's share is of the time the segments cover; with no
 * time at all, the shares are equal.
 */
export function stripSegments(steps: readonly DiagnosticsStep[], elapsedMs?: number): Segment[] {
  const ordered = [...steps].sort((a, b) => a.startMs - b.startMs || a.index - b.index)
  const groups: { key: string; tone: Tone; failed: boolean; start: number; end: number }[] = []
  for (const step of ordered) {
    const end = step.startMs + step.durationMs
    const last = groups.at(-1)
    if (last !== undefined && step.startMs < last.end) {
      last.end = Math.max(last.end, end)
      if (step.model === true) last.tone = 'model'
      last.failed ||= step.failed === true
    } else {
      groups.push({ key: `step-${step.index}`, tone: toneOf(step), failed: step.failed === true, start: step.startMs, end })
    }
  }
  if (elapsedMs !== undefined) {
    const end = stepsEnd(steps)
    groups.push({ key: 'running', tone: 'running', failed: false, start: end, end: Math.max(end, elapsedMs) })
  }
  const covered = groups.reduce((sum, group) => sum + group.end - group.start, 0)
  return groups.map((group) => ({
    key: group.key,
    tone: group.tone,
    failed: group.failed,
    share: covered > 0 ? (group.end - group.start) / covered : 1 / groups.length,
  }))
}

/** Each segment's least width and the gap between two, in px. */
export const SEGMENT_MIN_PX = 2
export const SEGMENT_GAP_PX = 1
const BAR_MIN_PX = 64
const BAR_MAX_PX = 240
/** The room one segment gets before the bar reaches its most width. */
const SEGMENT_ROOM_PX = 6

/**
 * The bar's width in px: 64, wider with more segments so a model call
 * still reads as longer than the tool call beside it, and at most 240.
 * Past that, and where the strip has less room, every segment narrows
 * alike (`TimeBar`).
 */
export const barWidth = (count: number) =>
  Math.min(BAR_MAX_PX, Math.max(BAR_MIN_PX, count * SEGMENT_ROOM_PX))

/** A step's readable name: the kind's label for its name; a model step without one is a model call. */
export const stepName = (step: Pick<DiagnosticsStep, 'name'>, nameOf?: (name: string) => string) =>
  step.name === undefined ? 'Model call' : nameOf?.(step.name) ?? step.name

/** One row of the drawer's list. */
export interface StepRow {
  key: string
  /** The step's index; absent on the running row. */
  index?: number
  label: string
  tone: Tone
  failed: boolean
  durationMs: number
  /** Where its bar starts and how wide it is, in % of the answer's time. */
  left: number
  width: number
  /** A model step's tokens as reported and its finish reason. */
  facts: string[]
  plan?: Record<string, unknown>
}

/**
 * The drawer's list: one row per step in index order, its bar at its real
 * start on a scale of the answer's time (`timeMs`, or the steps' end when
 * they reach further). While the answer runs (`elapsedMs` given), a last
 * row runs from the end of the steps to now.
 */
export function stepRows(
  steps: readonly DiagnosticsStep[],
  timeMs: number,
  nameOf?: (name: string) => string,
  elapsedMs?: number,
): StepRow[] {
  const end = stepsEnd(steps)
  const scale = Math.max(timeMs, end, elapsedMs ?? 0)
  const at = (ms: number) => (scale > 0 ? (ms / scale) * 100 : 0)
  const rows = steps.map((step): StepRow => ({
    key: `step-${step.index}`,
    index: step.index,
    label: stepName(step, nameOf),
    tone: toneOf(step),
    failed: step.failed === true,
    durationMs: step.durationMs,
    left: at(step.startMs),
    width: scale > 0 ? at(step.durationMs) : 100,
    facts: [...usageParts(step.usage), ...(step.finishReason !== undefined ? [`finish: ${step.finishReason}`] : [])],
    ...(step.plan !== undefined && { plan: step.plan }),
  }))
  if (elapsedMs === undefined) return rows
  const rest = Math.max(0, scale - end)
  return [...rows, { key: 'running', label: 'Running', tone: 'running', failed: false, durationMs: rest, left: at(end), width: at(rest), facts: [] }]
}

/** The strip's numbers. */
export interface StripFacts {
  timeMs: number
  running: boolean
  modelCalls: number
  failed: number
  /** Input plus output tokens, as far as reported; absent when none were. */
  tokens?: number
}

export function stripFacts(diagnostics: Diagnostics, timeMs: number, running: boolean): StripFacts {
  const totals = stepTotals(diagnostics.steps ?? [])
  const { input, output } = totals.usage
  return {
    timeMs,
    running,
    modelCalls: totals.modelCalls,
    failed: totals.failed,
    ...(input !== undefined || output !== undefined ? { tokens: (input ?? 0) + (output ?? 0) } : {}),
  }
}

const plural = (n: number, one: string, many: string) => `${n.toLocaleString('en-US')} ${n === 1 ? one : many}`

/** `4.4 s` or `3.2 s so far`. */
export const timeText = (facts: Pick<StripFacts, 'timeMs' | 'running'>) => `${formatDuration(facts.timeMs)}${facts.running ? ' so far' : ''}`

/** `1 model call`, `2 model calls`. */
export const modelCallsText = (n: number) => plural(n, 'model call', 'model calls')

/** `4.4 s · 2 model calls · 10,840 tokens` — what the strip says beside its bar. */
export function stripText(facts: StripFacts): string {
  return [
    timeText(facts),
    modelCallsText(facts.modelCalls),
    ...(facts.tokens !== undefined ? [plural(facts.tokens, 'token', 'tokens')] : []),
  ].join(' · ')
}

/** `1 failed`, or null when no step failed. */
export const failedText = (facts: StripFacts) => (facts.failed > 0 ? `${facts.failed} failed` : null)

/** The strip button's accessible name: what it shows, and what it does. */
export function stripLabel(facts: StripFacts): string {
  const failed = failedText(facts)
  return `Diagnostics: ${stripText(facts)}${failed !== null ? ` · ${failed}` : ''}. Open the details.`
}

/** The strip's numbers and bar for an answer at `now` (which matters only while it runs). */
export function answerSummary(
  turn: Pick<Turn<unknown>, 'status' | 'startedAt' | 'diagnostics'>,
  now: number,
): { facts: StripFacts; segments: Segment[] } {
  const running = turn.status === 'pending'
  const timeMs = answerTime(turn, now)
  return {
    facts: stripFacts(turn.diagnostics ?? {}, timeMs, running),
    segments: stripSegments(turn.diagnostics?.steps ?? [], running ? timeMs : undefined),
  }
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
