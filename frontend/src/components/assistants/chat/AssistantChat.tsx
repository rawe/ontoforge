import { AlertCircle, Bot, LoaderCircle, MessageSquarePlus, SendHorizonal, Square, type LucideIcon } from 'lucide-react'
import { useEffect, useMemo, useRef, useState, type KeyboardEvent, type ReactNode } from 'react'
import { chatErrorText, threadError, type ChatRequest, type SharedEvent } from '@/api/chatStream'
import type { AssistantKind } from '@/api/types'
import { Markdown } from '@/components/ai/Markdown'
import {
  AlertDialog,
  AlertDialogAction,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
} from '@/components/ui/alert-dialog'
import { Button } from '@/components/ui/button'
import { Checkbox } from '@/components/ui/checkbox'
import { Textarea } from '@/components/ui/textarea'
import { cn } from '@/lib/utils'
import {
  EXPIRED_TEXT,
  MAX_MESSAGE,
  applyEvent,
  elapsedSeconds,
  endText,
  failTurn,
  inspectedTurn,
  pendingTurn,
  restoredTurns,
  stopTurn,
  type Turn,
  type TurnModel,
} from './chatModel'
import { forgetThread, rememberThread, rememberedThread, restoreThread, type ThreadOwner } from './threadStore'

/** How a kind shows what it reported about each answer. */
export interface InsightView<I> {
  /** The side panel; null hides it, and with it the per-answer buttons. */
  panel: null | {
    title: string
    icon: LucideIcon
    subtitle: string
    /** The panel's body for the shown answer — undefined while no answer has insight. */
    content: (turn: Turn<I> | undefined, turns: readonly Turn<I>[]) => ReactNode
  }
  /** The button under an answer that shows it in the panel; null when it has nothing to show. */
  button: (turn: Turn<I>) => { icon: LucideIcon; label: ReactNode; running: boolean } | null
}

interface AssistantChatProps<E extends { type: string }, I> {
  ontologyKey: string
  lensKey: string
  kind: AssistantKind
  /** The assistant asked; null = nothing can be asked yet (an unsaved retriever). */
  assistantKey: string | null
  name: string
  description?: string | null
  /** One line under the name in the empty state, about what this kind does. */
  intro: string
  placeholder: string
  /** Remember the thread in the browser and restore it on open (the Workbench); else each mount starts a new one. */
  remember: boolean
  /** Why questions are blocked (unsaved, invalid, unsupported); null = they run. */
  blockedReason?: string | null
  model: TurnModel<E, I>
  /** Send one message and read its turn; refusals before the stream throw. */
  send: (body: ChatRequest, onEvent: (event: SharedEvent | E) => void, signal: AbortSignal) => Promise<void>
  insight: InsightView<I>
  /** Toolbar, left: the assistant picker. */
  picker?: ReactNode
  /** Toolbar, right: the side-panel switch. */
  toggle?: ReactNode
}

/**
 * One conversation with one assistant on a server thread, for every
 * assistant kind: toolbar, messages, input with Send / Stop, "New
 * conversation", restore and the side panel beside (or, when narrow, below)
 * the conversation. The kind supplies its events' meaning (`model`), its
 * request (`send`) and its insight. Remount it (React `key`) for another
 * assistant or a new thread.
 */
