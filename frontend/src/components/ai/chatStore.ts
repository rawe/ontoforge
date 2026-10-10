/**
 * Workbench conversations: the server holds each thread; the browser
 * remembers per ontology + lens + assistant only the current thread id
 * (`of.thread.…`, storage failures ignored) and restores the messages
 * from the server's thread read on open.
 */

import { readAssistantThread } from '@/api/runtime'
import { threadError } from '@/api/chatStream'
import type { AssistantKind, ChatMessage, ToolCall } from '@/api/types'
import { readString, remove, storageKeys, writeString } from '@/lib/storage'

/** One message of the agent chat view. */
export interface ChatEntry {
  /** Assistant turns of this session: identifies the turn the tool-call panel shows. */
  id?: string
  role: 'user' | 'assistant'
  content: string
  status?: 'pending' | 'completed' | 'failed'
  error?: string
  /** Only on assistant messages of this session, when the backend reported tool usage. */
  toolCalls?: ToolCall[]
  /** Client clock (ms) when an assistant turn of this session was sent and answered. */
  startedAt?: number
  finishedAt?: number
}

/** Which assistant a remembered thread belongs to. */
export interface ThreadOwner {
  ontologyKey: string
  lensKey: string
  kind: AssistantKind
  assistantKey: string
}

const key = (o: ThreadOwner) => storageKeys.thread(o.ontologyKey, o.lensKey, o.kind, o.assistantKey)

export const rememberedThread = (owner: ThreadOwner): string | null => readString(key(owner))
export const rememberThread = (owner: ThreadOwner, threadId: string) => writeString(key(owner), threadId)
/** "Clear" and "New conversation": the thread stays on the server until it expires. */
export const forgetThread = (owner: ThreadOwner) => remove(key(owner))

/** The thread was unknown or expired: the conversation is over. */
export const EXPIRED_TEXT = 'The previous conversation has expired. Your next message starts a new one.'

/**
 * The remembered thread's messages: none without one; `expired` when the
 * server no longer has it — then its id is forgotten. Other failures throw.
 */
export async function restoreThread(owner: ThreadOwner, signal: AbortSignal): Promise<{ threadId: string | null; messages: ChatMessage[]; expired: boolean }> {
  const threadId = rememberedThread(owner)
  if (threadId === null) return { threadId: null, messages: [], expired: false }
  try {
    const thread = await readAssistantThread(owner.ontologyKey, owner.lensKey, owner.kind, owner.assistantKey, threadId, signal)
    return { threadId, messages: thread.messages, expired: false }
  } catch (error) {
    if (threadError(error) !== 'THREAD_NOT_FOUND') throw error
    forgetThread(owner)
    return { threadId: null, messages: [], expired: true }
  }
}
