import { StepList, type Turn } from '@/assistants'
import { EntityCardList } from '@/components/assistants/entities/EntityCardList'
import { roleInfo } from '@/components/assistants/entities/entityModel'
import { Tabs, TabsContent, TabsList, TabsTrigger } from '@/components/ui/tabs'
import { EvidenceGraph } from './EvidenceGraph'
import type { GraphInsight } from './graphTurnModel'

export type SidebarView = 'entities' | 'graph' | 'steps'

interface EvidenceSidebarProps {
  ontologyKey: string
  lensKey: string
  turn: Turn<GraphInsight>
  view: SidebarView
  onView: (view: SidebarView) => void
  /** The selected card's ref in this answer, if any. */
  selected: string | null
  onSelect: (ref: string) => void
}

/**
 * A graph kind's insight panel for one answer: the cards it found
 * (Entities), the same as a node-link view (Graph), and its pipeline with
 * live status (Steps). It fills while the answer streams.
 */
export function EvidenceSidebar({ ontologyKey, lensKey, turn, view, onView, selected, onSelect }: EvidenceSidebarProps) {
  const { entities, links } = turn
  return (
    <Tabs value={view} onValueChange={(value) => onView(value as SidebarView)} className="flex min-h-0 flex-1 flex-col gap-0">
      <div className="border-b px-3 py-2">
        <TabsList className="h-7 w-full">
          <TabsTrigger value="entities" className="text-xs">
            Entities{entities.length > 0 && <span className="tabular-nums text-muted-foreground">{entities.length}</span>}
          </TabsTrigger>
          <TabsTrigger value="graph" className="text-xs">Graph</TabsTrigger>
          <TabsTrigger value="steps" className="text-xs">Steps</TabsTrigger>
        </TabsList>
      </div>
      <TabsContent value="entities" className="min-h-0 flex-1 overflow-y-auto p-3">
        <EntityCardList ontologyKey={ontologyKey} lensKey={lensKey} turn={turn} selected={selected} onSelect={onSelect} />
      </TabsContent>
      <TabsContent value="graph" className="flex min-h-0 flex-1 flex-col">
        {entities.length === 0 ? (
          <p className="p-3 text-xs text-muted-foreground">
            {turn.status === 'pending' ? 'The graph appears here as the answer meets entities.' : 'This answer met no entities.'}
          </p>
        ) : <>
          <div className="min-h-[260px] flex-1">
            <EvidenceGraph entities={entities} links={links} selected={selected} onSelect={onSelect} />
          </div>
          <Legend />
        </>}
      </TabsContent>
      <TabsContent value="steps" className="min-h-0 flex-1 overflow-y-auto p-3">
        <StepList turn={turn} />
      </TabsContent>
    </Tabs>
  )
}

function Legend() {
  return (
    <div className="flex flex-wrap items-center gap-x-3 gap-y-1 border-t px-3 py-2 text-[11px] text-muted-foreground">
      {(['anchor', 'focus', 'reached'] as const).map((role) => (
        <span key={role} className="flex items-center gap-1.5">
          <span aria-hidden className="h-2.5 w-3.5 rounded-sm border-2" style={{ borderColor: roleInfo(role).color }} />
          {roleInfo(role).title}
        </span>
      ))}
      <span>· bold = evidence, faded = context</span>
    </div>
  )
}