export function AssistantChat<E extends { type: string }, I>({
  ontologyKey, lensKey, kind, assistantKey, name, description, intro, placeholder, remember,
  blockedReason = null, model, send, insight, picker, toggle,
}: AssistantChatProps<E, I>) {
  const owner = useMemo<ThreadOwner | null>(
    () => (remember && assistantKey !== null ? { ontologyKey, lensKey, kind, assistantKey } : null),
    [remember, ontologyKey, lensKey, kind, assistantKey],
  )
  const [turns, setTurns] = useState<Turn<I>[]>([])
  // Until the remembered thread is read back, nothing can be sent.
  const [restoring, setRestoring] = useState(owner !== null)
  const [notice, setNotice] = useState<string | null>(null)
  const [input, setInput] = useState('')
  const [confirmNew, setConfirmNew] = useState(false)
  // The answer the panel shows; null follows the latest with insight.
  const [selected, setSelected] = useState<string | null>(null)
  const active = useRef<AbortController | null>(null)
  const threadId = useRef<string | null>(null)
  const scroll = useRef<HTMLDivElement>(null)
  const running = turns.some((t) => t.status === 'pending')
  const canAsk = assistantKey !== null && blockedReason === null && !restoring
  const panel = insight.panel
  const shown = inspectedTurn(turns, selected, model.hasInsight)

  useEffect(() => () => {
    const request = active.current
    active.current = null
    request?.abort()
  }, [])
  useEffect(() => {
    if (scroll.current !== null) scroll.current.scrollTop = scroll.current.scrollHeight
  }, [turns])
  // The owner is fixed for a mount.
  useEffect(() => {
    if (owner === null) return
    const controller = new AbortController()
    restoreThread(owner, controller.signal).then(
      (restored) => {
        if (controller.signal.aborted) return
        threadId.current = restored.threadId
        setTurns(restoredTurns(restored.messages, model.empty, () => crypto.randomUUID()))
        if (restored.expired) setNotice(EXPIRED_TEXT)
        setRestoring(false)
      },
      (error: unknown) => {
        if (controller.signal.aborted) return
        // Keep the remembered thread: the next message continues it.
        threadId.current = rememberedThread(owner)
        setNotice(`Could not restore the conversation: ${chatErrorText(error, 'request failed')}`)
        setRestoring(false)
      },
    )
    return () => controller.abort()
  }, [owner, model])

  async function submit() {
    const question = input.trim()
    if (!question || !canAsk || assistantKey === null || active.current !== null) return
    const controller = new AbortController()
    active.current = controller
    let turn = pendingTurn(crypto.randomUUID(), question, model.empty(), Date.now())
    const previous = turns
    const save = () => { if (active.current === controller) setTurns([...previous, turn]) }
    setInput('')
    setNotice(null)
    setSelected(null)
    save()
    const onEvent = (event: SharedEvent | E) => {
      if (active.current !== controller || controller.signal.aborted) return
      if (event.type === 'thread') {
        threadId.current = (event as SharedEvent & { type: 'thread' }).threadId
        if (owner !== null) rememberThread(owner, threadId.current)
      }
      turn = applyEvent(model, turn, event, Date.now())
      save()
    }
    try {
      await send({ message: question, threadId: threadId.current ?? undefined }, onEvent, controller.signal)
    } catch (error) {
      if (active.current !== controller) return
      if (controller.signal.aborted) {
        turn = stopTurn(model, turn, Date.now())
      } else if (threadError(error) === 'THREAD_NOT_FOUND') {
        // The thread expired: start over, the question back in the input.
        active.current = null
        threadId.current = null
        if (owner !== null) forgetThread(owner)
        setTurns([])
        setNotice(EXPIRED_TEXT)
        setInput(question)
        return
      } else {
        turn = failTurn(model, turn, chatErrorText(error), Date.now())
      }
      save()
    } finally {
      if (active.current === controller) active.current = null
    }
  }

  /** "New conversation": the thread stays on the server until it expires. */
  function startOver() {
    threadId.current = null
    if (owner !== null) forgetThread(owner)
    setTurns([])
    setNotice(null)
    setSelected(null)
  }

  const onKeyDown = (e: KeyboardEvent<HTMLTextAreaElement>) => {
    if (e.key === 'Enter' && !e.shiftKey && !e.nativeEvent.isComposing) {
      e.preventDefault()
      void submit()
    }
  }

  const hasToolbar = picker !== undefined || toggle !== undefined || turns.length > 0
  return (
    <div className="flex min-h-0 flex-1 flex-col">
      {hasToolbar && (
        <div className="flex min-h-11 flex-wrap items-center gap-x-3 gap-y-2 border-b px-4 py-2">
          {picker}
          <div className="ml-auto flex items-center gap-3">
            {toggle}
            {turns.length > 0 && (
              <Button
                variant="ghost"
                size="sm"
                className="h-7 gap-1.5 text-xs text-muted-foreground"
                disabled={running}
                onClick={() => setConfirmNew(true)}
              >
                <MessageSquarePlus className="size-3.5" />
                New conversation
              </Button>
            )}
          </div>
        </div>
      )}

      {/* Container queries: the layout follows the width the chat really has (Studio column or Workbench page). */}
      <div className="@container flex min-h-0 flex-1 flex-col">
        <div className="flex min-h-0 flex-1 flex-col @3xl:flex-row">
          <section aria-label="Conversation" className="flex min-h-[320px] min-w-0 flex-1 flex-col">
            <div ref={scroll} className="min-h-0 flex-1 overflow-y-auto px-4 py-5">
              <div className="mx-auto max-w-3xl">
                {notice !== null && (
                  <p role="status" className="mb-5 rounded border border-amber-500/30 bg-amber-500/5 px-3 py-2 text-xs">
                    {notice}
                  </p>
                )}
                {restoring ? (
                  <p role="status" className="flex items-center justify-center gap-2 py-12 text-xs text-muted-foreground">
                    <LoaderCircle className="size-3.5 animate-spin" /> Restoring the conversation …
                  </p>
                ) : turns.length === 0 ? (
                  <Intro name={name} description={description} intro={intro} />
                ) : (
                  <div className="space-y-6">
                    {turns.map((turn) => (
                      <TurnView
                        key={turn.id}
                        turn={turn}
                        progress={turn.status === 'pending' ? model.progress(turn.insight) : undefined}
                        insight={panel !== null && (
                          <InsightButton spec={insight.button(turn)} selected={turn.id === shown?.id} onSelect={() => setSelected(turn.id)} />
                        )}
                      />
                    ))}
                  </div>
                )}
              </div>
            </div>

            <div className="border-t px-4 pt-3 pb-2.5">
              <div className="mx-auto max-w-3xl">
                {blockedReason !== null && (
                  <p role="status" className="mb-2.5 rounded border border-amber-500/30 bg-amber-500/5 px-3 py-2 text-xs">
                    {blockedReason}
                  </p>
                )}
                <form className="flex items-end gap-2" onSubmit={(e) => { e.preventDefault(); void submit() }}>
                  <Textarea
                    aria-label={`Message to ${name}`}
                    placeholder={placeholder}
                    value={input}
                    onChange={(e) => setInput(e.target.value)}
                    onKeyDown={onKeyDown}
                    rows={1}
                    maxLength={MAX_MESSAGE}
                    disabled={running || restoring || assistantKey === null}
                    className="max-h-36 min-h-9 resize-none py-[7px] text-[13px] leading-5 md:text-[13px]"
                  />
                  {running ? (
                    <Button key="stop" type="button" variant="outline" size="lg" className="w-[4.75rem]" onClick={() => active.current?.abort()}>
                      <Square className="size-3 fill-current" /> Stop
                    </Button>
                  ) : (
                    <Button key="send" type="submit" size="lg" className="w-[4.75rem]" disabled={!canAsk || input.trim() === ''}>
                      <SendHorizonal className="size-3.5" /> Send
                    </Button>
                  )}
                </form>
                <p className="mt-1.5 text-[11px] text-muted-foreground">Enter sends · Shift+Enter adds a line</p>
              </div>
            </div>
          </section>

          {panel !== null && (
            <aside
              aria-label={panel.title}
              className="flex max-h-[60vh] min-h-[280px] w-full shrink-0 flex-col border-t @3xl:max-h-none @3xl:w-[360px] @3xl:border-t-0 @3xl:border-l @5xl:w-[440px] @7xl:w-[520px]"
            >
              <div className="border-b px-4 py-2.5">
                <h2 className="flex items-center gap-1.5 text-sm font-medium">
                  <panel.icon className="size-3.5 text-muted-foreground" /> {panel.title}
                </h2>
                <p className="mt-0.5 text-xs text-muted-foreground">{panel.subtitle}</p>
              </div>
              <div key={shown?.id ?? 'none'} className="flex min-h-0 flex-1 flex-col">
                {panel.content(shown, turns)}
              </div>
            </aside>
          )}
        </div>
      </div>

      <AlertDialog open={confirmNew} onOpenChange={setConfirmNew}>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>Start a new conversation?</AlertDialogTitle>
            <AlertDialogDescription>The current one can no longer be opened here.</AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel>Cancel</AlertDialogCancel>
            <AlertDialogAction onClick={startOver}>New conversation</AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </div>
  )
}

