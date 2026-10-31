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
  /** "New conversation". */
  | { type: 'cleared' }

export const startConversation = <I>(restoring: boolean): Conversation<I> => ({ turns: [], restoring, notice: null })

export function conversationReducer<I>(state: Conversation<I>, action: ConversationAction<I>): Conversation<I> {
  switch (action.type) {
    case 'restored':
      return { turns: action.turns, restoring: false, notice: action.expired ? EXPIRED_TEXT : state.notice }
    case 'restoreFailed':
      return { ...state, restoring: false, notice: `Could not restore the conversation: ${action.error}` }
    case 'sent':
      return { ...state, turns: [...state.turns, action.turn], notice: null }
    case 'updated':
      return { ...state, turns: state.turns.map((turn) => (turn.id === action.turn.id ? action.turn : turn)) }
    case 'expired':
      return { ...state, turns: [], notice: EXPIRED_TEXT }
    case 'cleared':
      return { ...state, turns: [], notice: null }
  }
}
