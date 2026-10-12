import { Waypoints } from 'lucide-react'
import { useState, type ReactNode } from 'react'
import type { ChatRequest, SharedEvent } from '@/api/chatStream'
import type { GraphEvent } from '@/api/graphEvents'
import type { AssistantKind } from '@/api/types'
import { AssistantChat, InsightToggle } from '@/components/assistants/chat/AssistantChat'
import { hasDetail } from '@/components/assistants/chat/chatModel'
import { CitedAnswer } from '@/components/assistants/entities/CitedAnswer'
import { readString, storageKeys, writeString } from '@/lib/storage'
import { EvidenceSidebar, type SidebarView } from './EvidenceSidebar'
import { graphTurns } from './graphTurnModel'

export interface GraphChatProps {
  ontologyKey: string
  lensKey: string
  kind: AssistantKind
  /** The assistant asked; null = nothing can be asked yet (an unsaved one). */
  assistantKey: string | null
  name: string
  description?: string | null
  intro: string
  placeholder: string
  /** Why questions are blocked (unsaved, invalid); null = they run. */
  blockedReason?: string | null
  /** Remember the thread in the browser and restore it on open (the Workbench); else each mount starts a new one. */
  remember: boolean
  /**
   * `toggle`: a "Show evidence" switch (remembered per kind, on by
   * default) shows or hides the sidebar (the Workbench); `always`: it is
   * always shown (the Studio test panel).
   */
  sidebar: 'toggle' | 'always'
  send: (body: ChatRequest, onEvent: (event: SharedEvent | GraphEvent) => void, signal: AbortSignal) => Promise<void>
  picker?: ReactNode
  /** Where "New conversation" goes instead of a toolbar (the Studio test panel's header). */
  actions?: HTMLElement | null
}

/**
 * The assistant chat of every graph kind: the evidence sidebar (Entities,
 * Graph, Steps) fills while an answer streams, and the answer's citations
 * are chips that select their card there.
 */
export function GraphChat({ kind, sidebar, send, ...chat }: GraphChatProps) {
  const [switchedOn, setSwitchedOn] = useState(() => readString(storageKeys.graphSidebar(kind)) !== 'false')
  const shown = sidebar === 'always' || switchedOn
  const [view, setView] = useState<SidebarView>('entities')
  // The selected card: its answer and ref (refs restart with every answer).
  const [selection, setSelection] = useState<{ turnId: string; ref: string } | null>(null)
  const selectedIn = (turnId: string) => (selection?.turnId === turnId ? selection.ref : null)

  return (
    <AssistantChat
      {...chat}
      kind={kind}
      model={graphTurns}
      send={send}
      toggle={sidebar === 'toggle'
        ? <InsightToggle
            label="Show evidence"
            title="Show each answer's entities, graph and steps in a sidebar, as it runs"
            checked={switchedOn}
            onChange={(checked) => {
              setSwitchedOn(checked)
              writeString(storageKeys.graphSidebar(kind), String(checked))
            }}
          />
        : undefined}
      renderAnswer={(turn, show) => (
        <CitedAnswer
          text={turn.reply}
          entities={turn.entities}
          selected={selectedIn(turn.id)}
          onSelect={(ref) => {
            setSelection({ turnId: turn.id, ref })
            setSwitchedOn(true)
            if (view === 'steps') setView('entities')
            show()
          }}
        />
      )}
      insight={{
        panel: shown
          ? {
              title: 'Evidence',
              icon: Waypoints,
              subtitle: 'What the selected answer found, and how. Pick another answer with its evidence button.',
              content: (turn, turns) => turn === undefined
                ? <p className="p-4 text-xs text-muted-foreground">
                    Ask a question. Its steps and the entities it finds appear here while it runs, before the answer.
                    {turns.some((t) => t.restored) && ' Earlier answers of a restored conversation have no evidence.'}
                  </p>
                : <EvidenceSidebar
                    ontologyKey={chat.ontologyKey}
                    lensKey={chat.lensKey}
                    turn={turn}
                    view={view}
                    onView={setView}
                    selected={selectedIn(turn.id)}
                    onSelect={(ref) => setSelection({ turnId: turn.id, ref })}
                  />,
            }
          : null,
        button: (turn) => {
          const { entities } = turn
          if (!hasDetail(turn, graphTurns.hasInsight)) return null
          const evidence = entities.filter((card) => card.evidence).length
          return {
            icon: Waypoints,
            label: entities.length === 0 ? 'Evidence'
              : <>{evidence} evidence <span className="text-muted-foreground/70">· {entities.length} {entities.length === 1 ? 'entity' : 'entities'}</span></>,
          }
        },
      }}
    />
  )
}