/** The empty conversation: who answers and what it does. */
function Intro({ name, description, intro }: { name: string; description?: string | null; intro: string }) {
  return (
    <div className="flex flex-col items-center gap-3 py-12 text-center">
      <AssistantIcon className="size-11 rounded-xl [&_svg]:size-5" />
      <div className="max-w-md space-y-1.5">
        <h2 className="text-sm font-medium">{name}</h2>
        {description && <p className="text-[13px] text-foreground/80">{description}</p>}
        <p className="text-[13px] text-muted-foreground">{intro}</p>
      </div>
    </div>
  )
}

function AssistantIcon({ className }: { className?: string }) {
  return (
    <div className={cn('flex size-6 shrink-0 items-center justify-center rounded-md border bg-muted/40', className)}>
      <Bot className="size-3.5 text-muted-foreground" />
    </div>
  )
}

/** One question and its answer. */
function TurnView<I>({ turn, progress, insight }: { turn: Turn<I>; progress: string | undefined; insight: ReactNode }) {
  const ended = endText(turn)
  return (
    <article className="space-y-3">
      <div className="flex justify-end">
        <div className="max-w-[85%] rounded-lg bg-primary/10 px-3 py-2 text-[13px] break-words whitespace-pre-wrap">
          {turn.question}
        </div>
      </div>
      <div className="flex gap-2.5">
        <AssistantIcon className="mt-0.5" />
        <div className="min-w-0 flex-1 space-y-2 pt-0.5">
          {turn.reply && <Markdown>{turn.reply}</Markdown>}
          {turn.status === 'pending' && turn.startedAt !== undefined && <Working since={turn.startedAt} detail={progress} />}
          {ended !== null && (
            <p
              role={turn.stopped ? 'status' : 'alert'}
              className={cn('flex items-start gap-1.5 text-[13px]', turn.stopped ? 'text-muted-foreground' : 'text-destructive')}
            >
              {turn.stopped ? <Square className="mt-[3px] size-3 shrink-0" /> : <AlertCircle className="mt-0.5 size-3.5 shrink-0" />}
              <span>{ended}</span>
            </p>
          )}
          {insight}
        </div>
      </div>
    </article>
  )
}

