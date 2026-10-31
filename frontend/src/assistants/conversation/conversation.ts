/**
 * The state of one conversation with one assistant, for every kind and
 * every surface that shows one: its turns, whether the remembered thread is
 * still being read back, and the notice above the messages. A pure reducer;
 * `useAssistantConversation` drives it.
 *
 * No React, no I/O — unit-tested with `node --test`.
 */
import { EXPIRED_TEXT, type Turn } from './chatModel.ts'

export interface Conversation<I> {
  turns: Turn<I>[]
  /** The remembered thread is being read back; nothing can be sent. */
  restoring: boolean
  notice: string | null
  /** Why the last message was refused before its stream opened; its text is back in the input. */
  refused: string | null
}

export type ConversationAction<I> =
  /** The remembered thread was read back; `expired` when the server no longer had it. */
  | { type: 'restored'; turns: Turn<I>[]; expired: boolean }
  /** Reading it back failed; the next message continues it. */
  | { type: 'restoreFailed'; error: string }
  /** A question was sent: its turn joins the conversation. */
  | { type: 'sent'; turn: Turn<I> }
  /** A turn changed: an event arrived, or it ended. */
  | { type: 'updated'; turn: Turn<I> }
  /** A message was refused for an expired thread: the conversation starts over. */
  | { type: 'expired' }
  /** A message was refused before its stream opened: its turn is taken back. */
  | { type: 'refused'; turnId: string; error: string }
  /** "New conversation". */
  | { type: 'cleared' }

export const startConversation = <I>(restoring: boolean): Conversation<I> => ({ turns: [], restoring, notice: null, refused: null })

/**
 * How a message whose request threw ended: the user stopped it, its thread
 * expired, it was refused before its stream opened (no event yet: the
 * thread was busy, or the server was not reached) — only where the surface
 * takes such a message back — or it failed.
 */
export function sendFailure({ aborted, code, opened, takeBack }: {
  aborted: boolean
  code: 'THREAD_NOT_FOUND' | 'THREAD_BUSY' | null
  opened: boolean
  takeBack: boolean
}): 'stopped' | 'expired' | 'refused' | 'failed' {
  if (aborted) return 'stopped'
  if (code === 'THREAD_NOT_FOUND') return 'expired'
  return takeBack && !opened ? 'refused' : 'failed'
}

export function conversationReducer<I>(state: Conversation<I>, action: ConversationAction<I>): Conversation<I> {
  switch (action.type) {
    case 'restored':
      return { ...state, turns: action.turns, restoring: false, notice: action.expired ? EXPIRED_TEXT : state.notice }
    case 'restoreFailed':
      return { ...state, restoring: false, notice: `Could not restore the conversation: ${action.error}` }
    case 'sent':
      return { ...state, turns: [...state.turns, action.turn], notice: null, refused: null }
    case 'updated':
      return { ...state, turns: state.turns.map((turn) => (turn.id === action.turn.id ? action.turn : turn)) }
    case 'expired':
      return { ...state, turns: [], notice: EXPIRED_TEXT, refused: null }
    case 'refused':
      return { ...state, turns: state.turns.filter((turn) => turn.id !== action.turnId), refused: action.error }
    case 'cleared':
      return { ...state, turns: [], notice: null, refused: null }
  }
}
