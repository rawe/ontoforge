import { useCallback, useEffect, useRef, useState } from 'react'
import { chatErrorText } from '@/api/chatStream'
import { retrieveWithAgent, type RetrieveResponse } from '@/api/retrieverAgents'
import { isStale, questionToSend, type Asked } from './retrieveModel'

/**
 * One retrieve at a time against one agent, results only: `send` asks a question unless
 * it is the one already running or answered, `cancel` aborts a running
 * request. The last results stay until the next ones arrive; they are
 * stale for another question or another agent. Changing the agent while a
 * question runs is the caller's to cancel.
 */
export function useRetrieve(ontologyKey: string, lensKey: string, agentKey: string | null) {
  // What was asked, and of which agent: another agent may be asked the same question.
  const [asked, setAsked] = useState<(Asked & { agentKey: string }) | null>(null)
  const askedHere = asked !== null && asked.agentKey === agentKey ? asked : null
  const [answered, setAnswered] = useState<{ question: string; agentKey: string; response: RetrieveResponse } | null>(null)
  const [error, setError] = useState<string | null>(null)
  const active = useRef<AbortController | null>(null)

  useEffect(() => () => active.current?.abort(), [])

  /** Abort the running request; true when one was running. */
  const cancel = useCallback(() => {
    const controller = active.current
    if (controller === null) return false
    active.current = null
    controller.abort()
    setAsked(null)
    return true
  }, [])

  const send = useCallback(
    (input: string) => {
      const question = agentKey === null ? null : questionToSend(input, askedHere)
      if (question === null || agentKey === null) return false
      active.current?.abort()
      const controller = new AbortController()
      active.current = controller
      setAsked({ question, status: 'running', agentKey })
      setError(null)
      retrieveWithAgent(ontologyKey, lensKey, agentKey, { query: question }, controller.signal).then(
        (response) => {
          if (controller.signal.aborted) return
          active.current = null
          setAsked({ question, status: 'done', agentKey })
          setAnswered({ question, agentKey, response })
        },
        (err: unknown) => {
          if (controller.signal.aborted) return
          active.current = null
          setAsked({ question, status: 'failed', agentKey })
          // A refused question names the server's reasons.
          setError(chatErrorText(err, 'Retrieve failed.'))
        },
      )
      return true
    },
    [agentKey, askedHere, lensKey, ontologyKey],
  )

  return {
    send,
    cancel,
    asked: askedHere,
    running: asked?.status === 'running',
    /** The question the shown results answer. */
    answered: answered?.question ?? null,
    response: answered?.response ?? null,
    error,
    /** Whether the shown results answer something else than `input` to this agent. */
    staleFor: (input: string) => answered !== null && (isStale(input, answered.question) || answered.agentKey !== agentKey),
  }
}