/** Inside a running answer: elapsed seconds and what the kind says it is doing. */
function Working({ since, detail }: { since: number; detail: string | undefined }) {
  const [now, setNow] = useState(() => Date.now())
  useEffect(() => {
    const timer = window.setInterval(() => setNow(Date.now()), 500)
    return () => window.clearInterval(timer)
  }, [])
  return (
    <p role="status" className="flex items-center gap-2 text-[13px] text-muted-foreground">
      <LoaderCircle className="size-3.5 shrink-0 animate-spin" />
      <span>
        Working… <span className="tabular-nums">{elapsedSeconds(since, now)} s</span>
      </span>
      {detail !== undefined && <span className="min-w-0 truncate">· {detail}</span>}
    </p>
  )
}

/** Under an answer: shows it in the side panel. */
function InsightButton({
  spec,
  selected,
  onSelect,
}: {
  spec: ReturnType<InsightView<never>['button']>
  selected: boolean
  onSelect: () => void
}) {
  if (spec === null) return null
  const Icon = spec.running ? LoaderCircle : spec.icon
  return (
    <Button
      size="sm"
      variant={selected ? 'secondary' : 'ghost'}
      aria-pressed={selected}
      onClick={onSelect}
      className={cn('-ml-2 flex h-6 w-fit gap-1.5 px-2 text-xs text-muted-foreground', selected && 'text-foreground')}
    >
      <Icon className={cn('size-3', spec.running && 'animate-spin')} />
      {spec.label}
    </Button>
  )
}

/** The side-panel switch in the toolbar. */
export function InsightToggle({ label, title, checked, onChange }: { label: string; title: string; checked: boolean; onChange: (checked: boolean) => void }) {
  return (
    <label className="flex cursor-pointer items-center gap-2 text-xs" title={title}>
      <Checkbox aria-label={label} checked={checked} onCheckedChange={(value) => onChange(value === true)} />
      {label}
    </label>
  )
}
