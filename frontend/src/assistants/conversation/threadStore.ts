/**
 * Remembered conversations: the server holds each thread; the browser
 * remembers per ontology + lens (for the Studio helper: + principal instead)
 * + kind + assistant only the current thread id (`of.thread.…`, storage failures
 * ignored) and restores the messages from the server's thread read on open.
 */

import type { ChatMessage } from '@/api/types'
import { readString, remove, storageKeys, writeString } from '../../lib/storage.ts'
import { assistantPath, readThread, threadError } from '../stream/chatStream.ts'
import type { Binding } from '../types.ts'

/** Which assistant a remembered thread belongs to. */
export interface ThreadOwner extends Binding {
  kind: string
  assistantKey: string
  /**
   * Bound to the whole ontology: whose thread it is — the user's id, null
   * without authentication — so one person's thread is never restored or
   * forgotten for another in the same browser. Unused for a lens's.
   */
  principal?: string | null
}

const key = (o: ThreadOwner) => storageKeys.thread(o.ontologyKey, o.lensKey, o.kind, o.assistantKey, o.principal ?? null)

export const rememberedThread = (owner: ThreadOwner): string | null => readString(key(owner))
export const rememberThread = (owner: ThreadOwner, threadId: string) => writeString(key(owner), threadId)
/** "New conversation": the thread stays on the server until it expires. */
export const forgetThread = (owner: ThreadOwner) => remove(key(owner))

/**
 * The remembered thread's messages: none without one; `expired` when the
 * server no longer has it — then its id is forgotten. Other failures throw.
 */
export async function restoreThread(owner: ThreadOwner, signal: AbortSignal): Promise<{ threadId: string | null; messages: ChatMessage[]; expired: boolean }> {
  const threadId = rememberedThread(owner)
  if (threadId === null) return { threadId: null, messages: [], expired: false }
  try {
    const thread = await readThread(assistantPath(owner, owner.kind, owner.assistantKey), threadId, signal)
    return { threadId, messages: thread.messages, expired: false }
  } catch (error) {
    if (threadError(error) !== 'THREAD_NOT_FOUND') throw error
    forgetThread(owner)
    return { threadId: null, messages: [], expired: true }
  }
}
