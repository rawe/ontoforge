/**
 * Pure helpers of retrieve — a question to a retriever agent answered with
 * the found entities, no answer text: the palette's `!` question mode and
 * the editor test panel's Retrieve mode. The retriever choice (`Default`
 * first), when Enter sends, staleness, and the diagnostics a retrieve
 * reports in the chat diagnostics' shape. No React — unit-tested with
 * `node --test`.
 */
import type { RetrieveResponse, RetrieverAgent, RetrieverAgentMeta } from '@/api/retrieverAgents'
import { agentExecution } from './retrieverAgentModel.ts'

/** The key of every lens's implicit default retriever agent. */
export const DEFAULT_RETRIEVER = '_default'

/** Longest question the server accepts. */
export const MAX_QUESTION = 2000

/** The palette prefix of question mode. */
export const QUESTION_PREFIX = '!'

export interface RetrieverChoice {
  key: string
  name: string
  /** False for a stored agent its lens cannot run (invalid or unsupported). */
  selectable: boolean
}

/** The picker's list: `Default` first, then the lens's stored agents by name, the unrunnable ones not selectable. */
export function retrieverChoices(
  agents: readonly Pick<RetrieverAgent, 'key' | 'name' | 'configVersion' | 'config' | 'validation'>[] | undefined,
): RetrieverChoice[] {
  const stored = [...(agents ?? [])]
    .sort((a, b) => a.name.localeCompare(b.name) || a.key.localeCompare(b.key))
    .map((agent) => ({ key: agent.key, name: agent.name, selectable: agentExecution(agent, false).mode === 'saved' }))
  return [{ key: DEFAULT_RETRIEVER, name: 'Default', selectable: true }, ...stored]
}

/** The remembered retriever while it is listed and selectable, else `Default`. */
export function resolveRetriever(remembered: string | null, choices: readonly RetrieverChoice[]): string {
  const choice = choices.find((candidate) => candidate.key === remembered)
  return choice?.selectable === true ? choice.key : DEFAULT_RETRIEVER
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

/** A retrieve's diagnostics in the chat diagnostics' shape: one planning call, no answer. */
export function retrieveMeta(response: RetrieveResponse): RetrieverAgentMeta {
  const diagnostics = response.diagnostics
  return {
    plan: diagnostics?.plan,
    searchCalls: diagnostics?.searchCalls,
    timings: diagnostics?.timings,
    modelIO: diagnostics?.modelIO,
    llmCalls: diagnostics?.modelIO.length,
    limitations: [...(response.unsupportedReason ? [response.unsupportedReason] : []), ...response.limitations],
  }
}

/** The entities of a result list, for the Explorer's working set. */
export const resultEntities = (response: RetrieveResponse) =>
  response.results.map((result) => ({ typeKey: result.entityType, id: result.entityId }))
