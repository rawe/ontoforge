/**
 * The agent editor's draft: what it changes of an agent, the part the
 * Studio helper may fill, and how a new agent's key follows its name until
 * the person edits the key. No React, no I/O — unit-tested with `node --test`.
 */

import type { Agent, AgentInput } from '@/api/types'
import { deriveKey } from '../modeling/schemaKeys.ts'

/** What the editor changes of an agent; `tools` is kept while "All tools" is on. */
export interface AgentDraft {
  /** A new agent's key; a saved one's, fixed. */
  key: string
  /** Whether the person edited the key: until then a new agent's key follows the name. A saved one's counts as edited. */
  keyTouched: boolean
  name: string
  description: string
  systemPrompt: string
  allTools: boolean
  tools: string[]
}

export function draftOf(agent: Agent | null): AgentDraft {
  return {
    key: agent?.key ?? '',
    keyTouched: agent !== null,
    name: agent?.name ?? '',
    description: agent?.description ?? '',
    systemPrompt: agent?.systemPrompt ?? '',
    allTools: agent?.tools == null,
    tools: agent?.tools ?? [],
  }
}

/** The draft with a name, and the key derived from it while the person has not edited the key. */
export const withName = (draft: AgentDraft, name: string): AgentDraft =>
  ({ ...draft, name, key: draft.keyTouched ? draft.key : deriveKey(name) })

/** The draft with the key the person typed: it no longer follows the name. */
export const withKey = (draft: AgentDraft, key: string): AgentDraft => ({ ...draft, key, keyTouched: true })

/** What the Studio helper may fill: the agent's values, `tools` null for every tool. */
export type AgentFields = { name: string; description: string; systemPrompt: string; tools: string[] | null }

export const agentFields = (draft: AgentDraft): AgentFields => ({
  name: draft.name, description: draft.description, systemPrompt: draft.systemPrompt, tools: draft.allTools ? null : draft.tools,
})

/** The draft with filled values; "All tools" keeps the chosen tools, as its switch does, and the key follows the name as when typed. */
export const withAgentFields = (draft: AgentDraft, fields: AgentFields): AgentDraft => ({
  ...withName(draft, fields.name),
  description: fields.description, systemPrompt: fields.systemPrompt,
  allTools: fields.tools === null, tools: fields.tools ?? draft.tools,
})

export function sameDraft(a: AgentDraft, b: AgentDraft): boolean {
  return a.key === b.key && a.name === b.name && a.description === b.description && a.systemPrompt === b.systemPrompt
    && a.allTools === b.allTools && (a.allTools || (a.tools.length === b.tools.length && a.tools.every((t) => b.tools.includes(t))))
}

export function toInput(draft: AgentDraft): AgentInput {
  return {
    name: draft.name.trim(),
    description: draft.description.trim() === '' ? null : draft.description.trim(),
    systemPrompt: draft.systemPrompt.trim() === '' ? null : draft.systemPrompt,
    tools: draft.allTools ? null : draft.tools,
  }
}
