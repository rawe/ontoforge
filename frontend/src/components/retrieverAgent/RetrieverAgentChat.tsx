import { Activity, LoaderCircle, RotateCcw, SendHorizonal, Square } from 'lucide-react'
import { useEffect, useRef, useState, type ReactNode } from 'react'
import { chatRetrieverAgent, type RetrieverAgentConfig, type RetrieverAgentEvent, type RetrieverAgentMeta } from '@/api/retrieverAgents'
import type { RuntimeSchema, SearchCatalogEntry } from '@/api/types'
import { Markdown } from '@/components/ai/Markdown'
import { Button } from '@/components/ui/button'
import { Textarea } from '@/components/ui/textarea'
import { cn } from '@/lib/utils'
import { RetrieverAgentDiagnostics } from './RetrieverAgentDiagnostics'
import { mergeMeta, phaseName } from './retrieverAgentModel'

type Turn = { id: string; question: string; reply: string; status: 'pending' | 'complete' | 'failed'; error?: string; meta: RetrieverAgentMeta }

interface RetrieverAgentChatProps {
  ontologyKey: string
  lensKey: string
  /** The saved agent's key; null = nothing to ask yet. */
  agentKey: string | null
  /** Why questions are blocked (unsaved, invalid, unsupported); null = they run. */
  blockedReason: string | null
  /** Request and show diagnostics with each answer. */
  diagnostics: boolean
  /** The saved configuration, for readable filter names in the plan. */
  config: RetrieverAgentConfig | null
  catalog: SearchCatalogEntry[] | undefined
  schema: RuntimeSchema | undefined
  /** Shown above the input while there is no turn yet. */
  intro?: ReactNode
  className?: string
}

/**
 * Conversation with one saved retriever agent, with its diagnostics beside
 * or below it. Shared by the Studio test panel and the Workbench chat;
 * remount it (React `key`) when the saved agent changes — a conversation
 * belongs to one saved version.
 */
