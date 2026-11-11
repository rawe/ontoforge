import { Wrench } from 'lucide-react'
import { useState, type ReactNode } from 'react'
import {
  agentTurns, AssistantChat, type ChatRequest, DiagnosticsToggle, InsightToggle, ModelCallList, ToolCallPanel, ToolCallsSummary,
  useDiagnosticsSetting,
} from '@/assistants'
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
 * into the side panel, each answer's button shows its own there; with
 * diagnostics, its model calls too. In the Workbench the "Show details"
 * switch (remembered, on by default) hides the panel and the buttons, and
 * the "Show diagnostics" switch (shared by every kind, off by default) asks
 * for diagnostics; the Studio test panel always shows the panel and asks.
 */
export function AgentChat({ ontologyKey, lensKey, agentKey, name, description, blockedReason, remember, picker, actions }: AgentChatProps) {
  const [switchedOn, setSwitchedOn] = useState(() => readString(storageKeys.chatToolCalls) !== 'false')
  const [diagnosticsOn, setDiagnosticsOn] = useDiagnosticsSetting()
  const withDiagnostics = !remember || diagnosticsOn
  const showPanel = !remember || switchedOn || diagnosticsOn
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
        agentKey === null ? Promise.resolve() : agentChat(ontologyKey, lensKey, agentKey, { ...body, diagnostics: withDiagnostics }, onEvent, signal)}
      picker={picker}
      actions={actions}
      toggle={remember
        ? <>
            <InsightToggle
              label="Show details"
              title="Show the entities each answer meets and its tool calls in a panel on the right, as they run"
              checked={switchedOn}
              onChange={(checked) => {
                setSwitchedOn(checked)
                writeString(storageKeys.chatToolCalls, String(checked))
              }}
            />
            <DiagnosticsToggle checked={diagnosticsOn} onChange={setDiagnosticsOn} />
          </>
        : undefined}
      insight={{
        panel: showPanel
          ? {
              title: 'Details',
              icon: Wrench,
              subtitle: 'The entities the agent met and what it looked up for the selected answer. Pick another answer with its button.',
              content: (turn, turns) => {
                const toolCalls = <ToolCallPanel at={{ ontologyKey, lensKey }} turn={turn} hasRestoredTurns={turns.some((t) => t.restored)} />
                return turn === undefined ? toolCalls : (
                  <EntitiesTabs
                    ontologyKey={ontologyKey}
                    lensKey={lensKey}
                    turn={turn}
                    own={{ label: 'Tool calls', content: toolCalls }}
                    calls={withDiagnostics ? <ModelCallList calls={turn.diagnostics?.modelCalls} status={turn.status} /> : undefined}
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
          const diagnosed = withDiagnostics && turn.diagnostics !== undefined
          if (calls.length === 0 && entities.length === 0 && !diagnosed) return null
          return {
            icon: Wrench,
            label: <>
              <ToolCallsSummary calls={calls} />
              {entities.length > 0 && <span className="text-muted-foreground/70">· {entities.length} {entities.length === 1 ? 'entity' : 'entities'}</span>}
              {diagnosed && <span className="text-muted-foreground/70">· Diagnostics</span>}
            </>,
          }
        },
      }}
    />
  )
}
