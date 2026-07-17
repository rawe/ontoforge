import { MessageCircleQuestion, MessagesSquare, ScanText, Sparkles } from 'lucide-react'
import { useParams, useSearchParams } from 'react-router-dom'
import { useFeatures, useRuntimeSchema } from '@/api/hooks'
import { AskTab } from '@/components/ai/AskTab'
import { ChatTab } from '@/components/ai/ChatTab'
import { ExtractTab } from '@/components/ai/ExtractTab'
import { EmptyState } from '@/components/EmptyState'
import { Skeleton } from '@/components/ui/skeleton'
import { Tabs, TabsContent, TabsList, TabsTrigger } from '@/components/ui/tabs'

const TABS = ['chat', 'ask', 'extract'] as const
type TabKey = (typeof TABS)[number]

/**
 * `/w/:ontologyKey/ai` — AI assistant with tabs Chat | Ask | Extract.
 * The active tab lives in `?tab=` so extract/ask can be deep-linked; all
 * three panels stay mounted so a long-running extraction survives tab
 * switches.
 */
export function AiPage() {
  const { ontologyKey } = useParams<{ ontologyKey: string }>()
  const { data: features } = useFeatures()
  const schema = useRuntimeSchema(ontologyKey)
  const [searchParams, setSearchParams] = useSearchParams()

  const rawTab = searchParams.get('tab')
  const tab: TabKey = TABS.includes(rawTab as TabKey) ? (rawTab as TabKey) : 'chat'

  if (ontologyKey === undefined) return null

  if (features?.ai === false) {
    return (
      <div>
        <header className="border-b px-6 py-4">
          <h1 className="text-[15px] font-semibold tracking-tight">AI</h1>
        </header>
        <EmptyState
          icon={Sparkles}
          title="AI is not enabled"
          description="This server has no AI provider configured. Set one up on the backend to unlock chat, one-shot questions and text extraction."
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
          <TabsTrigger value="ask" className="gap-1.5 px-2.5 text-[13px]">
            <MessageCircleQuestion className="size-3.5" />
            Ask
          </TabsTrigger>
          <TabsTrigger value="extract" className="gap-1.5 px-2.5 text-[13px]">
            <ScanText className="size-3.5" />
            Extract
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
          <TabsContent
            value="chat"
            forceMount
            className="flex min-h-0 flex-1 flex-col data-[state=inactive]:hidden"
          >
            <ChatTab key={ontologyKey} ontologyKey={ontologyKey} />
          </TabsContent>
          <TabsContent
            value="ask"
            forceMount
            className="min-h-0 flex-1 overflow-y-auto data-[state=inactive]:hidden"
          >
            <AskTab key={ontologyKey} ontologyKey={ontologyKey} />
          </TabsContent>
          <TabsContent
            value="extract"
            forceMount
            className="flex min-h-0 flex-1 flex-col data-[state=inactive]:hidden"
          >
            <ExtractTab
              key={ontologyKey}
              ontologyKey={ontologyKey}
              schema={schema.data}
              semanticEnabled={features?.semanticSearch === true}
            />
          </TabsContent>
        </>
      )}
    </Tabs>
  )
}
