import { Activity } from 'lucide-react'
import { useState, type ReactNode } from 'react'
import type { ChatRequest } from '@/api/chatStream'
import { chatRetriever } from '@/api/retrievers'
import type { RuntimeSchema, SearchCatalogEntry } from '@/api/types'
import { AssistantChat, InsightToggle } from '@/components/assistants/chat/AssistantChat'
import { formatDuration } from '@/components/assistants/chat/chatModel'
import { readString, storageKeys, writeString } from '@/lib/storage'
import { RetrieverDiagnosticsPanel } from './RetrieverDiagnosticsPanel'
import { retrieverTurns } from './retrieverModel'

interface RetrieverChatProps {
  ontologyKey: string
  lensKey: string
  /** The retriever's key; null = nothing to ask yet (an unsaved draft). */
  retrieverKey: string | null
  name: string
  description: string | null
  /** Why questions are blocked (unsaved, invalid, unsupported); null = they run. */
  blockedReason: string | null
  /**
   * `toggle`: the "Show diagnostics" switch (remembered, off by default)
   * decides whether diagnostics are requested and shown (the Workbench);
   * `always`: requested and shown with every answer (the Studio test panel).
   */
  diagnostics: 'toggle' | 'always'
  /** Remember the thread in the browser and restore it on open (the Workbench); else each mount starts a new one. */
  remember: boolean
  catalog: SearchCatalogEntry[] | undefined
  schema: RuntimeSchema | undefined
  picker?: ReactNode
  /** Where "New conversation" goes instead of a toolbar (the Studio test panel's header). */
  actions?: HTMLElement | null
}

/**
 * The retriever kind of the assistant chat — the Workbench Retrievers tab
 * and the Studio test panel: the running phase as live detail, each
 * answer's diagnostics in the side panel.
 */
export function RetrieverChat({ ontologyKey, lensKey, retrieverKey, name, description, blockedReason, diagnostics, remember, catalog, schema, picker, actions }: RetrieverChatProps) {
  const [switchedOn, setSwitchedOn] = useState(() => readString(storageKeys.retrieverDiagnostics) === 'true')
  const withDiagnostics = diagnostics === 'always' || switchedOn
  return (
    <AssistantChat
      ontologyKey={ontologyKey}
      lensKey={lensKey}
      kind="retrievers"
      assistantKey={retrieverKey}
      name={name}
      description={description}
      intro="Ask about a topic, an exact value, or both. Follow-up questions refer to completed answers in this conversation."
      placeholder="What would you like to find?"
      remember={remember}
      blockedReason={blockedReason}
      model={retrieverTurns}
      send={(body: ChatRequest, onEvent, signal) =>
        retrieverKey === null ? Promise.resolve()
          : chatRetriever(ontologyKey, lensKey, retrieverKey, { ...body, diagnostics: withDiagnostics }, onEvent, signal)}
      picker={picker}
      actions={actions}
      toggle={diagnostics === 'toggle'
        ? <InsightToggle
            label="Show diagnostics"
            title="Stream the search plan, results, timings and model calls with each answer"
            checked={switchedOn}
            onChange={(checked) => {
              setSwitchedOn(checked)
              writeString(storageKeys.retrieverDiagnostics, String(checked))
            }}
          />
        : undefined}
      insight={{
        panel: withDiagnostics
          ? {
              title: 'Diagnostics',
              icon: Activity,
              subtitle: 'How the selected answer was found. Pick another answer with its Diagnostics button.',
              content: (turn) => turn === undefined
                ? <p className="p-4 text-xs text-muted-foreground">Ask a question. Its plan, results, timings and model calls appear here while it runs.</p>
                : <RetrieverDiagnosticsPanel meta={turn.insight.diagnostics} question={turn.question} status={turn.status} catalog={catalog} schema={schema} />,
            }
          : null,
        button: (turn) => {
          if (!retrieverTurns.hasInsight(turn.insight)) return null
          const total = turn.insight.diagnostics.timings?.total
          return { icon: Activity, label: <>Diagnostics{total !== undefined && ` · ${formatDuration(total)}`}</> }
        },
      }}
    />
  )
}