export function RetrieverAgentChat({ ontologyKey, lensKey, agentKey, blockedReason, diagnostics, config, catalog, schema, intro, className }: RetrieverAgentChatProps) {
  const [turns, setTurns] = useState<Turn[]>([])
  const [input, setInput] = useState('')
  const [busy, setBusy] = useState(false)
  const [phase, setPhase] = useState('')
  const [inspected, setInspected] = useState<string | null>(null)
  const active = useRef<AbortController | null>(null)
  const turnToken = useRef<string | undefined>(undefined)
  const scroll = useRef<HTMLDivElement>(null)
  const withMeta = turns.filter((t) => Object.keys(t.meta).length > 0)
  const inspectedTurn = withMeta.find((t) => t.id === inspected) ?? withMeta.at(-1)
  const canAsk = agentKey !== null && blockedReason === null

  useEffect(() => () => { active.current?.abort(); active.current = null }, [])
  useEffect(() => { if (scroll.current) scroll.current.scrollTop = scroll.current.scrollHeight }, [turns, phase])

  function reset() { setTurns([]); setPhase(''); setInspected(null); turnToken.current = undefined }
  async function send() {
    const question = input.trim()
    if (!canAsk || agentKey === null || !question || busy || active.current) return
    const controller = new AbortController(); active.current = controller
    const history = turns.filter((t) => t.status === 'complete').slice(-4).flatMap((t) => [{ role: 'user' as const, content: t.question.slice(0, 2000) }, { role: 'assistant' as const, content: t.reply.slice(0, 2000) }])
    let turn: Turn = { id: crypto.randomUUID(), question, reply: '', status: 'pending', meta: {} }
    let nextToken: string | undefined
    const previous = turns.slice(-9)
    const save = () => { if (active.current === controller) setTurns([...previous, turn]) }
    setBusy(true); setPhase('Starting …'); setInput(''); setInspected(null); save()
    try {
      const onEvent = (event: RetrieverAgentEvent) => {
        if (active.current !== controller || controller.signal.aborted) return
        switch (event.type) {
          case 'phase': setPhase(`${phaseName(event.phase)}${event.status === 'start' ? ' …' : ' completed'}`); break
          case 'delta': turn = { ...turn, reply: turn.reply + event.text }; break
          case 'meta': {
            // The follow-up token arrives in every stream; everything else only with diagnostics.
            const { turnToken: token, ...data } = event
            if (token) nextToken = token
            if (Object.keys(data).some((key) => key !== 'type')) turn = { ...turn, meta: mergeMeta(turn.meta, data) }
            break
          }
          case 'final': turn = { ...turn, reply: event.reply, status: 'complete' }; turnToken.current = nextToken; setPhase('Answer complete'); break
          case 'error': turn = { ...turn, status: 'failed', error: event.error.message }; setPhase('Failed'); break
        }
        save()
      }
      await chatRetrieverAgent(ontologyKey, lensKey, agentKey, { message: question, history, turnToken: turnToken.current, diagnostics }, onEvent, controller.signal)
    } catch (err) {
      if (active.current === controller) { turn = { ...turn, status: 'failed', error: controller.signal.aborted ? 'Cancelled. This incomplete answer will not be used as conversation context.' : err instanceof Error ? err.message : 'The question failed.' }; save(); setPhase('') }
    } finally { if (active.current === controller) { active.current = null; setBusy(false) } }
  }

  // Container queries: the layout follows the width the chat really has (Studio column or Workbench page).
  return <div className={cn('@container flex min-h-0 flex-1 flex-col', className)}>
    <div className="flex min-h-0 flex-1 flex-col @3xl:flex-row">
      <section className="flex min-h-[360px] min-w-0 flex-1 flex-col">
        <div ref={scroll} className="min-h-0 flex-1 space-y-5 overflow-y-auto p-4">
          {!turns.length && intro}
          {turns.map((turn) => <article key={turn.id} className="mx-auto max-w-3xl space-y-3"><div className="ml-auto max-w-[90%] rounded-lg bg-muted px-4 py-3 text-sm whitespace-pre-wrap">{turn.question}</div>
            <div className="text-sm">{turn.reply ? <Markdown>{turn.reply}</Markdown> : turn.status === 'pending' ? <span className="text-muted-foreground">Searching …</span> : null}
              {turn.error && <p role="alert" className="mt-2 text-destructive">{turn.error}</p>}
              {diagnostics && Object.keys(turn.meta).length > 0 && <Button size="sm" variant={turn.id === inspectedTurn?.id ? 'secondary' : 'ghost'} className="mt-2 h-6 gap-1.5 px-2 text-xs text-muted-foreground" aria-pressed={turn.id === inspectedTurn?.id} onClick={() => setInspected(turn.id)}><Activity className="size-3" />Diagnostics{turn.meta.timings?.total !== undefined && ` · ${(turn.meta.timings.total / 1000).toFixed(1)} s`}</Button>}
            </div></article>)}
        </div>
        <div className="space-y-2 border-t p-4">
          {agentKey !== null && blockedReason !== null && <p role="status" className="rounded border border-amber-500/30 bg-amber-500/5 px-3 py-2 text-xs">{blockedReason}</p>}
          <div className="flex min-h-6 items-center gap-2 text-xs text-muted-foreground" role="status">
            {busy && <LoaderCircle className="size-3 animate-spin" />}{phase}
            {busy ? <Button variant="ghost" size="sm" className="ml-auto h-6" onClick={() => active.current?.abort()}><Square className="size-3" />Cancel</Button>
              : turns.length > 0 && <Button variant="ghost" size="sm" className="ml-auto h-6 gap-1" onClick={reset}><RotateCcw className="size-3" />New conversation</Button>}
          </div>
          <form className="flex items-end gap-2" onSubmit={(e) => { e.preventDefault(); void send() }}>
            <Textarea aria-label="Question for the retriever agent" placeholder="What would you like to find?" value={input} disabled={busy || agentKey === null} onChange={(e) => setInput(e.target.value)} rows={2} maxLength={2000}
              onKeyDown={(e) => { if (e.key === 'Enter' && !e.shiftKey && !e.nativeEvent.isComposing) { e.preventDefault(); void send() } }} />
            <Button type="submit" aria-label="Send question" disabled={busy || !canAsk || !input.trim()}><SendHorizonal className="size-4" /></Button>
          </form>
          <p className="text-xs text-muted-foreground">Enter sends · Shift+Enter adds a line. Context: the last four completed pairs, at most 2000 characters per message.</p>
        </div>
      </section>
      {diagnostics && <aside aria-label="Diagnostics" className="flex max-h-[60vh] min-h-[320px] w-full shrink-0 flex-col border-t @3xl:max-h-none @3xl:w-[340px] @3xl:border-t-0 @3xl:border-l @5xl:w-[420px] @7xl:w-[460px]">
        <div className="border-b px-4 py-3"><h2 className="text-sm font-medium">Diagnostics</h2><p className="mt-1 text-xs text-muted-foreground">How the selected answer was found. Pick another answer with its Diagnostics button.</p></div>
        {inspectedTurn ? <RetrieverAgentDiagnostics key={inspectedTurn.id} meta={inspectedTurn.meta} question={inspectedTurn.question} status={inspectedTurn.status} config={config} catalog={catalog} schema={schema} />
          : <p className="p-4 text-xs text-muted-foreground">Ask a question. Its plan, results, timings and model calls appear here while it runs.</p>}
      </aside>}
    </div>
  </div>
}
