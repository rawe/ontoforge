/**
 * Pure turn handling of the assistant chat, for every assistant kind: a
 * turn is one question and its answer; the shared stream events (`thread`,
 * `delta`, `final`, `error`) build the answer, and the kind folds its own
 * events into the turn's `insight` (what its side panel shows) through a
 * `TurnModel`. Timing is the client clock — the stream carries none.
 *
 * No React, no I/O — unit-tested with `node --test`.
 */

import type { SharedEvent } from '@/api/chatStream'
import type { ChatMessage } from '@/api/types'

/** The key of the built-in assistant every kind lists first. */
export const DEFAULT_ASSISTANT = '_default'

export type TurnStatus = 'pending' | 'complete' | 'failed'

/** One question and its answer. */
export interface Turn<I> {
  id: string
  question: string
  /** The answer so far: `delta` text while it runs, the `final` reply once complete. */
  reply: string
  status: TurnStatus
  /** Why a failed turn failed; absent when it was stopped. */
  error?: string
  /** A failed turn the user stopped. */
  stopped?: boolean
  /** What the kind reported about this answer — empty for a restored one. */
  insight: I
  /** Read back from the server's thread, not asked in this view. */
  restored?: boolean
  /** Client clock (ms) when the question was sent and the turn ended. */
  startedAt?: number
  finishedAt?: number
}

/** What a kind adds to the shared turn handling. */
export interface TurnModel<E, I> {
  /** The insight of a new or restored turn. */
  empty: () => I
  /** One of the kind's own events, at `now`. */
  apply: (insight: I, event: E, now: number) => I
  /** The turn ended unfinished at `now` (failed or stopped). */
  end?: (insight: I, now: number) => I
  /** Whether the side panel has something to show for this answer. */
  hasInsight: (insight: I) => boolean
  /** The live detail of a running turn: what it is doing right now. */
  progress: (insight: I) => string | undefined
}

/** The conversation was unknown or expired: the next message starts a new one. */
export const EXPIRED_TEXT = 'The previous conversation has expired. Your next message starts a new one.'
/** A stopped turn: the server discards it. */
export const STOPPED_TEXT = 'Stopped. This answer is not part of the conversation.'
/** The longest question every kind accepts. */
export const MAX_MESSAGE = 2000

const SHARED: ReadonlySet<string> = new Set(['thread', 'delta', 'final', 'error'])
const isShared = (event: { type: string }): event is SharedEvent => SHARED.has(event.type)

/** A new, pending turn, sent at `now`. */
export function pendingTurn<I>(id: string, question: string, insight: I, now: number): Turn<I> {
  return { id, question, reply: '', status: 'pending', insight, startedAt: now }
}

/** The turn after one stream event at `now`; the kind's events go to its model. */
export function applyEvent<E extends { type: string }, I>(
  model: TurnModel<E, I>,
  turn: Turn<I>,
  event: SharedEvent | E,
  now: number,
): Turn<I> {
  if (!isShared(event)) return { ...turn, insight: model.apply(turn.insight, event as E, now) }
  switch (event.type) {
    case 'thread':
      return turn
    case 'delta':
      return { ...turn, reply: turn.reply + event.text }
    case 'final':
      return { ...turn, reply: event.reply, status: 'complete', finishedAt: now }
    case 'error':
      return failTurn(model, turn, event.error.message, now)
  }
}

/** The turn failed at `now`; its partial answer stays. */
export function failTurn<E, I>(model: TurnModel<E, I>, turn: Turn<I>, error: string, now: number): Turn<I> {
  return { ...turn, status: 'failed', error, finishedAt: now, insight: model.end?.(turn.insight, now) ?? turn.insight }
}

/** The user stopped the turn at `now`; its partial answer stays. */
export function stopTurn<E, I>(model: TurnModel<E, I>, turn: Turn<I>, now: number): Turn<I> {
  return { ...turn, status: 'failed', stopped: true, finishedAt: now, insight: model.end?.(turn.insight, now) ?? turn.insight }
}

/** What an ended-unfinished turn says under its answer. */
export function endText(turn: Pick<Turn<unknown>, 'status' | 'error' | 'stopped'>): string | null {
  if (turn.status !== 'failed') return null
  return turn.stopped === true ? STOPPED_TEXT : `Incomplete: ${turn.error ?? ''}`
}

/**
 * A thread read back as turns: each question with the answer after it; an
 * answer without a question is dropped, a last question without one keeps
 * an empty answer.
 */
export function restoredTurns<I>(messages: readonly ChatMessage[], empty: () => I, newId: () => string): Turn<I>[] {
  const turns: Turn<I>[] = []
  for (const message of messages) {
    if (message.role === 'user') turns.push({ id: newId(), question: message.content, reply: '', status: 'complete', insight: empty(), restored: true })
    else if (turns.length > 0) turns[turns.length - 1]!.reply = message.content
  }
  return turns
}

/** The turn the side panel shows: the chosen one, else the latest with insight. */
export function inspectedTurn<I>(
  turns: readonly Turn<I>[],
  selectedId: string | null,
  hasInsight: (insight: I) => boolean,
): Turn<I> | undefined {
  const withInsight = turns.filter((t) => hasInsight(t.insight))
  return withInsight.find((t) => t.id === selectedId) ?? withInsight.at(-1)
}

/** How long the answer took, from sending to its end, in ms. */
export function turnDuration(turn: Pick<Turn<unknown>, 'startedAt' | 'finishedAt'>): number | undefined {
  return turn.startedAt !== undefined && turn.finishedAt !== undefined ? turn.finishedAt - turn.startedAt : undefined
}

/** `412 ms`, `2.4 s`. */
export function formatDuration(ms: number): string {
  return ms < 1000 ? `${Math.round(ms)} ms` : `${(ms / 1000).toFixed(1)} s`
}

/** Whole seconds since `since`, for the running indicator. */
export const elapsedSeconds = (since: number, now: number) => Math.max(0, Math.floor((now - since) / 1000))
