import { useMutation, useQueryClient } from '@tanstack/react-query'
import { Bot, ChevronLeft, ExternalLink, Layers, Plug, SquareTerminal, Trash2 } from 'lucide-react'
import { Link, useNavigate, useParams, useSearchParams } from 'react-router-dom'
import { toast } from 'sonner'
import * as model from '@/api/model'
import { useOntologies } from '@/api/hooks'
import { EmptyState } from '@/components/EmptyState'
import { AgentsTab } from '@/components/studio/AgentsTab'
import { ConnectTab } from '@/components/studio/ConnectTab'
import { ScopeTab } from '@/components/studio/ScopeTab'
import { SavedQueriesTab } from '@/components/studio/SavedQueriesTab'
import { invalidateModeling, toastError } from '@/components/studio/lib'
import { InlineText } from '@/components/studio/shared'
import { ScopeBadge } from '@/pages/studio/OntologiesPage'
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

/** `/studio/ontologies/:id` — scope editor, agents, saved queries, connect. */
export function OntologyDetailPage() {
  const { id } = useParams<{ id: string }>()
  const navigate = useNavigate()
  const queryClient = useQueryClient()
  const [searchParams, setSearchParams] = useSearchParams()
  const tabParam = searchParams.get('tab')
  const tab: Tab = TABS.includes(tabParam as Tab) ? (tabParam as Tab) : 'scope'

  const { data: ontologies, isPending } = useOntologies()
  const ontology = ontologies?.find((o) => o.ontologyId === id)

  const update = useMutation({
    mutationFn: (patch: { name: string; description: string | null }) =>
      model.updateOntology(id ?? '', patch),
    onSuccess: () => {
      invalidateModeling(queryClient)
      toast.success('Saved')
    },
    onError: toastError,
  })

  const remove = useMutation({
    mutationFn: () => model.deleteOntology(id ?? ''),
    onSuccess: () => {
      invalidateModeling(queryClient)
      toast.success('Ontology deleted')
      void navigate('/studio/ontologies')
    },
    onError: toastError,
  })

  if (isPending) {
    return (
      <div className="space-y-4 p-6">
        <Skeleton className="h-8 w-64" />
        <Skeleton className="h-64 rounded-xl" />
      </div>
    )
  }

  if (ontology === undefined) {
    return (
      <EmptyState
        icon={Layers}
        title="Ontology not found"
        description="It may have been deleted."
        action={
          <Button variant="outline" asChild>
            <Link to="/studio/ontologies">Back to ontologies</Link>
          </Button>
        }
      />
    )
  }

  return (
    <div>
      <header className="border-b px-6 py-4">
        <Link
          to="/studio/ontologies"
          className="mb-2 inline-flex items-center gap-1 text-xs text-muted-foreground transition-colors hover:text-foreground"
        >
          <ChevronLeft className="size-3.5" /> Ontologies
        </Link>
        <div className="flex flex-wrap items-center gap-3">
          <InlineText
            aria-label="Ontology name"
            value={ontology.name}
            onSave={(v) => {
              if (v !== '') update.mutate({ name: v, description: ontology.description })
            }}
            className="text-[15px] font-semibold tracking-tight"
            inputClassName="h-8 w-64 text-[15px] font-semibold"
          />
          <Badge variant="outline" className="font-mono text-[11px]" title="Immutable key">
            {ontology.key}
          </Badge>
          <ScopeBadge ontologyId={ontology.ontologyId} />
          <div className="ml-auto flex items-center gap-2">
            <Button variant="outline" size="sm" asChild>
              <Link to={`/w/${ontology.key}`}>
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
                  <AlertDialogTitle>Delete "{ontology.name}"?</AlertDialogTitle>
                  <AlertDialogDescription>
                    This deletes the ontology lens, its scope, agents and saved queries.
                    The global schema and instance data are not affected. This cannot be
                    undone.
                  </AlertDialogDescription>
                </AlertDialogHeader>
                <AlertDialogFooter>
                  <AlertDialogCancel>Cancel</AlertDialogCancel>
                  <AlertDialogAction variant="destructive" onClick={() => remove.mutate()}>
                    Delete ontology
                  </AlertDialogAction>
                </AlertDialogFooter>
              </AlertDialogContent>
            </AlertDialog>
          </div>
        </div>
        <div className="mt-1 max-w-2xl">
          <InlineText
            aria-label="Description"
            value={ontology.description ?? ''}
            placeholder="Add a description…"
            multiline
            onSave={(v) =>
              update.mutate({ name: ontology.name, description: v === '' ? null : v })
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
            <ScopeTab ontology={ontology} />
          </TabsContent>
          <TabsContent value="agents">
            <AgentsTab ontology={ontology} />
          </TabsContent>
          <TabsContent value="queries">
            <SavedQueriesTab ontology={ontology} />
          </TabsContent>
          <TabsContent value="connect">
            <ConnectTab ontology={ontology} />
          </TabsContent>
        </Tabs>
      </div>
    </div>
  )
}
