/**
 * Pure helpers of retrieve — a question to a retriever agent answered with
 * the found entities, no answer text: the palette's `!` question mode and
 * the editor test panel's Retrieve mode. The retriever choice (the runtime
 * list, `Default` first), when Enter sends, and staleness. No React —
 * unit-tested with `node --test`.
 */
import type { RetrieveResponse } from '@/api/retrieverAgents'
import type { RuntimeAssistant } from '@/api/types'

/** The key of every lens's implicit default retriever agent. */
export const DEFAULT_RETRIEVER = '_default'

/** Longest question the server accepts. */
export const MAX_QUESTION = 2000

/** The palette prefix of question mode. */
export const QUESTION_PREFIX = '!'

/** The remembered retriever while the runtime list has it, else `Default`. */
export function resolveRetriever(remembered: string | null, choices: readonly Pick<RuntimeAssistant, 'key'>[] | undefined): string {
  return choices?.find((choice) => choice.key === remembered)?.key ?? DEFAULT_RETRIEVER
}

/** What has been asked: the question and how its request ended (or that it runs). */
export interface Asked {
  question: string
  status: 'running' | 'done' | 'failed'
}

/**
 * The question Enter sends, or null: 1 to 2,000 characters, and not the
 * question already running or answered — an unchanged question is not
 * resent; a failed one may be asked again.
 */
export function questionToSend(question: string, asked: Asked | null): string | null {
  const text = question.trim()
  if (text.length === 0 || text.length > MAX_QUESTION) return null
  if (asked !== null && asked.question === text && asked.status !== 'failed') return null
  return text
}

/** Results shown for an earlier question than the one in the input are stale. */
export const isStale = (question: string, answered: string | null) =>
  answered !== null && question.trim() !== answered

/** The entities of a result list, for the Explorer's working set. */
export const resultEntities = (response: RetrieveResponse) =>
  response.results.map((result) => ({ typeKey: result.entityType, id: result.entityId }))
