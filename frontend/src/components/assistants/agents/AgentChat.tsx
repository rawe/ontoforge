import { Wrench } from 'lucide-react'
import { useState, type ReactNode } from 'react'
import type { ChatRequest } from '@/api/chatStream'
import { agentChat } from '@/api/runtime'
import type { RuntimeAssistant } from '@/api/types'
import { AssistantChat, InsightToggle } from '@/components/assistants/chat/AssistantChat'
import { EntitiesTabs, type EntitiesTab } from '@/components/assistants/entities/EntitiesTabs'
import { readString, storageKeys, writeString } from '@/lib/storage'
import { ToolCallPanel } from './ToolCallPanel'
import { agentTurns, toolError } from './toolCallModel'

/**
 * The agent kind of the assistant chat (Workbench): the entities the agent
 * meets and its tool calls stream into the side panel, each answer's
 * button shows its own there; the "Show details" switch (remembered, on by
 * default) hides the panel and the buttons.
 */
export function AgentChat({ ontologyKey, lensKey, agent, picker }: {
  ontologyKey: string
  lensKey: string
  agent: RuntimeAssistant
  picker: ReactNode
}) {
  const [showToolCalls, setShowToolCalls] = useState(() => readString(storageKeys.chatToolCalls) !== 'false')
  const [tab, setTab] = useState<EntitiesTab>('entities')
  return (
    <AssistantChat
      ontologyKey={ontologyKey}
      lensKey={lensKey}
      kind="agents"
      assistantKey={agent.key}
      name={agent.name}
      description={agent.description}
      intro="The agent can look up entities, traverse relations and run queries against this lens. Answers may take a while with local models."
      placeholder="Ask about your data…"
      remember
      model={agentTurns}
      send={(body: ChatRequest, onEvent, signal) => agentChat(ontologyKey, lensKey, agent.key, body, onEvent, signal)}
      picker={picker}
      toggle={
        <InsightToggle
          label="Show details"
          title="Show the entities each answer meets and its tool calls in a panel on the right, as they run"
          checked={showToolCalls}
          onChange={(checked) => {
            setShowToolCalls(checked)
            writeString(storageKeys.chatToolCalls, String(checked))
          }}
        />
      }
      insight={{
        panel: showToolCalls
          ? {
              title: 'Details',
              icon: Wrench,
              subtitle: 'The entities the agent met and what it looked up for the selected answer. Pick another answer with its button.',
              content: (turn, turns) => {
                const toolCalls = <ToolCallPanel ontologyKey={ontologyKey} lensKey={lensKey} turn={turn} hasRestoredTurns={turns.some((t) => t.restored)} />
                return turn === undefined ? toolCalls : (
                  <EntitiesTabs
                    ontologyKey={ontologyKey}
                    lensKey={lensKey}
                    turn={turn}
                    own={{ label: 'Tool calls', content: toolCalls }}
                    tab={tab}
                    onTab={setTab}
                  />
                )
              },
            }
          : null,
        button: (turn) => {
          const calls = turn.insight
          const { entities } = turn
          if (calls.length === 0 && entities.length === 0) return null
          const errors = calls.filter((c) => toolError(c) !== null).length
          return {
            icon: Wrench,
            label: <>
              {calls.length} tool {calls.length === 1 ? 'call' : 'calls'}
              {errors > 0 && <span className="text-(--tc-amber)">· {errors} with error</span>}
              {entities.length > 0 && <span className="text-muted-foreground/70">· {entities.length} {entities.length === 1 ? 'entity' : 'entities'}</span>}
            </>,
          }
        },
      }}
    />
  )
}
