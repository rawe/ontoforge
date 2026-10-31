import type { ReactNode } from 'react'
import type { Turn } from '@/assistants'
import { Tabs, TabsContent, TabsList, TabsTrigger } from '@/components/ui/tabs'
import { EntityCardList } from './EntityCardList'

export type EntitiesTab = 'entities' | 'own'

/**
 * The side panel of a kind that shows one view of its own beside the
 * entities (agents, retrievers): the answer's entity cards first, then the
 * kind's view. Without `own` the entities alone, without tabs.
 */
export function EntitiesTabs({ ontologyKey, lensKey, turn, own, tab, onTab }: {
  ontologyKey: string
  lensKey: string
  turn: Pick<Turn<unknown>, 'entities' | 'status'>
  /** The kind's own view: its tab name and body (which scrolls itself). */
  own?: { label: string; content: ReactNode }
  tab: EntitiesTab
  onTab: (tab: EntitiesTab) => void
}) {
  const list = <EntityCardList ontologyKey={ontologyKey} lensKey={lensKey} turn={turn} />
  if (own === undefined) return <div className="min-h-0 flex-1 overflow-y-auto p-3">{list}</div>
  return (
    <Tabs value={tab} onValueChange={(value) => onTab(value as EntitiesTab)} className="flex min-h-0 flex-1 flex-col gap-0">
      <div className="border-b px-3 py-2">
        <TabsList className="h-7 w-full">
          <TabsTrigger value="entities" className="text-xs">
            Entities{turn.entities.length > 0 && <span className="tabular-nums text-muted-foreground">{turn.entities.length}</span>}
          </TabsTrigger>
          <TabsTrigger value="own" className="text-xs">{own.label}</TabsTrigger>
        </TabsList>
      </div>
      <TabsContent value="entities" className="min-h-0 flex-1 overflow-y-auto p-3">{list}</TabsContent>
      <TabsContent value="own" className="flex min-h-0 flex-1 flex-col">{own.content}</TabsContent>
    </Tabs>
  )
}
