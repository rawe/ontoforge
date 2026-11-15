import { Activity } from 'lucide-react'
import type { ReactNode } from 'react'
import { AssistantChat, type ChatRequest } from '@/assistants'
import { chatRetriever, retrieverPlan } from '@/api/retrievers'
import type { RuntimeSchema, SearchCatalogEntry } from '@/api/types'
import { EntityCardList } from '@/components/assistants/entities/EntityCardList'
import { RetrieverPlan } from './RetrieverPlan'
import { phaseName, retrieverTurns } from './retrieverModel'

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

/**
 * The retriever kind of the assistant chat — the Workbench Retrievers tab
 * and the Studio test panel: the running phase as live detail and each
 * answer's entities in the side panel. Diagnostics: its plan, retrieve and
 * answer steps, a planning step opening to the plan it made.
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
        nameOf: phaseName,
        plan: (value) => {
          const plan = retrieverPlan(value)
          return plan === null ? null : <RetrieverPlan plan={plan} catalog={catalog} schema={schema} />
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
