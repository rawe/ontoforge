import { MessagesSquare, Sparkles } from 'lucide-react'
import { useParams, useSearchParams } from 'react-router-dom'
import { useFeatures, useRuntimeSchema } from '@/api/hooks'
import { ChatTab } from '@/components/ai/ChatTab'
import { RetrieverAgentTab } from '@/components/ai/RetrieverAgentTab'
import { EmptyState } from '@/components/EmptyState'
import { Skeleton } from '@/components/ui/skeleton'
import { Tabs, TabsContent, TabsList, TabsTrigger } from '@/components/ui/tabs'

const TABS = ['chat', 'retriever'] as const
type TabKey = (typeof TABS)[number]

/**
 * `/o/:ontologyKey/w/:lensKey/ai` — AI assistant with tabs Chat | Retriever.
 * The active tab lives in `?tab=` so the retriever can be deep-linked (it
 * also takes `&agent=<key>`); an unknown tab falls back to chat. Leaving chat
 * or the retriever cancels its turn.
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
          <h1 className="text-[15px] font-semibold tracking-tight">AI</h1>
        </header>
        <EmptyState
          icon={Sparkles}
          title="AI is not enabled"
          description="This server has no AI provider configured. Set one up on the backend to unlock chat and retriever agents."
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
        if (value !== 'retriever') next.delete('agent')
        setSearchParams(next, { replace: true })
      }}
      className="flex h-full min-h-0 flex-col gap-0"
    >
      <header className="flex items-center gap-4 border-b px-6 py-3">
        <h1 className="flex items-center gap-2 text-[15px] font-semibold tracking-tight">
          <Sparkles className="size-4 text-muted-foreground" />
          AI
        </h1>
        <TabsList className="h-8">
          <TabsTrigger value="chat" className="gap-1.5 px-2.5 text-[13px]">
            <MessagesSquare className="size-3.5" />
            Chat
          </TabsTrigger>
          <TabsTrigger value="retriever" className="gap-1.5 px-2.5 text-[13px]">
            <Sparkles className="size-3.5" />
            Retriever
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
          <TabsContent value="retriever" className="flex min-h-0 flex-1 flex-col overflow-y-auto">
            {tab === 'retriever' && <RetrieverAgentTab key={`${ontologyKey}/${lensKey}`} ontologyKey={ontologyKey} lensKey={lensKey} />}
          </TabsContent>
          <TabsContent
            value="chat"
            forceMount
            className="flex min-h-0 flex-1 flex-col data-[state=inactive]:hidden"
          >
            {tab === 'chat' && <ChatTab
              key={`${ontologyKey}/${lensKey}`}
              ontologyKey={ontologyKey}
              lensKey={lensKey}
            />}
          </TabsContent>
        </>
      )}
    </Tabs>
  )
}
