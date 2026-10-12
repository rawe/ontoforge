import { useEffect, useReducer, useRef, useState } from 'react'
import { chatErrorText, threadError, type ChatRequest, type SharedEvent } from '@/api/chatStream'
import { applyEvent, failTurn, pendingTurn, restoredTurns, stopTurn, type Turn, type TurnModel } from './chatModel'
import { conversationReducer, startConversation, type Conversation, type ConversationAction } from './conversation'
import { forgetThread, rememberThread, rememberedThread, restoreThread, type ThreadOwner } from './threadStore'

interface ConversationOptions<E extends { type: string }, I> {
  /** Remember the thread under this owner and restore it on mount; null = each mount starts a new one. Fixed for a mount. */
  owner: ThreadOwner | null
  model: TurnModel<E, I>
  /** Send one message and read its turn; refusals before the stream throw. */
  send: (body: ChatRequest, onEvent: (event: SharedEvent | E) => void, signal: AbortSignal) => Promise<void>
  /** Nothing can be asked (no assistant yet, or questions are blocked). */
  blocked: boolean
  /** A question was sent. */
  onSent?: () => void
  /** An answer completed. */
  onComplete?: (turn: Turn<I>) => void
}

/**
 * One conversation with one assistant on a server thread, without any
 * layout: the turns, the input, send and stop, "New conversation", the
 * remembered thread's restore and expiry. Unmounting cancels the running
 * answer; late events never reach another conversation. Remount (React
 * `key`) for another assistant.
 */
export function useAssistantConversation<E extends { type: string }, I>({
  owner, model, send, blocked, onSent, onComplete,
}: ConversationOptions<E, I>) {
  const [state, dispatch] = useReducer(
    conversationReducer as (state: Conversation<I>, action: ConversationAction<I>) => Conversation<I>,
    owner !== null,
    startConversation<I>,
  )
  const [input, setInput] = useState('')
  const active = useRef<AbortController | null>(null)
  const threadId = useRef<string | null>(null)
  const callbacks = useRef({ onSent, onComplete })
  useEffect(() => {
    callbacks.current = { onSent, onComplete }
  })
  const running = state.turns.some((t) => t.status === 'pending')
  const canAsk = !blocked && !state.restoring

  useEffect(() => () => {
    const request = active.current
    active.current = null
    request?.abort()
  }, [])
  // The owner is fixed for a mount.
  useEffect(() => {
    if (owner === null) return
    const controller = new AbortController()
    restoreThread(owner, controller.signal).then(
      (restored) => {
        if (controller.signal.aborted) return
        threadId.current = restored.threadId
        dispatch({ type: 'restored', turns: restoredTurns(restored.messages, model.empty, () => crypto.randomUUID()), expired: restored.expired })
      },
      (error: unknown) => {
        if (controller.signal.aborted) return
        // Keep the remembered thread: the next message continues it.
        threadId.current = rememberedThread(owner)
        dispatch({ type: 'restoreFailed', error: chatErrorText(error, 'request failed') })
      },
    )
    return () => controller.abort()
  }, [owner, model])

  async function submit() {
    const question = input.trim()
    if (!question || !canAsk || active.current !== null) return
    const controller = new AbortController()
    active.current = controller
    let turn = pendingTurn(crypto.randomUUID(), question, model.empty(), Date.now())
    const save = () => { if (active.current === controller) dispatch({ type: 'updated', turn }) }
    setInput('')
    callbacks.current.onSent?.()
    dispatch({ type: 'sent', turn })
    const onEvent = (event: SharedEvent | E) => {
      if (active.current !== controller || controller.signal.aborted) return
      if (event.type === 'thread') {
        threadId.current = (event as SharedEvent & { type: 'thread' }).threadId
        if (owner !== null) rememberThread(owner, threadId.current)
      }
      turn = applyEvent(model, turn, event, Date.now())
      save()
    }
    try {
      await send({ message: question, threadId: threadId.current ?? undefined }, onEvent, controller.signal)
      if (active.current === controller && turn.status === 'complete') callbacks.current.onComplete?.(turn)
    } catch (error) {
      if (active.current !== controller) return
      if (controller.signal.aborted) {
        turn = stopTurn(model, turn, Date.now())
      } else if (threadError(error) === 'THREAD_NOT_FOUND') {
        // The thread expired: start over, the question back in the input.
        active.current = null
        threadId.current = null
        if (owner !== null) forgetThread(owner)
        dispatch({ type: 'expired' })
        setInput(question)
        return
      } else {
        turn = failTurn(model, turn, chatErrorText(error), Date.now())
      }
      save()
    } finally {
      if (active.current === controller) active.current = null
    }
  }

  /** Cancels the running answer; it ends as stopped. */
  const stop = () => active.current?.abort()

  /** "New conversation": the thread stays on the server until it expires. */
  function startOver() {
    threadId.current = null
    if (owner !== null) forgetThread(owner)
    dispatch({ type: 'cleared' })
  }

  return { ...state, input, setInput, running, canAsk, submit, stop, startOver }
}
