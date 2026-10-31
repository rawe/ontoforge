import { Bot } from 'lucide-react'
import { agentChat } from '@/api/runtime'
import type { ToolCall } from '@/api/types'
import { ToolCallPanel, ToolCallsSummary } from '../../steps/ToolCallPanel'
import { agentTurns, type AgentEvent } from '../../steps/toolCallModel'
import type { PresentationAdapter } from '../../types'
import { lensOf } from '../lens'

/** Agents: a tool loop over the lens's read tools. */
export const agents: PresentationAdapter<AgentEvent, ToolCall[]> = {
  kind: 'agents',
  nouns: { one: 'Agent', many: 'agents' },
  icon: Bot,
  send: (at, key, body, onEvent, signal) => agentChat(at.ontologyKey, lensOf(at), key, body, onEvent, signal),
  model: agentTurns,
  cites: false,
  details: {
    label: (turn) => (turn.insight.length === 0 ? null : <ToolCallsSummary calls={turn.insight} />),
    content: (turn, at) => (
      <div className="overflow-hidden rounded-lg border">
        <ToolCallPanel at={at} turn={turn} hasRestoredTurns={false} />
      </div>
    ),
  },
}
