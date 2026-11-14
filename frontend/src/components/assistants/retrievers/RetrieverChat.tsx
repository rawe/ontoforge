import { Activity } from 'lucide-react'
import type { ReactNode } from 'react'
import { AssistantChat, type ChatRequest } from '@/assistants'
import { chatRetriever, type RetrieverDiagnostics, type RetrieverModelCall } from '@/api/retrievers'
import type { RuntimeSchema, SearchCatalogEntry } from '@/api/types'
import { EntityCardList } from '@/components/assistants/entities/EntityCardList'
import { RetrieverCallTexts, RetrieverPlan, RetrieverResults, RetrieverTimingDetails } from './RetrieverDiagnostics'
import { MODEL_CALLS_INTRO, callCounts, modelCallName, retrieverParts, retrieverTurns } from './retrieverModel'

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
   * `toggle`: the shell's "Show diagnostics" switch decides whether
   * diagnostics are asked and shown (the Workbench); `always`: every answer
   * asks for them (the Studio test panel).
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

const metaOf = (diagnostics: unknown) => (diagnostics ?? {}) as RetrieverDiagnostics

/**
 * The retriever kind of the assistant chat — the Workbench Retrievers tab
 * and the Studio test panel: the running phase as live detail and each
 * answer's entities in the side panel. Diagnostics: its plan, retrieve and
 * answer steps, its model calls with their texts, its plan and results.
 */
export function RetrieverChat({ ontologyKey, lensKey, retrieverKey, name, description, blockedReason, diagnostics, remember, catalog, schema, picker, actions }: RetrieverChatProps) {
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
        retrieverKey === null ? Promise.resolve() : chatRetriever(ontologyKey, lensKey, retrieverKey, body, onEvent, signal)}
      picker={picker}
      actions={actions}
      diagnostics={{
        mode: diagnostics,
        time: (turn) => {
          const meta = metaOf(turn.diagnostics)
          return { parts: retrieverParts(meta, turn.insight, turn.status), totalMs: meta.timings?.total }
        },
        timeNote: 'The three steps run one after another.',
        timeDetail: (turn) => <RetrieverTimingDetails meta={metaOf(turn.diagnostics)} />,
        facts: (turn) => {
          const search = callCounts(metaOf(turn.diagnostics), turn.status).search
          return search === null ? [] : [`${search} ${search === 1 ? 'search call' : 'search calls'}`]
        },
        calls: {
          intro: MODEL_CALLS_INTRO,
          nameOf: modelCallName,
          detail: (call) => <RetrieverCallTexts call={call as RetrieverModelCall} />,
        },
        tabs: (turn) => {
          const meta = metaOf(turn.diagnostics)
          return [
            { value: 'plan', label: 'Plan', content: <RetrieverPlan meta={meta} catalog={catalog} schema={schema} /> },
            { value: 'results', label: `Results${meta.results ? ` (${meta.results.length})` : ''}`, content: <RetrieverResults meta={meta} catalog={catalog} schema={schema} /> },
          ]
        },
      }}
      insight={{
        panel: {
          title: 'Details',
          icon: Activity,
          subtitle: 'What the selected answer found. Pick another answer with its button.',
          content: (turn) => turn === undefined
            ? <p className="p-4 text-xs text-muted-foreground">Ask a question. The entities it finds appear here while it runs.</p>
            : <div className="min-h-0 flex-1 overflow-y-auto p-3"><EntityCardList ontologyKey={ontologyKey} lensKey={lensKey} turn={turn} /></div>,
        },
        button: (turn) => {
          const { entities } = turn
          if (entities.length === 0) return null
          return { icon: Activity, label: <>{entities.length} {entities.length === 1 ? 'entity' : 'entities'}</> }
        },
      }}
    />
  )
}
