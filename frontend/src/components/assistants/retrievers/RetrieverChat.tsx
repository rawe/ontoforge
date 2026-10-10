import { Activity, LoaderCircle, RotateCcw, SendHorizonal, Square } from 'lucide-react'
import { useEffect, useMemo, useRef, useState, type ReactNode } from 'react'
import { chatErrorText, threadError } from '@/api/chatStream'
import { chatRetriever, type RetrieverConfig, type RetrieverEvent, type RetrieverDiagnostics } from '@/api/retrievers'
import type { ChatMessage, RuntimeSchema, SearchCatalogEntry } from '@/api/types'
import { EXPIRED_TEXT, forgetThread, rememberThread, rememberedThread, restoreThread } from '@/components/ai/chatStore'
import { Markdown } from '@/components/ai/Markdown'
import { Button } from '@/components/ui/button'
import { Textarea } from '@/components/ui/textarea'
import { cn } from '@/lib/utils'
import { RetrieverDiagnosticsPanel } from './RetrieverDiagnosticsPanel'
import { mergeDiagnostics, phaseName } from './retrieverModel'

type Turn = { id: string; question: string; reply: string; status: 'pending' | 'complete' | 'failed'; error?: string; diagnostics: RetrieverDiagnostics }

interface RetrieverChatProps {
  ontologyKey: string
  lensKey: string
  /** The retriever's key; null = nothing to ask yet. */
  agentKey: string | null
  /** Why questions are blocked (unsaved, invalid, unsupported); null = they run. */
  blockedReason: string | null
  /** Request and show diagnostics with each answer. */
  diagnostics: boolean
  /** Remember the thread in the browser and restore it on open (the Workbench); else each mount starts a new one. */
  remember?: boolean
  /** The saved configuration, for readable filter names in the plan; null shows filter ids. */
  config: RetrieverConfig | null
  catalog: SearchCatalogEntry[] | undefined
  schema: RuntimeSchema | undefined
  /** Shown above the input while there is no turn yet. */
  intro?: ReactNode
  className?: string
}

/** A thread read back as question-and-answer turns; restored answers have no diagnostics. */
function restoredTurns(messages: readonly ChatMessage[]): Turn[] {
  const turns: Turn[] = []
  for (const message of messages) {
    if (message.role === 'user') turns.push({ id: crypto.randomUUID(), question: message.content, reply: '', status: 'complete', diagnostics: {} })
    else if (turns.length > 0) turns[turns.length - 1]!.reply = message.content
  }
  return turns
}

/**
 * Conversation with one retriever on a server thread, with its
 * diagnostics beside or below it. Shared by the Studio test panel and the
 * Workbench chat; remount it (React `key`) to start a new thread, as the
 * test panel does after every save.
 */
