import { Sparkles } from 'lucide-react'
import { useParams, useSearchParams } from 'react-router-dom'
import { useFeatures, useRuntimeSchema } from '@/api/hooks'
import { AgentChat } from '@/components/assistants/agents/AgentChat'
import { AssistantTab } from '@/components/assistants/chat/AssistantTab'
import { ASSISTANT_KINDS } from '@/components/assistants/kinds'
import { RetrieverTab } from '@/components/assistants/retrievers/RetrieverTab'
import { EmptyState } from '@/components/EmptyState'
import { Skeleton } from '@/components/ui/skeleton'
import { Tabs, TabsContent, TabsList, TabsTrigger } from '@/components/ui/tabs'

const TABS = ['chat', 'retriever'] as const
type TabKey = (typeof TABS)[number]

/**
 * `/o/:ontologyKey/w/:lensKey/ai` — Assistants, with tabs Agents (`chat`) | Retrievers (`retriever`).
 * The active tab lives in `?tab=`, the chosen assistant of that kind in
 * `?assistant=<key>`; an unknown tab falls back to chat. Leaving a tab
 * cancels its running turn.
 */
export function AiPage() {
  const { ontologyKey, lensKey } = useParams<{ ontologyKey: string; lensKey: string }>()
  const { data: features } = useFeatures()
  const schema = useRuntimeSchema(ontologyKey, lensKey)
  const [searchParams, setSearchParams] = useSearchParams()

  const rawTab = searchParams.get('tab')
  const tab: TabKey = TABS.includes(rawTab as TabKey) ? (rawTab as TabKey) : 'chat'

  if (ontologyKey === undefined || lensKey === undefined) return null

  if (features?.ai === false) {
    return (
      <div>
        <header className="border-b px-6 py-4">
          <h1 className="text-[15px] font-semibold tracking-tight">Assistants</h1>
        </header>
        <EmptyState
          icon={Sparkles}
          title="AI is not enabled"
          description="This server has no AI provider configured. Set one up on the backend to use assistants."
        />
      </div>
    )
  }

  return (
    <Tabs
      value={tab}
      onValueChange={(value) => {
        const next = new URLSearchParams(searchParams)
        if (value === 'chat') next.delete('tab')
        else next.set('tab', value)
        next.delete('assistant')
        setSearchParams(next, { replace: true })
      }}
      className="flex h-full min-h-0 flex-col gap-0"
    >
      <header className="flex items-center gap-4 border-b px-6 py-3">
        <h1 className="flex items-center gap-2 text-[15px] font-semibold tracking-tight">
          <Sparkles className="size-4 text-muted-foreground" />
          Assistants
        </h1>
        <TabsList className="h-8">
          <TabsTrigger value="chat" className="gap-1.5 px-2.5 text-[13px]">
            <ASSISTANT_KINDS.agents.icon className="size-3.5" />
            Agents
          </TabsTrigger>
          <TabsTrigger value="retriever" className="gap-1.5 px-2.5 text-[13px]">
            <ASSISTANT_KINDS.retrievers.icon className="size-3.5" />
            Retrievers
          </TabsTrigger>
        </TabsList>
      </header>

      {schema.data === undefined ? (
        <div className="space-y-3 p-6">
          <Skeleton className="h-8 w-64" />
          <Skeleton className="h-40 w-full max-w-2xl rounded-lg" />
        </div>
      ) : (
        <>
          <TabsContent value="retriever" className="flex min-h-0 flex-1 flex-col">
            {tab === 'retriever' && <RetrieverTab key={`${ontologyKey}/${lensKey}`} ontologyKey={ontologyKey} lensKey={lensKey} />}
          </TabsContent>
          <TabsContent value="chat" className="flex min-h-0 flex-1 flex-col">
            {tab === 'chat' && (
              <AssistantTab key={`${ontologyKey}/${lensKey}`} ontologyKey={ontologyKey} lensKey={lensKey} kind="agents">
                {(agent, picker) => <AgentChat key={agent.key} ontologyKey={ontologyKey} lensKey={lensKey} agent={agent} picker={picker} />}
              </AssistantTab>
            )}
          </TabsContent>
        </>
      )}
    </Tabs>
  )
}
