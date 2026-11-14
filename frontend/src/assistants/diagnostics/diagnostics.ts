/**
 * An answer's diagnostics, for every assistant kind: asked with
 * `diagnostics: true` on the chat request, sent as `diagnostics` events
 * that may arrive several times in a turn. The shared part is the turn's
 * model calls; a kind may add fields of its own (the retriever's plan,
 * results, timings, limitations). Events merge as they arrive.
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

/** One model call of the turn. */
export interface ModelCall {
  /** 1, 2, … in the order the calls started; the call's identity. */
  index: number
  /** The step that made the call, where the kind has steps. */
  name?: string
  durationMs: number
  usage?: TokenUsage
  finishReason?: string
  /** The call threw. */
  failed?: true
  /** Client clock (ms) when the call's entry first arrived — set by the client, never sent. */
  arrivedAt?: number
}

/** What the `diagnostics` events report about one answer, merged as they arrive. */
export interface Diagnostics {
  modelCalls?: ModelCall[]
  /** Merged by key. */
  timings?: Record<string, number>
  /** Deduplicated. */
  limitations?: string[]
  /** A kind's other fields: each replaces the one before. */
  [field: string]: unknown
}

export type DiagnosticsEvent = { type: 'diagnostics' } & Diagnostics

export const USAGE_FIELDS = ['input', 'output', 'cacheRead', 'cacheWrite'] as const

const count = (value: unknown) => typeof value === 'number' && Number.isInteger(value) && value >= 0
const position = (value: unknown) => count(value) && (value as number) > 0
const finite = (value: unknown) => typeof value === 'number' && Number.isFinite(value)

const validUsage = (value: unknown) => record(value) && USAGE_FIELDS.every((field) => optional(value[field], count))

const validCall = (call: unknown) => record(call) &&
  position(call.index) && optional(call.name, text) && finite(call.durationMs) &&
  optional(call.usage, validUsage) && optional(call.finishReason, text) && optional(call.failed, (v) => v === true)

/**
 * A `diagnostics` event checked: its model calls, timings and limitations
 * here, the kind's own fields by `own`. Throws on a malformed one.
 */
export function checkDiagnostics(e: Record<string, unknown>, own?: (e: Record<string, unknown>) => boolean): DiagnosticsEvent {
  const valid = optional(e.modelCalls, (calls) => Array.isArray(calls) && calls.every(validCall)) &&
    optional(e.timings, (timings) => record(timings) && Object.values(timings).every(finite)) &&
    optional(e.limitations, (items) => Array.isArray(items) && items.every(text)) &&
    (own?.(e) ?? true)
  if (!valid) throw new Error('Invalid diagnostics event')
  return e as DiagnosticsEvent
}

/**
 * One event's fields, arrived at `now`, merged into an answer's
 * diagnostics: model calls upsert by index (kept in index order, each
 * keeping when its entry first arrived), timings merge by key,
 * limitations dedupe, every other field replaces.
 */
export function mergeDiagnostics(current: Diagnostics, next: Diagnostics, now?: number): Diagnostics {
  const merged: Diagnostics = { ...current, ...next }
  if (next.modelCalls !== undefined) {
    const calls = new Map((current.modelCalls ?? []).map((call) => [call.index, call]))
    for (const call of next.modelCalls) {
      const arrivedAt = calls.get(call.index)?.arrivedAt ?? now
      calls.set(call.index, arrivedAt === undefined ? call : { ...call, arrivedAt })
    }
    merged.modelCalls = [...calls.values()].sort((a, b) => a.index - b.index)
  }
  if (next.timings !== undefined) merged.timings = { ...current.timings, ...next.timings }
  if (next.limitations !== undefined) merged.limitations = [...new Set([...(current.limitations ?? []), ...next.limitations])]
  return merged
}

/** The diagnostics fields of an event, without its type. */
export function diagnosticsOf(event: DiagnosticsEvent): Diagnostics {
  const fields: Diagnostics = { ...event }
  delete fields.type
  return fields
}

/** All calls together: how many, how many failed, their summed duration and the tokens reported — a field only when some call reported it. */
export function modelCallTotals(calls: readonly ModelCall[]): { calls: number; failed: number; durationMs: number; usage: TokenUsage } {
  const usage: TokenUsage = {}
  for (const call of calls) {
    for (const field of USAGE_FIELDS) {
      const value = call.usage?.[field]
      if (value !== undefined) usage[field] = (usage[field] ?? 0) + value
    }
  }
  return {
    calls: calls.length,
    failed: calls.filter((call) => call.failed === true).length,
    durationMs: calls.reduce((sum, call) => sum + call.durationMs, 0),
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