export function RetrieverChat({ ontologyKey, lensKey, agentKey, blockedReason, diagnostics, remember = false, config, catalog, schema, intro, className }: RetrieverChatProps) {
  const owner = useMemo(() => (remember && agentKey !== null ? { ontologyKey, lensKey, kind: 'retrievers' as const, assistantKey: agentKey } : null), [remember, ontologyKey, lensKey, agentKey])
  const [turns, setTurns] = useState<Turn[]>([])
  const [restoring, setRestoring] = useState(owner !== null)
  const [notice, setNotice] = useState<string | null>(null)
  const [input, setInput] = useState('')
  const [busy, setBusy] = useState(false)
  const [phase, setPhase] = useState('')
  const [inspected, setInspected] = useState<string | null>(null)
  const active = useRef<AbortController | null>(null)
  const threadId = useRef<string | null>(null)
  const scroll = useRef<HTMLDivElement>(null)
  const withDiagnostics = turns.filter((t) => Object.keys(t.diagnostics).length > 0)
  const inspectedTurn = withDiagnostics.find((t) => t.id === inspected) ?? withDiagnostics.at(-1)
  const canAsk = agentKey !== null && blockedReason === null && !restoring

  useEffect(() => () => { active.current?.abort(); active.current = null }, [])
  useEffect(() => { if (scroll.current) scroll.current.scrollTop = scroll.current.scrollHeight }, [turns, phase])
  // The Workbench restores the remembered thread; the owner is fixed for a mount.
  useEffect(() => {
    if (owner === null) return
    const controller = new AbortController()
    restoreThread(owner, controller.signal).then(
      (restored) => {
        if (controller.signal.aborted) return
        threadId.current = restored.threadId
        setTurns(restoredTurns(restored.messages))
        if (restored.expired) setNotice(EXPIRED_TEXT)
        setRestoring(false)
      },
      (error: unknown) => {
        if (controller.signal.aborted) return
        // Keep the remembered thread: the next question continues it.
        threadId.current = rememberedThread(owner)
        setNotice(`Could not restore the conversation: ${chatErrorText(error, 'request failed')}`)
        setRestoring(false)
      },
    )
    return () => controller.abort()
  }, [owner])

  /** "New conversation": the thread stays on the server until it expires. */
  function reset() {
    setTurns([]); setPhase(''); setInspected(null); setNotice(null)
    threadId.current = null
    if (owner !== null) forgetThread(owner)
  }
  async function send() {
    const question = input.trim()
    if (!canAsk || agentKey === null || !question || busy || active.current) return
    const controller = new AbortController(); active.current = controller
    let turn: Turn = { id: crypto.randomUUID(), question, reply: '', status: 'pending', diagnostics: {} }
    const previous = turns
    const save = () => { if (active.current === controller) setTurns([...previous, turn]) }
    setBusy(true); setPhase('Starting …'); setInput(''); setInspected(null); setNotice(null); save()
    try {
      const onEvent = (event: RetrieverEvent) => {
        if (active.current !== controller || controller.signal.aborted) return
        switch (event.type) {
          case 'thread':
            threadId.current = event.threadId
            if (owner !== null) rememberThread(owner, event.threadId)
            break
          case 'retriever.phase': setPhase(`${phaseName(event.phase)}${event.status === 'start' ? ' …' : ' completed'}`); break
          case 'delta': turn = { ...turn, reply: turn.reply + event.text }; break
          case 'retriever.diagnostics': turn = { ...turn, diagnostics: mergeDiagnostics(turn.diagnostics, event) }; break
          case 'final': turn = { ...turn, reply: event.reply, status: 'complete' }; setPhase('Answer complete'); break
          case 'error': turn = { ...turn, status: 'failed', error: event.error.message }; setPhase('Failed'); break
        }
        save()
      }
      await chatRetriever(ontologyKey, lensKey, agentKey, { message: question, threadId: threadId.current ?? undefined, diagnostics }, onEvent, controller.signal)
    } catch (err) {
      if (active.current !== controller) return
      if (threadError(err) === 'THREAD_NOT_FOUND') {
        // The thread expired: start over, the question back in the input.
        active.current = null
        threadId.current = null
        if (owner !== null) forgetThread(owner)
        setTurns([]); setPhase(''); setNotice(EXPIRED_TEXT); setInput(question)
        return
      }
      turn = { ...turn, status: 'failed', error: controller.signal.aborted ? 'Cancelled. This incomplete answer is not part of the conversation.' : chatErrorText(err) }; save(); setPhase('')
    } finally { if (active.current === controller) { active.current = null }; setBusy(false) }
  }

  // Container queries: the layout follows the width the chat really has (Studio column or Workbench page).
  return <div className={cn('@container flex min-h-0 flex-1 flex-col', className)}>
    <div className="flex min-h-0 flex-1 flex-col @3xl:flex-row">
      <section className="flex min-h-[360px] min-w-0 flex-1 flex-col">
        <div ref={scroll} className="min-h-0 flex-1 space-y-5 overflow-y-auto p-4">
          {notice !== null && <p role="status" className="mx-auto max-w-3xl rounded border border-amber-500/30 bg-amber-500/5 px-3 py-2 text-xs">{notice}</p>}
          {restoring ? <p role="status" className="flex items-center justify-center gap-2 py-12 text-xs text-muted-foreground"><LoaderCircle className="size-3.5 animate-spin" />Restoring the conversation …</p>
            : !turns.length && intro}
          {turns.map((turn) => <article key={turn.id} className="mx-auto max-w-3xl space-y-3"><div className="ml-auto max-w-[90%] rounded-lg bg-muted px-4 py-3 text-sm whitespace-pre-wrap">{turn.question}</div>
            <div className="text-sm">{turn.reply ? <Markdown>{turn.reply}</Markdown> : turn.status === 'pending' ? <span className="text-muted-foreground">Searching …</span> : null}
              {turn.error && <p role="alert" className="mt-2 text-destructive">{turn.error}</p>}
              {diagnostics && Object.keys(turn.diagnostics).length > 0 && <Button size="sm" variant={turn.id === inspectedTurn?.id ? 'secondary' : 'ghost'} className="mt-2 h-6 gap-1.5 px-2 text-xs text-muted-foreground" aria-pressed={turn.id === inspectedTurn?.id} onClick={() => setInspected(turn.id)}><Activity className="size-3" />Diagnostics{turn.diagnostics.timings?.total !== undefined && ` · ${(turn.diagnostics.timings.total / 1000).toFixed(1)} s`}</Button>}
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
            <Textarea aria-label="Question for the retriever" placeholder="What would you like to find?" value={input} disabled={busy || agentKey === null || restoring} onChange={(e) => setInput(e.target.value)} rows={2} maxLength={2000}
              onKeyDown={(e) => { if (e.key === 'Enter' && !e.shiftKey && !e.nativeEvent.isComposing) { e.preventDefault(); void send() } }} />
            <Button type="submit" aria-label="Send question" disabled={busy || !canAsk || !input.trim()}><SendHorizonal className="size-4" /></Button>
          </form>
          <p className="text-xs text-muted-foreground">Enter sends · Shift+Enter adds a line. Follow-up questions refer to earlier completed answers of this conversation.</p>
        </div>
      </section>
      {diagnostics && <aside aria-label="Diagnostics" className="flex max-h-[60vh] min-h-[320px] w-full shrink-0 flex-col border-t @3xl:max-h-none @3xl:w-[340px] @3xl:border-t-0 @3xl:border-l @5xl:w-[420px] @7xl:w-[460px]">
        <div className="border-b px-4 py-3"><h2 className="text-sm font-medium">Diagnostics</h2><p className="mt-1 text-xs text-muted-foreground">How the selected answer was found. Pick another answer with its Diagnostics button.</p></div>
        {inspectedTurn ? <RetrieverDiagnosticsPanel key={inspectedTurn.id} meta={inspectedTurn.diagnostics} question={inspectedTurn.question} status={inspectedTurn.status} config={config} catalog={catalog} schema={schema} />
          : <p className="p-4 text-xs text-muted-foreground">Ask a question. Its plan, results, timings and model calls appear here while it runs.</p>}
      </aside>}
    </div>
  </div>
}
