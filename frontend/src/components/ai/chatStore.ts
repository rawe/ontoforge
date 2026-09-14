/**
 * Persisted chat history: `of.chat.{ontologyKey}.{lensKey}` holds a map of agent key →
 * messages (capped at 50 per agent) so each agent keeps its own thread.
 */

import type { ToolCall } from '@/api/types'
import { readJson, storageKeys, writeJson } from '@/lib/storage'

export interface StoredChatMessage {
  role: 'user' | 'assistant'
  content: string
  status?: 'pending' | 'completed' | 'failed'
  error?: string
  /** Only on assistant messages, when the backend reported tool usage. */
  toolCalls?: ToolCall[]
}

const CAP = 50

type ChatStore = Record<string, StoredChatMessage[]>

export function readChatHistory(ontologyKey: string, lensKey: string, agentKey: string): StoredChatMessage[] {
  const store = readJson<ChatStore>(storageKeys.chat(ontologyKey, lensKey))
  const messages = store?.[agentKey]
  return Array.isArray(messages) ? messages.filter((m) =>
    m && (m.role === 'user' || m.role === 'assistant') && typeof m.content === 'string',
  ).slice(-CAP).map(({ role, content, status, error }) => ({
    role, content, status: status === 'pending' ? 'failed' : status,
    ...(status === 'pending' ? { error: 'Turn interrupted' } : { error }),
  })) : []
}

export function writeChatHistory(
  ontologyKey: string,
  lensKey: string,
  agentKey: string,
  messages: StoredChatMessage[],
): void {
  const store = readJson<ChatStore>(storageKeys.chat(ontologyKey, lensKey)) ?? {}
  // Persist text and turn outcome only; large tool results remain live in memory.
  store[agentKey] = messages.slice(-CAP).map(({ role, content, status, error }) => ({
    role, content, status, error,
  }))
  writeJson(storageKeys.chat(ontologyKey, lensKey), store)
}

export function clearChatHistory(ontologyKey: string, lensKey: string, agentKey: string): void {
  const store = readJson<ChatStore>(storageKeys.chat(ontologyKey, lensKey)) ?? {}
  delete store[agentKey]
  writeJson(storageKeys.chat(ontologyKey, lensKey), store)
}
