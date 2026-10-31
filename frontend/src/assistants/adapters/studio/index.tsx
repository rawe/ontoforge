import { Sparkles } from 'lucide-react'
import { Fragment } from 'react'
import { studioChat } from '@/api/model'
import type { ToolCall } from '@/api/types'
import type { ToolEvent } from '../../stream/chatStream'
import { ToolCallPanel, ToolCallsSummary } from '../../steps/ToolCallPanel'
import { toolCallTurns, toolError } from '../../steps/toolCallModel'
import type { PresentationAdapter, ToolCard } from '../../types'
import { studioResult } from './studioResult'

/** The cards a completed call of a tool puts under its answer, by tool name. */
const TOOL_CARDS: Record<string, ToolCard> = {}

const STEPS = { one: 'step', many: 'steps' }

/**
 * The Studio helper: the one built-in assistant bound to the whole
 * ontology; it reads the design only. Its name is a working name.
 */
export const studio: PresentationAdapter<ToolEvent<'studio'>, ToolCall[]> = {
  kind: 'studio',
  nouns: { one: 'Studio helper', many: 'Studio helpers' },
  icon: Sparkles,
  send: (at, _assistantKey, body, onEvent, signal) => studioChat(at.ontologyKey, body, onEvent, signal),
  model: toolCallTurns('studio'),
  cites: false,
  details: {
    label: (turn) => (turn.insight.length === 0 ? null : <ToolCallsSummary calls={turn.insight} nouns={STEPS} />),
    content: (turn, at) => (
      <div className="overflow-hidden rounded-lg border">
        <ToolCallPanel at={at} turn={turn} hasRestoredTurns={false} result={studioResult} />
      </div>
    ),
  },
  cards: (turn, at) => turn.insight
    .filter((call) => call.status === 'completed' && toolError(call) === null && Object.hasOwn(TOOL_CARDS, call.tool))
    .map((call) => <Fragment key={call.callId}>{TOOL_CARDS[call.tool]!(call, turn, at)}</Fragment>),
}
