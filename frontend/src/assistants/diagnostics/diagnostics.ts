/**
 * An answer's diagnostics, the same for every assistant kind: asked with
 * `diagnostics: true` on the chat request, sent as `diagnostics` events.
 * Each event carries one finished step of the turn (a model call or other
 * work, measured by the server from the turn's start) or, last, the whole
 * turn's time. Steps upsert by index; the time replaces.
 *
 * No React, no I/O — unit-tested with `node --test`.
 */
import { optional, record, text } from '../../api/checks.ts'

/** Tokens as the provider reported them; a field is absent when it was not reported, a reported 0 stays 0. */
export interface TokenUsage {
  /** The whole prompt, cached parts included. */
  input?: number
  output?: number
  cacheRead?: number
  cacheWrite?: number
}

/** One finished step of the turn: one model call, or one piece of other work (a tool call, a pipeline step). */
export interface DiagnosticsStep {
  /** 1, 2, … in the order the steps started; the step's identity. */
  index: number
  /** The pipeline step or the tool; absent on a tool loop's model call. */
  name?: string
  /** The step is exactly one model call. */
  model?: true
  /** Whole ms since the turn began. */
  startMs: number
  durationMs: number
  /** Model steps only. */
  usage?: TokenUsage
  /** Model steps only, as the provider words it. */
  finishReason?: string
  /** The step threw. */
  failed?: true
  /** What a planning step decided; its shape is the kind's. */
  plan?: Record<string, unknown>
}

/** What the `diagnostics` events report about one answer, merged as they arrive. */
export interface Diagnostics {
  /** In index order. */
  steps?: DiagnosticsStep[]
  /** The whole turn, measured by the server; sent last. */
  durationMs?: number
}

export type DiagnosticsEvent = { type: 'diagnostics' } & Diagnostics

export const USAGE_FIELDS = ['input', 'output', 'cacheRead', 'cacheWrite'] as const

const count = (value: unknown) => typeof value === 'number' && Number.isInteger(value) && value >= 0
const position = (value: unknown) => count(value) && (value as number) > 0
const time = (value: unknown) => typeof value === 'number' && Number.isFinite(value) && value >= 0

const validUsage = (value: unknown) => record(value) && USAGE_FIELDS.every((field) => optional(value[field], count))

const validStep = (step: unknown) => record(step) &&
  position(step.index) && optional(step.name, text) && optional(step.model, (v) => v === true) &&
  time(step.startMs) && time(step.durationMs) &&
  optional(step.usage, validUsage) && optional(step.finishReason, text) &&
  optional(step.failed, (v) => v === true) && optional(step.plan, record)

/** A `diagnostics` event checked; throws on a malformed one. */
export function checkDiagnostics(e: Record<string, unknown>): DiagnosticsEvent {
  const valid = optional(e.steps, (steps) => Array.isArray(steps) && steps.every(validStep)) &&
    optional(e.durationMs, time)
  if (!valid) throw new Error('Invalid diagnostics event')
  return e as unknown as DiagnosticsEvent
}

/** One event merged into an answer's diagnostics: steps upsert by index (kept in index order), the time replaces. */
export function mergeDiagnostics(current: Diagnostics, next: Diagnostics): Diagnostics {
  const merged: Diagnostics = { ...current }
  if (next.steps !== undefined) {
    const steps = new Map((current.steps ?? []).map((step) => [step.index, step]))
    for (const step of next.steps) steps.set(step.index, step)
    merged.steps = [...steps.values()].sort((a, b) => a.index - b.index)
  }
  if (next.durationMs !== undefined) merged.durationMs = next.durationMs
  return merged
}

/** The diagnostics fields of an event, without its type. */
export function diagnosticsOf(event: DiagnosticsEvent): Diagnostics {
  return {
    ...(event.steps !== undefined && { steps: event.steps }),
    ...(event.durationMs !== undefined && { durationMs: event.durationMs }),
  }
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
