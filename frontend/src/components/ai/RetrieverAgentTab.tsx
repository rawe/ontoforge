import { ExternalLink } from 'lucide-react'
import { useEffect, useState } from 'react'
import { Link, useSearchParams } from 'react-router-dom'
import { useFeatures, useLenses, useRetrieverAgents, useRuntimeSchema, useSearchCatalog } from '@/api/hooks'
import { RetrieverAgentChat } from '@/components/retrieverAgent/RetrieverAgentChat'
import { errorText } from '@/components/retrieverAgent/errorText'
import { agentExecution, isSupportedAgent } from '@/components/retrieverAgent/retrieverAgentModel'
import { Button } from '@/components/ui/button'
import { Checkbox } from '@/components/ui/checkbox'
import { Skeleton } from '@/components/ui/skeleton'
import { readString, storageKeys, writeString } from '@/lib/storage'

const selectClass = 'h-8 rounded-md border bg-background px-2 text-sm disabled:opacity-50'

/**
 * Workbench AI → Retriever: chat with the lens's saved retriever agents.
 * The agent is picked in the header (`?agent=`, else the first); authoring
 * lives in the Studio lens detail ("Edit in Studio").
 */
export function RetrieverAgentTab({ ontologyKey, lensKey }: { ontologyKey: string; lensKey: string }) {
  const features = useFeatures().data
  const supported = features?.searchIndices === true
  const agents = useRetrieverAgents(ontologyKey, lensKey, supported)
  const catalog = useSearchCatalog(ontologyKey, lensKey, supported)
  const schema = useRuntimeSchema(ontologyKey, lensKey)
  const lensId = useLenses(ontologyKey).data?.find((l) => l.key === lensKey)?.lensId
  const [searchParams, setSearchParams] = useSearchParams()
  const [diagnostics, setDiagnostics] = useState(() => readString(storageKeys.retrieverDiagnostics) === 'true')
  const requested = searchParams.get('agent')
  const resolvedKey = agents.data?.find((a) => a.key === requested)?.key ?? agents.data?.[0]?.key ?? null
  // The URL always names the agent shown (deep links, "Edit in Studio"), also when it was picked by default.
  useEffect(() => {
    if (resolvedKey === null || resolvedKey === requested) return
    setSearchParams((current) => { const next = new URLSearchParams(current); next.set('agent', resolvedKey); return next }, { replace: true })
  }, [resolvedKey, requested, setSearchParams])

  if (features?.searchIndices === false) {
    return <div className="p-6 text-sm text-muted-foreground">Retriever agents answer over search indices, which this server's storage adapter does not support.</div>
  }
  if (agents.isPending) return <div className="space-y-3 p-6"><Skeleton className="h-8 w-64" /><Skeleton className="h-48 w-full" /></div>
  if (agents.error || !agents.data) {
    return <div className="p-6 text-sm"><p role="alert">Could not load retriever agents: {errorText(agents.error)}</p><Button variant="outline" size="sm" className="mt-3" onClick={() => void agents.refetch()}>Reload</Button></div>
  }

  const list = agents.data
  const agent = list.find((a) => a.key === resolvedKey) ?? null
  const studioTab = lensId === undefined ? `/o/${ontologyKey}/studio/lenses` : `/o/${ontologyKey}/studio/lenses/${lensId}?tab=retriever-agents`
  const studioLink = agent !== null && lensId !== undefined ? `${studioTab}&agent=${encodeURIComponent(agent.key)}` : studioTab
  const execution = agentExecution(agent, false)
  const choose = (key: string) => {
    const next = new URLSearchParams(searchParams)
    next.set('agent', key)
    setSearchParams(next, { replace: true })
  }

  return <div className="flex min-h-0 flex-1 flex-col">
    <div className="flex flex-wrap items-center gap-x-4 gap-y-2 border-b px-4 py-2">
      <label className="flex items-center gap-2 text-sm"><span className="font-medium">Retriever agent</span>
        <select aria-label="Retriever agent" className={`${selectClass} max-w-64`} disabled={!list.length} value={agent?.key ?? ''} onChange={(e) => choose(e.target.value)}>
          {!list.length && <option value="">No retriever agent yet</option>}
          {list.map((item) => <option key={item.key} value={item.key}>{item.name}{!isSupportedAgent(item) || !item.validation.valid ? ' (invalid)' : ''}</option>)}
        </select>
      </label>
      <Button size="sm" variant="ghost" className="h-8 gap-1" asChild><Link to={studioLink}><ExternalLink className="size-3.5" />Edit in Studio</Link></Button>
      <label className="ml-auto flex cursor-pointer items-center gap-2 text-xs" title="Stream the search plan, results, timings and model calls with each answer">
        <Checkbox aria-label="Show diagnostics" checked={diagnostics} onCheckedChange={(checked) => { setDiagnostics(checked === true); writeString(storageKeys.retrieverDiagnostics, String(checked === true)) }} />Show diagnostics</label>
    </div>
    <RetrieverAgentChat key={agent ? `${agent.key}:${agent.updatedAt}` : 'none'} ontologyKey={ontologyKey} lensKey={lensKey}
      agentKey={agent?.key ?? null} blockedReason={execution.mode === 'blocked' ? execution.reason : null} diagnostics={diagnostics}
      config={agent && isSupportedAgent(agent) ? agent.config : null} catalog={catalog.data} schema={schema.data}
      intro={<div className="mx-auto max-w-lg py-12 text-sm text-muted-foreground">{agent === null
        ? <><h3 className="mb-2 text-base font-medium text-foreground">No retriever agent in this lens yet</h3><p>A retriever agent answers questions over this lens's search indices. Create and test one in the Studio, then chat with it here.</p>
          <Button size="sm" variant="outline" className="mt-4 gap-1" asChild><Link to={studioTab}><ExternalLink className="size-3.5" />Create in Studio</Link></Button></>
        : <><h3 className="mb-2 text-base font-medium text-foreground">Ask {agent.name}</h3>{agent.description && <p className="mb-3">{agent.description}</p>}<p>Ask about a topic, an exact value, or both. Follow-up questions refer to completed answers in this conversation.</p></>}</div>} />
  </div>
}
