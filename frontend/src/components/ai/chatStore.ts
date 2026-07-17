/**
 * Persisted chat history: `of.chat.{ontologyKey}` holds a map of agent key →
 * messages (capped at 50 per agent) so each agent keeps its own thread.
 */

import type { ToolCall } from '@/api/types'
import { readJson, storageKeys, writeJson } from '@/lib/storage'

export interface StoredChatMessage {
  role: 'user' | 'assistant'
  content: string
  /** Only on assistant messages, when the backend reported tool usage. */
  toolCalls?: ToolCall[]
}

const CAP = 50

type ChatStore = Record<string, StoredChatMessage[]>

export function readChatHistory(ontologyKey: string, agentKey: string): StoredChatMessage[] {
  const store = readJson<ChatStore>(storageKeys.chat(ontologyKey))
  const messages = store?.[agentKey]
  return Array.isArray(messages) ? messages : []
}

export function writeChatHistory(
  ontologyKey: string,
  agentKey: string,
  messages: StoredChatMessage[],
): void {
  const store = readJson<ChatStore>(storageKeys.chat(ontologyKey)) ?? {}
  store[agentKey] = messages.slice(-CAP)
  writeJson(storageKeys.chat(ontologyKey), store)
}

export function clearChatHistory(ontologyKey: string, agentKey: string): void {
  const store = readJson<ChatStore>(storageKeys.chat(ontologyKey)) ?? {}
  delete store[agentKey]
  writeJson(storageKeys.chat(ontologyKey), store)
}
