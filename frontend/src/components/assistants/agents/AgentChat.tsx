import { Wrench } from 'lucide-react'
import { useState, type ReactNode } from 'react'
import { agentTurns, AssistantChat, type ChatRequest, InsightToggle, ToolCallPanel, toolError } from '@/assistants'
import { agentChat } from '@/api/runtime'
import { EntitiesTabs, type EntitiesTab } from '@/components/assistants/entities/EntitiesTabs'
import { readString, storageKeys, writeString } from '@/lib/storage'

interface AgentChatProps {
  ontologyKey: string
  lensKey: string
  /** The agent's key; null = nothing to ask yet (an unsaved draft). */
  agentKey: string | null
  name: string
  description: string | null
  /** Why questions are blocked (unsaved); null = they run. */
  blockedReason: string | null
  /** Remember the thread in the browser and restore it on open (the Workbench); else each mount starts a new one. */
  remember: boolean
  picker?: ReactNode
  /** Where "New conversation" goes instead of a toolbar (the Studio test panel's header). */
  actions?: HTMLElement | null
}

/**
 * The agent kind of the assistant chat — the Workbench Agents tab and the
 * Studio test panel: the entities the agent meets and its tool calls stream
 * into the side panel, each answer's button shows its own there. In the
 * Workbench the "Show details" switch (remembered, on by default) hides the
 * panel and the buttons; the Studio test panel always shows them.
 */
export function AgentChat({ ontologyKey, lensKey, agentKey, name, description, blockedReason, remember, picker, actions }: AgentChatProps) {
  const [switchedOn, setSwitchedOn] = useState(() => readString(storageKeys.chatToolCalls) !== 'false')
  const showToolCalls = !remember || switchedOn
  const [tab, setTab] = useState<EntitiesTab>('entities')
  return (
    <AssistantChat
      ontologyKey={ontologyKey}
      lensKey={lensKey}
      kind="agents"
      assistantKey={agentKey}
      name={name}
      description={description}
      intro="The agent can look up entities, traverse relations and run queries against this lens. Answers may take a while with local models."
      placeholder="Ask about your data…"
      remember={remember}
      blockedReason={blockedReason}
      model={agentTurns}
      send={(body: ChatRequest, onEvent, signal) =>
        agentKey === null ? Promise.resolve() : agentChat(ontologyKey, lensKey, agentKey, body, onEvent, signal)}
      picker={picker}
      actions={actions}
      toggle={remember
        ? <InsightToggle
            label="Show details"
            title="Show the entities each answer meets and its tool calls in a panel on the right, as they run"
            checked={switchedOn}
            onChange={(checked) => {
              setSwitchedOn(checked)
              writeString(storageKeys.chatToolCalls, String(checked))
            }}
          />
        : undefined}
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
