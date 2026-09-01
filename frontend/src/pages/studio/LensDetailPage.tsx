import { useMutation, useQueryClient } from '@tanstack/react-query'
import { Bot, ChevronLeft, ExternalLink, Layers, Plug, SquareTerminal, Trash2 } from 'lucide-react'
import { Link, useNavigate, useParams, useSearchParams } from 'react-router-dom'
import { toast } from 'sonner'
import * as model from '@/api/model'
import { useLenses } from '@/api/hooks'
import { EmptyState } from '@/components/EmptyState'
import { AgentsTab } from '@/components/studio/AgentsTab'
import { ConnectTab } from '@/components/studio/ConnectTab'
import { ScopeTab } from '@/components/studio/ScopeTab'
import { SavedQueriesTab } from '@/components/studio/SavedQueriesTab'
import { invalidateModeling, toastError } from '@/components/studio/lib'
import { InlineText } from '@/components/studio/shared'
import { ScopeBadge } from '@/pages/studio/LensesPage'
import {
  AlertDialog,
  AlertDialogAction,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
  AlertDialogTrigger,
} from '@/components/ui/alert-dialog'
import { Badge } from '@/components/ui/badge'
import { Button } from '@/components/ui/button'
import { Skeleton } from '@/components/ui/skeleton'
import { Tabs, TabsContent, TabsList, TabsTrigger } from '@/components/ui/tabs'

const TABS = ['scope', 'agents', 'queries', 'connect'] as const
type Tab = (typeof TABS)[number]

/** `/o/:ontologyKey/studio/lenses/:id` — scope editor, agents, saved queries, connect. */
export function LensDetailPage() {
  const { ontologyKey, id } = useParams<{ ontologyKey: string; id: string }>()
  const navigate = useNavigate()
  const queryClient = useQueryClient()
  const [searchParams, setSearchParams] = useSearchParams()
  const tabParam = searchParams.get('tab')
  const tab: Tab = TABS.includes(tabParam as Tab) ? (tabParam as Tab) : 'scope'

  const { data: lenses, isPending } = useLenses(ontologyKey)
  const lens = lenses?.find((o) => o.lensId === id)

  const update = useMutation({
    mutationFn: (patch: { name: string; description: string | null }) =>
      model.updateLens(ontologyKey ?? '', id ?? '', patch),
    onSuccess: () => {
      invalidateModeling(queryClient)
      toast.success('Saved')
    },
    onError: toastError,
  })

  const remove = useMutation({
    mutationFn: () => model.deleteLens(ontologyKey ?? '', id ?? ''),
    onSuccess: () => {
      invalidateModeling(queryClient)
      toast.success('Lens deleted')
      void navigate(`/o/${ontologyKey}/studio/lenses`)
    },
    onError: toastError,
  })

  if (ontologyKey === undefined) return null

  if (isPending) {
    return (
      <div className="space-y-4 p-6">
        <Skeleton className="h-8 w-64" />
        <Skeleton className="h-64 rounded-xl" />
      </div>
    )
  }

  if (lens === undefined) {
    return (
      <EmptyState
        icon={Layers}
        title="Lens not found"
        description="It may have been deleted."
        action={
          <Button variant="outline" asChild>
            <Link to={`/o/${ontologyKey}/studio/lenses`}>Back to lenses</Link>
          </Button>
        }
      />
    )
  }

  return (
    <div>
      <header className="border-b px-6 py-4">
        <Link
          to={`/o/${ontologyKey}/studio/lenses`}
          className="mb-2 inline-flex items-center gap-1 text-xs text-muted-foreground transition-colors hover:text-foreground"
        >
          <ChevronLeft className="size-3.5" /> Lenses
        </Link>
        <div className="flex flex-wrap items-center gap-3">
          <InlineText
            aria-label="Lens name"
            value={lens.name}
            onSave={(v) => {
              if (v !== '') update.mutate({ name: v, description: lens.description })
            }}
            className="text-[15px] font-semibold tracking-tight"
            inputClassName="h-8 w-64 text-[15px] font-semibold"
          />
          <Badge variant="outline" className="font-mono text-[11px]" title="Immutable key">
            {lens.key}
          </Badge>
          <ScopeBadge ontologyKey={ontologyKey} lensId={lens.lensId} />
          <div className="ml-auto flex items-center gap-2">
            <Button variant="outline" size="sm" asChild>
              <Link to={`/o/${ontologyKey}/w/${lens.key}`}>
                <ExternalLink className="size-3.5" /> Open in Workbench
              </Link>
            </Button>
            <AlertDialog>
              <AlertDialogTrigger asChild>
                <Button variant="destructive" size="sm">
                  <Trash2 className="size-3.5" /> Delete
                </Button>
              </AlertDialogTrigger>
              <AlertDialogContent>
                <AlertDialogHeader>
                  <AlertDialogTitle>Delete "{lens.name}"?</AlertDialogTitle>
                  <AlertDialogDescription>
                    This deletes the lens, its scope, agents and saved queries.
                    The ontology's schema and instance data are not affected. This
                    cannot be undone.
                  </AlertDialogDescription>
                </AlertDialogHeader>
                <AlertDialogFooter>
                  <AlertDialogCancel>Cancel</AlertDialogCancel>
                  <AlertDialogAction variant="destructive" onClick={() => remove.mutate()}>
                    Delete lens
                  </AlertDialogAction>
                </AlertDialogFooter>
              </AlertDialogContent>
            </AlertDialog>
          </div>
        </div>
        <div className="mt-1 max-w-2xl">
          <InlineText
            aria-label="Description"
            value={lens.description ?? ''}
            placeholder="Add a description…"
            multiline
            onSave={(v) =>
              update.mutate({ name: lens.name, description: v === '' ? null : v })
            }
            className="block w-full text-[13px] text-muted-foreground"
          />
        </div>
      </header>

      <div className="p-6">
        <Tabs
          value={tab}
          onValueChange={(v) => {
            setSearchParams(v === 'scope' ? {} : { tab: v }, { replace: true })
          }}
        >
          <TabsList className="mb-4">
            <TabsTrigger value="scope">
              <Layers className="size-3.5" /> Scope
            </TabsTrigger>
            <TabsTrigger value="agents">
              <Bot className="size-3.5" /> Agents
            </TabsTrigger>
            <TabsTrigger value="queries">
              <SquareTerminal className="size-3.5" /> Saved queries
            </TabsTrigger>
            <TabsTrigger value="connect">
              <Plug className="size-3.5" /> Connect
            </TabsTrigger>
          </TabsList>
          <TabsContent value="scope">
            <ScopeTab ontologyKey={ontologyKey} lens={lens} />
          </TabsContent>
          <TabsContent value="agents">
            <AgentsTab ontologyKey={ontologyKey} lens={lens} />
          </TabsContent>
          <TabsContent value="queries">
            <SavedQueriesTab ontologyKey={ontologyKey} lens={lens} />
          </TabsContent>
          <TabsContent value="connect">
            <ConnectTab ontologyKey={ontologyKey} lens={lens} />
          </TabsContent>
        </Tabs>
      </div>
    </div>
  )
}
