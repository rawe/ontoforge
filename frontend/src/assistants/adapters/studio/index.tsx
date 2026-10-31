import { Sparkles } from 'lucide-react'
import { Fragment } from 'react'
import { studioChat } from '@/api/model'
import type { ToolCall } from '@/api/types'
import { AgentDraftCard } from '../../draft/DraftFillCard'
import { ProposalCard } from '../../proposal/ProposalCard'
import { checkedCall, liveProposalCall, PROPOSE_TOOL, restoredCalls } from '../../proposal/proposalModel'
import type { ToolEvent } from '../../stream/chatStream'
import { ToolCallPanel, ToolCallsSummary } from '../../steps/ToolCallPanel'
import { toolCallTurns, toolError } from '../../steps/toolCallModel'
import type { PresentationAdapter, ToolCard } from '../../types'
import { studioResult } from './studioResult'

/** The cards a completed call of a tool puts under its answer, by tool name. */
const TOOL_CARDS: Record<string, ToolCard> = {
  fill_agent_draft: (call, _turn, at) => <AgentDraftCard call={call} at={at} />,
  [PROPOSE_TOOL]: (call, turn, at) => {
    const checked = checkedCall(call.args, call.result)
    // A failed answer's proposal is never offered.
    return checked === null || turn.status !== 'complete'
      ? null
      : <ProposalCard checked={checked} restored={turn.restored === true} at={at} />
  },
}

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
  // A restored answer brings back its proposal, from the thread's artifacts.
  model: { ...toolCallTurns('studio'), restore: restoredCalls },
  cites: false,
  details: {
    // A restored answer's steps are not kept, only its proposal.
    label: (turn) => (turn.restored === true || turn.insight.length === 0 ? null : <ToolCallsSummary calls={turn.insight} nouns={STEPS} />),
    content: (turn, at) => (
      <div className="overflow-hidden rounded-lg border">
        <ToolCallPanel at={at} turn={turn} hasRestoredTurns={false} result={studioResult} />
      </div>
    ),
  },
  // Each later proposal of an answer replaces the earlier ones: only its last call is live, and only when it succeeded.
  cards: (turn, at) => turn.insight
    .filter((call) => call.status === 'completed' && toolError(call) === null && Object.hasOwn(TOOL_CARDS, call.tool))
    .filter((call) => call.tool !== PROPOSE_TOOL || call === liveProposalCall(turn.insight))
    .map((call) => <Fragment key={call.callId}>{TOOL_CARDS[call.tool]!(call, turn, at)}</Fragment>),
}
