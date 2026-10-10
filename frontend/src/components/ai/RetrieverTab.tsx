import { ExternalLink } from 'lucide-react'
import { useEffect, useState } from 'react'
import { Link, useSearchParams } from 'react-router-dom'
import { useAssistants, useFeatures, useLenses, useRuntimeSchema, useSearchCatalog } from '@/api/hooks'
import { RetrieverChat } from '@/components/assistants/retrievers/RetrieverChat'
import { errorText } from '@/components/assistants/retrievers/errorText'
import { DEFAULT_RETRIEVER } from '@/components/assistants/retrievers/retrieveModel'
import { Button } from '@/components/ui/button'
import { Checkbox } from '@/components/ui/checkbox'
import { Skeleton } from '@/components/ui/skeleton'
import { readString, storageKeys, writeString } from '@/lib/storage'

const selectClass = 'h-8 rounded-md border bg-background px-2 text-sm disabled:opacity-50'

/**
 * Workbench AI → Retriever: chat with one of the lens's retrievers
 * from the runtime list — the built-in default first. The retriever is picked
 * in the header (`?agent=`, else Default); a question to one the lens
 * cannot run shows the server's refusal. Authoring lives in the Studio lens
 * detail ("Edit in Studio") — the default retriever has no editor.
 */
export function RetrieverTab({ ontologyKey, lensKey }: { ontologyKey: string; lensKey: string }) {
  const features = useFeatures().data
  const supported = features?.searchIndices === true
  const agents = useAssistants(ontologyKey, lensKey, 'retrievers', supported)
  const catalog = useSearchCatalog(ontologyKey, lensKey, supported)
  const schema = useRuntimeSchema(ontologyKey, lensKey)
  const lensId = useLenses(ontologyKey).data?.find((l) => l.key === lensKey)?.lensId
  const [searchParams, setSearchParams] = useSearchParams()
  const [diagnostics, setDiagnostics] = useState(() => readString(storageKeys.retrieverDiagnostics) === 'true')
  const requested = searchParams.get('agent')
  const resolvedKey = agents.data === undefined ? null
    : agents.data.find((a) => a.key === requested)?.key ?? DEFAULT_RETRIEVER
  // The URL always names the retriever shown (deep links, "Edit in Studio"), also when it was picked by default.
  useEffect(() => {
    if (resolvedKey === null || resolvedKey === requested) return
    setSearchParams((current) => { const next = new URLSearchParams(current); next.set('agent', resolvedKey); return next }, { replace: true })
  }, [resolvedKey, requested, setSearchParams])

  if (features?.searchIndices === false) {
    return <div className="p-6 text-sm text-muted-foreground">Retrievers answer over search indices, which this server's storage adapter does not support.</div>
  }
  if (agents.isPending) return <div className="space-y-3 p-6"><Skeleton className="h-8 w-64" /><Skeleton className="h-48 w-full" /></div>
  if (agents.error || !agents.data) {
    return <div className="p-6 text-sm"><p role="alert">Could not load retrievers: {errorText(agents.error)}</p><Button variant="outline" size="sm" className="mt-3" onClick={() => void agents.refetch()}>Reload</Button></div>
  }

  const list = agents.data
  const stored = list.filter((a) => !a.builtIn)
  const agent = list.find((a) => a.key === resolvedKey) ?? null
  const isDefault = agent === null || agent.builtIn
  const studioTab = lensId === undefined ? `/o/${ontologyKey}/studio/lenses` : `/o/${ontologyKey}/studio/lenses/${lensId}?tab=retriever-agents`
  const studioLink = agent !== null && lensId !== undefined ? `${studioTab}&agent=${encodeURIComponent(agent.key)}` : studioTab
  const choose = (key: string) => {
    const next = new URLSearchParams(searchParams)
    next.set('agent', key)
    setSearchParams(next, { replace: true })
  }

  return <div className="flex min-h-0 flex-1 flex-col">
    <div className="flex flex-wrap items-center gap-x-4 gap-y-2 border-b px-4 py-2">
      <label className="flex items-center gap-2 text-sm"><span className="font-medium">Retriever</span>
        <select aria-label="Retriever" className={`${selectClass} max-w-64`} value={resolvedKey ?? DEFAULT_RETRIEVER} onChange={(e) => choose(e.target.value)}>
          {list.map((item) => <option key={item.key} value={item.key}>{item.name}</option>)}
        </select>
      </label>
      {!isDefault && <Button size="sm" variant="ghost" className="h-8 gap-1" asChild><Link to={studioLink}><ExternalLink className="size-3.5" />Edit in Studio</Link></Button>}
      <label className="ml-auto flex cursor-pointer items-center gap-2 text-xs" title="Stream the search plan, results, timings and model calls with each answer">
        <Checkbox aria-label="Show diagnostics" checked={diagnostics} onCheckedChange={(checked) => { setDiagnostics(checked === true); writeString(storageKeys.retrieverDiagnostics, String(checked === true)) }} />Show diagnostics</label>
    </div>
    <RetrieverChat key={agent?.key ?? 'none'} ontologyKey={ontologyKey} lensKey={lensKey}
      agentKey={agent?.key ?? null} blockedReason={null} diagnostics={diagnostics} remember
      catalog={catalog.data} schema={schema.data}
      intro={<div className="mx-auto max-w-lg py-12 text-sm text-muted-foreground">{isDefault
        ? <><h3 className="mb-2 text-base font-medium text-foreground">Ask the default retriever</h3><p>It searches every switched-on managed index of this lens and may filter by the names of entities and of their direct neighbours. Ask about a topic, an exact name, or both.</p>
          <p className="mt-2">{stored.length === 0 ? 'For a tailored retriever, create one in the Studio.' : 'The lens\'s own retrievers are in the picker above.'}</p>
          {stored.length === 0 && <Button size="sm" variant="outline" className="mt-4 gap-1" asChild><Link to={studioTab}><ExternalLink className="size-3.5" />Create in Studio</Link></Button>}</>
        : <><h3 className="mb-2 text-base font-medium text-foreground">Ask {agent.name}</h3>{agent.description && <p className="mb-3">{agent.description}</p>}<p>Ask about a topic, an exact value, or both. Follow-up questions refer to completed answers in this conversation.</p></>}</div>} />
  </div>
}
