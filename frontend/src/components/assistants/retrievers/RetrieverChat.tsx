import { Activity } from 'lucide-react'
import { useState, type ReactNode } from 'react'
import type { ChatRequest } from '@/api/chatStream'
import { chatRetriever } from '@/api/retrievers'
import type { RuntimeSchema, SearchCatalogEntry } from '@/api/types'
import { AssistantChat, InsightToggle } from '@/components/assistants/chat/AssistantChat'
import { formatDuration } from '@/components/assistants/chat/chatModel'
import { EntitiesTabs, type EntitiesTab } from '@/components/assistants/entities/EntitiesTabs'
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
   * decides whether diagnostics are requested and shown beside the
   * entities (the Workbench); `always`: requested and shown with every
   * answer (the Studio test panel).
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
 * answer's entities and, when requested, its diagnostics in the side panel.
 */
export function RetrieverChat({ ontologyKey, lensKey, retrieverKey, name, description, blockedReason, diagnostics, remember, catalog, schema, picker, actions }: RetrieverChatProps) {
  const [switchedOn, setSwitchedOn] = useState(() => readString(storageKeys.retrieverDiagnostics) === 'true')
  const withDiagnostics = diagnostics === 'always' || switchedOn
  const [tab, setTab] = useState<EntitiesTab>('entities')
  return (
    <AssistantChat
      ontologyKey={ontologyKey}
      lensKey={lensKey}
      kind="retrievers"
      assistantKey={retrieverKey}
      name={name}
      description={description}
      intro="Ask about a topic, an exact value, or both."
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
        panel: {
          title: 'Details',
          icon: Activity,
          subtitle: withDiagnostics
            ? 'What the selected answer found, and how. Pick another answer with its button.'
            : 'What the selected answer found. Pick another answer with its button.',
          content: (turn) => turn === undefined
            ? <p className="p-4 text-xs text-muted-foreground">
                Ask a question. The entities it finds{withDiagnostics && ', its plan, results, timings and model calls'} appear here while it runs.
              </p>
            : <EntitiesTabs
                ontologyKey={ontologyKey}
                lensKey={lensKey}
                turn={turn}
                own={withDiagnostics
                  ? { label: 'Diagnostics', content: <RetrieverDiagnosticsPanel meta={turn.insight.diagnostics} question={turn.question} status={turn.status} catalog={catalog} schema={schema} /> }
                  : undefined}
                tab={tab}
                onTab={setTab}
              />,
        },
        button: (turn) => {
          const { entities } = turn
          const diagnosed = withDiagnostics && retrieverTurns.hasInsight(turn.insight)
          if (entities.length === 0 && !diagnosed) return null
          const total = turn.insight.diagnostics.timings?.total
          return {
            icon: Activity,
            label: <>
              {entities.length} {entities.length === 1 ? 'entity' : 'entities'}
              {diagnosed && <span className="text-muted-foreground/70">· Diagnostics{total !== undefined && ` · ${formatDuration(total)}`}</span>}
            </>,
          }
        },
      }}
    />
  )
}
