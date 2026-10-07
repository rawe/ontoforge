import { LoaderCircle, SendHorizonal, Square } from 'lucide-react'
import { useMemo, useState } from 'react'
import type { RetrieverAgentConfig } from '@/api/retrieverAgents'
import type { RuntimeSchema, SearchCatalogEntry } from '@/api/types'
import { Button } from '@/components/ui/button'
import { Textarea } from '@/components/ui/textarea'
import { RetrievalResults } from './RetrievalResults'
import { RetrieverAgentDiagnostics } from './RetrieverAgentDiagnostics'
import { MAX_QUESTION, questionToSend, retrieveMeta } from './retrieveModel'
import { useRetrieve } from './useRetrieve'

interface RetrieverAgentRetrieveProps {
  ontologyKey: string
  lensKey: string
  /** The saved agent's key; null = nothing to ask yet. */
  agentKey: string | null
  /** Why questions are blocked (unsaved, invalid, unsupported); null = they run. */
  blockedReason: string | null
  config: RetrieverAgentConfig | null
  catalog: SearchCatalogEntry[] | undefined
  schema: RuntimeSchema | undefined
}

/**
 * The test panel's Retrieve mode: one question to the saved agent, the
 * found entities without an answer, and the diagnostics that apply —
 * overview, plan and the one planning call. Remount it (React `key`) when
 * the saved agent changes: saving clears the result.
 */
export function RetrieverAgentRetrieve({ ontologyKey, lensKey, agentKey, blockedReason, config, catalog, schema }: RetrieverAgentRetrieveProps) {
  const [input, setInput] = useState('')
  const canAsk = agentKey !== null && blockedReason === null
  const retrieve = useRetrieve(ontologyKey, lensKey, canAsk ? agentKey : null, true)
  const sendable = canAsk && questionToSend(input, retrieve.asked) !== null
  const meta = useMemo(() => (retrieve.response ? retrieveMeta(retrieve.response) : null), [retrieve.response])

  return <div className="@container flex min-h-0 flex-1 flex-col">
    <div className="flex min-h-0 flex-1 flex-col @3xl:flex-row">
      <section className="flex min-h-[360px] min-w-0 flex-1 flex-col">
        <div className="space-y-2 border-b p-4">
          {agentKey !== null && blockedReason !== null && <p role="status" className="rounded border border-amber-500/30 bg-amber-500/5 px-3 py-2 text-xs">{blockedReason}</p>}
          <form className="flex items-end gap-2" onSubmit={(e) => { e.preventDefault(); retrieve.send(input) }}>
            <Textarea aria-label="Question for retrieval" placeholder="What would you like to find?" value={input} disabled={agentKey === null} rows={2} maxLength={MAX_QUESTION}
              onChange={(e) => { setInput(e.target.value); if (retrieve.running) retrieve.cancel() }}
              onKeyDown={(e) => { if (e.key === 'Enter' && !e.shiftKey && !e.nativeEvent.isComposing) { e.preventDefault(); if (sendable) retrieve.send(input) } }} />
            {retrieve.running
              ? <Button type="button" variant="outline" aria-label="Cancel" onClick={() => retrieve.cancel()}><Square className="size-4" /></Button>
              : <Button type="submit" aria-label="Ask" disabled={!sendable}><SendHorizonal className="size-4" />Ask</Button>}
          </form>
          <p className="flex items-center gap-2 text-xs text-muted-foreground" role="status">
            {retrieve.running && <LoaderCircle className="size-3 animate-spin" />}
            {retrieve.running ? 'Planning and searching …' : 'Enter asks. Retrieve plans once and returns the found entities, best first, without an answer.'}
          </p>
        </div>
        <div className="min-h-0 flex-1 overflow-y-auto p-4 text-sm">
          <RetrievalResults response={retrieve.response} error={retrieve.error} running={false} stale={retrieve.staleFor(input)} schema={schema} catalog={catalog} />
        </div>
      </section>
      <aside aria-label="Diagnostics" className="flex max-h-[60vh] min-h-[320px] w-full shrink-0 flex-col border-t @3xl:max-h-none @3xl:w-[340px] @3xl:border-t-0 @3xl:border-l @5xl:w-[420px] @7xl:w-[460px]">
        <div className="border-b px-4 py-3"><h2 className="text-sm font-medium">Diagnostics</h2><p className="mt-1 text-xs text-muted-foreground">How the results were found: the plan, the timings and the planning call.</p></div>
        {meta && retrieve.answered !== null
          ? <RetrieverAgentDiagnostics key={retrieve.answered} mode="retrieve" meta={meta} question={retrieve.answered} status="complete" config={config} catalog={catalog} schema={schema} />
          : <p className="p-4 text-xs text-muted-foreground">Ask a question. Its plan, timings and planning call appear here.</p>}
      </aside>
    </div>
  </div>
}
