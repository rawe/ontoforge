/**
 * An answer's diagnostics laid out, the same for every assistant kind:
 * its steps where the server placed them (`startMs`, `durationMs` from the
 * turn's start), so parallel work overlaps. The strip under an answer draws
 * them as one small bar beside its numbers, the diagnostics drawer as one
 * row per step, with the step's name as words and its detail to open. Also
 * stepping between the conversation's answers that have diagnostics.
 *
 * No React, no I/O — unit-tested with `node --test`.
 */
import { USAGE_FIELDS, type Diagnostics, type DiagnosticsStep, type TokenUsage } from './events.ts'

/** What diagnostics reads of one answer; a chat turn has all of it. */
export interface Answer {
  id: string
  question: string
  status: 'pending' | 'complete' | 'failed'
  /** A failed answer the user stopped. */
  stopped?: boolean
  /** Client clock (ms) when the question was sent: only the running answer's ticking time reads it. */
  startedAt?: number
  /** Present when the answer asked for diagnostics. */
  diagnostics?: Diagnostics
}

/** A model call, other work, or the time a running answer has spent since its last finished step. */
export type Tone = 'model' | 'work' | 'running'

const toneOf = (step: DiagnosticsStep): Tone => (step.model === true ? 'model' : 'work')

/** `412 ms`, `2.4 s`. */
export function formatDuration(ms: number): string {
  return ms < 1000 ? `${Math.round(ms)} ms` : `${(ms / 1000).toFixed(1)} s`
}

/**
 * A step's name as shown, by the one rule for every step of every kind:
 * the name the server sent with spaces for its underscores and its first
 * letter in upper case (`get_entity` → `Get entity`). A step without a
 * name is a model call. A name that reads badly this way is fixed where
 * the server records the step, never with a table here.
 */
export function stepName(step: Pick<DiagnosticsStep, 'name' | 'model'>): string {
  if (step.name === undefined || step.name === '') return step.model === true ? 'Model call' : 'Other work'
  const words = step.name.replace(/_/g, ' ')
  return words.charAt(0).toUpperCase() + words.slice(1)
}

/** The steps together: how many were model calls, how many failed, and the tokens reported — a field only when some step reported it. */
export function stepTotals(steps: readonly DiagnosticsStep[]): { modelCalls: number; failed: number; usage: TokenUsage } {
  const usage: TokenUsage = {}
  for (const step of steps) {
    for (const field of USAGE_FIELDS) {
      const value = step.usage?.[field]
      if (value !== undefined) usage[field] = (usage[field] ?? 0) + value
    }
  }
  return {
    modelCalls: steps.filter((step) => step.model === true).length,
    failed: steps.filter((step) => step.failed === true).length,
    usage,
  }
}

const USAGE_LABEL: Record<(typeof USAGE_FIELDS)[number], string> = {
  input: 'in', output: 'out', cacheRead: 'cache read', cacheWrite: 'cache write',
}

/** `5,210 in`, `312 out`, `4,800 cache read`, `0 cache write` — only what was reported, in that order. */
export function usageParts(usage: TokenUsage | undefined): string[] {
  if (usage === undefined) return []
  return USAGE_FIELDS.filter((field) => usage[field] !== undefined)
    .map((field) => `${usage[field]!.toLocaleString('en-US')} ${USAGE_LABEL[field]}`)
}

/** Where the steps end: the latest end, in ms since the turn began; 0 without steps. */
export const stepsEnd = (steps: readonly DiagnosticsStep[]) =>
  steps.reduce((end, step) => Math.max(end, step.startMs + step.durationMs), 0)

/**
 * The answer's time: elapsed by the client's clock while it runs (the one
 * number that ticks), else the turn's time the server reported, else — when
 * the turn ended before the server sent it — where its last step ended.
 */
export function answerTime(answer: Pick<Answer, 'status' | 'startedAt' | 'diagnostics'>, now: number): number {
  if (answer.status === 'pending' && answer.startedAt !== undefined) return Math.max(0, now - answer.startedAt)
  return answer.diagnostics?.durationMs ?? stepsEnd(answer.diagnostics?.steps ?? [])
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

/** The narrowest the bar may get in px. */
const BAR_LEAST_PX = 32

/**
 * The least width the bar keeps where the line is narrow: room for every
 * gap and one px per segment, so no segment narrows to nothing.
 */
export const barLeastWidth = (count: number) =>
  Math.min(barWidth(count), Math.max(BAR_LEAST_PX, count * (SEGMENT_GAP_PX + 1)))

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
  /** The step's detail, when it has one: the row opens to it. */
  detail?: string
}

/**
 * The drawer's list: one row per step in index order, its bar at its real
 * start on a scale of the answer's time (`timeMs`, or the steps' end when
 * they reach further). While the answer runs (`elapsedMs` given), a last
 * row runs from the end of the steps to now.
 */
export function stepRows(steps: readonly DiagnosticsStep[], timeMs: number, elapsedMs?: number): StepRow[] {
  const end = stepsEnd(steps)
  const scale = Math.max(timeMs, end, elapsedMs ?? 0)
  const at = (ms: number) => (scale > 0 ? (ms / scale) * 100 : 0)
  const rows = steps.map((step): StepRow => ({
    key: `step-${step.index}`,
    index: step.index,
    label: stepName(step),
    tone: toneOf(step),
    failed: step.failed === true,
    durationMs: step.durationMs,
    left: at(step.startMs),
    width: scale > 0 ? at(step.durationMs) : 100,
    facts: [...usageParts(step.usage), ...(step.finishReason !== undefined ? [`finish: ${step.finishReason}`] : [])],
    ...(step.detail !== undefined && step.detail !== '' && { detail: step.detail }),
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
  answer: Pick<Answer, 'status' | 'startedAt' | 'diagnostics'>,
  now: number,
): { facts: StripFacts; segments: Segment[] } {
  const running = answer.status === 'pending'
  const timeMs = answerTime(answer, now)
  return {
    facts: stripFacts(answer.diagnostics ?? {}, timeMs, running),
    segments: stripSegments(answer.diagnostics?.steps ?? [], running ? timeMs : undefined),
  }
}

/** The conversation's answers that have diagnostics, in order. */
export const diagnosedAnswers = <A extends Answer>(answers: readonly A[]) => answers.filter((answer) => answer.diagnostics !== undefined)

/** The answer the drawer shows: the chosen one, else (null) the latest with diagnostics. */
export function drawerAnswer<A extends Answer>(answers: readonly A[], id: string | null): A | undefined {
  const diagnosed = diagnosedAnswers(answers)
  return (id === null ? undefined : diagnosed.find((answer) => answer.id === id)) ?? diagnosed.at(-1)
}

/** Where an answer stands among those with diagnostics, and its neighbours ‹ ›. */
export function stepping(answers: readonly Answer[], id: string): { position: number; count: number; previous: string | null; next: string | null } {
  const diagnosed = diagnosedAnswers(answers)
  const at = diagnosed.findIndex((answer) => answer.id === id)
  return {
    position: at + 1,
    count: diagnosed.length,
    previous: at > 0 ? diagnosed[at - 1]!.id : null,
    next: at !== -1 && at < diagnosed.length - 1 ? diagnosed[at + 1]!.id : null,
  }
}
