import type { ReactNode } from 'react'
import { agentTurns, type ChatRequest, formatDuration, type SharedEvent, ToolCallPanel, toolError, type Turn, type TurnModel } from '@/assistants'
import { chatNavigator } from '@/api/navigators'
import { chatRetriever } from '@/api/retrievers'
import { agentChat } from '@/api/runtime'
import type { AssistantKind } from '@/api/types'
import { StepList } from '@/components/assistants/graph/EvidenceSidebar'
import { graphTurns } from '@/components/assistants/graph/graphTurnModel'
import { retrieverTurns } from '@/components/assistants/retrievers/retrieverModel'

/** What the ask dock needs of one assistant kind. */
export interface AskKind<E extends { type: string }, I> {
  /** One message to an assistant of the kind; refusals before the stream throw. */
  send: (
    ontologyKey: string, lensKey: string, assistantKey: string,
    body: ChatRequest, onEvent: (event: SharedEvent | E) => void, signal: AbortSignal,
  ) => Promise<void>
  model: TurnModel<E, I>
  /** Its answers cite entities they met: auto-add has something to put on the canvas. */
  cites: boolean
  /** What the kind did for an answer, a collapsible section under it beside its entities; null for none. */
  details: null | {
    /** The section's button; null while the answer has nothing to show there. */
    label: (turn: Turn<I>) => ReactNode
    content: (turn: Turn<I>, at: { ontologyKey: string; lensKey: string }) => ReactNode
  }
}

/** A kind's entry without its own types: the dock hands an entry only turns its own model built. */
export type AnyAskKind = AskKind<{ type: string }, unknown>
const entry = <E extends { type: string }, I>(kind: AskKind<E, I>) => kind as unknown as AnyAskKind

const muted = (children: ReactNode) => <span className="text-muted-foreground/70">· {children}</span>

/** Per assistant kind: how the dock asks it and what it shows under an answer. */
export const ASK_KINDS: Record<AssistantKind, AnyAskKind> = {
  navigators: entry({
    send: chatNavigator,
    model: graphTurns,
    cites: true,
    details: {
      label: (turn) => {
        if (!graphTurns.hasInsight(turn.insight)) return null
        const ms = turn.insight.summary?.durationMs
        return <>Steps{ms !== undefined && muted(formatDuration(ms))}</>
      },
      content: (turn) => <div className="rounded-lg border p-3"><StepList turn={turn} /></div>,
    },
  }),
  // Diagnostics are the Workbench's; the dock shows the running phase only.
  retrievers: entry({
    send: (ontologyKey, lensKey, key, body, onEvent, signal) =>
      chatRetriever(ontologyKey, lensKey, key, { ...body, diagnostics: false }, onEvent, signal),
    model: retrieverTurns,
    cites: false,
    details: null,
  }),
  agents: entry({
    send: agentChat,
    model: agentTurns,
    cites: false,
    details: {
      label: (turn) => {
        const calls = turn.insight
        if (calls.length === 0) return null
        const errors = calls.filter((call) => toolError(call) !== null).length
        return <>
          {calls.length} tool {calls.length === 1 ? 'call' : 'calls'}
          {errors > 0 && <span className="text-(--tc-amber)">· {errors} with error</span>}
        </>
      },
      content: (turn, { ontologyKey, lensKey }) => (
        <div className="overflow-hidden rounded-lg border">
          <ToolCallPanel ontologyKey={ontologyKey} lensKey={lensKey} turn={turn} hasRestoredTurns={false} />
        </div>
      ),
    },
  }),
}
