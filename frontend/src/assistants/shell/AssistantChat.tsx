import { AlertCircle, LoaderCircle, MessageSquarePlus, SendHorizonal, Square, type LucideIcon } from 'lucide-react'
import { useEffect, useMemo, useRef, useState, type KeyboardEvent, type ReactNode } from 'react'
import { createPortal } from 'react-dom'
import type { ChatRequest, SharedEvent } from '../stream/chatStream'
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
import { adapters } from '../adapters'
import {
  MAX_MESSAGE,
  elapsedSeconds,
  endText,
  inspectedTurn,
  type Turn,
  type TurnModel,
} from '../conversation/chatModel'
import type { ThreadOwner } from '../conversation/threadStore'
import { useAssistantConversation } from '../conversation/useAssistantConversation'

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
  button: (turn: Turn<I>) => { icon: LucideIcon; label: ReactNode } | null
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
  /**
   * The answer text; `show` shows its turn in the side panel. Omitted:
   * plain markdown.
   */
  renderAnswer?: (turn: Turn<I>, show: () => void) => ReactNode
  /** Toolbar, left: the assistant picker. */
  picker?: ReactNode
  /** Toolbar, right: the side-panel switch. */
  toggle?: ReactNode
  /**
   * Where "New conversation" goes instead of the toolbar, which is then
   * never shown (the Studio test panel's header); null until it is mounted.
   */
  actions?: HTMLElement | null
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
  blockedReason = null, model, send, insight, renderAnswer, picker, toggle, actions,
}: AssistantChatProps<E, I>) {
  const owner = useMemo<ThreadOwner | null>(
    () => (remember && assistantKey !== null ? { ontologyKey, lensKey, kind, assistantKey } : null),
    [remember, ontologyKey, lensKey, kind, assistantKey],
  )
  const [confirmNew, setConfirmNew] = useState(false)
  // The answer the panel shows; null follows the latest with insight.
  const [selected, setSelected] = useState<string | null>(null)
  const conversation = useAssistantConversation({
    owner, model, send, blocked: assistantKey === null || blockedReason !== null, onSent: () => setSelected(null),
  })
  const { turns, restoring, notice, running } = conversation
  const scroll = useRef<HTMLDivElement>(null)
  const panel = insight.panel
  const icon = adapters[kind].icon
  const shown = inspectedTurn(turns, selected, model.hasInsight)

  useEffect(() => {
    if (scroll.current !== null) scroll.current.scrollTop = scroll.current.scrollHeight
  }, [turns])

  /** "New conversation": the thread stays on the server until it expires. */
  function startOver() {
    conversation.startOver()
    setSelected(null)
  }

  const newConversation = turns.length > 0 && (
    <Button
      variant="ghost"
      size="sm"
      className={cn('gap-1.5 text-xs text-muted-foreground', actions === undefined ? 'h-7' : 'h-6')}
      disabled={running}
      onClick={() => setConfirmNew(true)}
    >
      <MessageSquarePlus className="size-3.5" />
      New conversation
    </Button>
  )
  const hasToolbar = actions === undefined && (picker !== undefined || toggle !== undefined || turns.length > 0)
  return (
    <div className="flex min-h-0 flex-1 flex-col">
      {hasToolbar && (
        <div className="flex min-h-11 flex-wrap items-center gap-x-3 gap-y-2 border-b px-4 py-2">
          {picker}
          <div className="ml-auto flex flex-wrap items-center justify-end gap-x-3 gap-y-2">
            {toggle}
            {newConversation}
          </div>
        </div>
      )}
      {actions && createPortal(newConversation, actions)}

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
                  <Intro icon={icon} name={name} description={description} intro={intro} />
                ) : (
                  <div className="space-y-6">
                    {turns.map((turn) => (
                      <TurnView
                        key={turn.id}
                        turn={turn}
                        icon={icon}
                        answer={turn.reply && (renderAnswer?.(turn, () => setSelected(turn.id)) ?? <Markdown>{turn.reply}</Markdown>)}
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
                <Composer name={name} placeholder={placeholder} conversation={conversation} disabled={assistantKey === null} />
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

      <NewConversationDialog open={confirmNew} onOpenChange={setConfirmNew} onConfirm={startOver} />
    </div>
  )
}

/** "New conversation", confirmed. */
export function NewConversationDialog({ open, onOpenChange, onConfirm }: { open: boolean; onOpenChange: (open: boolean) => void; onConfirm: () => void }) {
  return (
    <AlertDialog open={open} onOpenChange={onOpenChange}>
      <AlertDialogContent>
        <AlertDialogHeader>
          <AlertDialogTitle>Start a new conversation?</AlertDialogTitle>
          <AlertDialogDescription>The current one can no longer be opened here.</AlertDialogDescription>
        </AlertDialogHeader>
        <AlertDialogFooter>
          <AlertDialogCancel>Cancel</AlertDialogCancel>
          <AlertDialogAction onClick={onConfirm}>New conversation</AlertDialogAction>
        </AlertDialogFooter>
      </AlertDialogContent>
    </AlertDialog>
  )
}

/** The message input: Enter sends, Shift+Enter adds a line; while an answer runs, Send becomes Stop. */
export function Composer({ name, placeholder, conversation, disabled }: {
  name: string
  placeholder: string
  conversation: Pick<ReturnType<typeof useAssistantConversation>, 'input' | 'setInput' | 'submit' | 'stop' | 'running' | 'restoring' | 'canAsk'>
  /** Nothing to ask yet (no assistant). */
  disabled: boolean
}) {
  const { input, setInput, submit, stop, running, restoring, canAsk } = conversation
  const onKeyDown = (e: KeyboardEvent<HTMLTextAreaElement>) => {
    if (e.key === 'Enter' && !e.shiftKey && !e.nativeEvent.isComposing) {
      e.preventDefault()
      void submit()
    }
  }
  return (
    <>
      <form className="flex items-end gap-2" onSubmit={(e) => { e.preventDefault(); void submit() }}>
        <Textarea
          aria-label={`Message to ${name}`}
          data-testid="chat-input"
          placeholder={placeholder}
          value={input}
          onChange={(e) => setInput(e.target.value)}
          onKeyDown={onKeyDown}
          rows={1}
          maxLength={MAX_MESSAGE}
          disabled={running || restoring || disabled}
          className="max-h-36 min-h-9 resize-none py-[7px] text-[13px] leading-5 md:text-[13px]"
        />
        {running ? (
          <Button key="stop" type="button" data-testid="chat-stop" variant="outline" size="lg" className="w-[4.75rem]" onClick={stop}>
            <Square className="size-3 fill-current" /> Stop
          </Button>
        ) : (
          <Button key="send" type="submit" data-testid="chat-send" size="lg" className="w-[4.75rem]" disabled={!canAsk || input.trim() === ''}>
            <SendHorizonal className="size-3.5" /> Send
          </Button>
        )}
      </form>
      <p className="mt-1.5 text-[11px] text-muted-foreground">Enter sends · Shift+Enter adds a line · Follow-ups refer to earlier answers</p>
    </>
  )
}

/** The empty conversation: who answers and what it does. */
export function Intro({ icon, name, description, intro }: { icon: LucideIcon; name: string; description?: string | null; intro: string }) {
  return (
    <div className="flex flex-col items-center gap-3 py-12 text-center">
      <AssistantIcon icon={icon} className="size-11 rounded-xl [&_svg]:size-5" />
      <div className="max-w-md space-y-1.5">
        <h2 className="text-sm font-medium">{name}</h2>
        {description && <p className="text-[13px] text-foreground/80">{description}</p>}
        <p className="text-[13px] text-muted-foreground">{intro}</p>
      </div>
    </div>
  )
}

function AssistantIcon({ icon: Icon, className }: { icon: LucideIcon; className?: string }) {
  return (
    <div className={cn('flex size-6 shrink-0 items-center justify-center rounded-md border bg-muted/40', className)}>
      <Icon className="size-3.5 text-muted-foreground" />
    </div>
  )
}

/** One question and its answer. */
export function TurnView<I>({ turn, icon, answer, progress, insight }: { turn: Turn<I>; icon: LucideIcon; answer: ReactNode; progress: string | undefined; insight: ReactNode }) {
  const ended = endText(turn)
  return (
    <article className="space-y-3" data-testid="chat-turn" data-status={turn.status}>
      <div className="flex justify-end">
        <div data-testid="chat-question" className="max-w-[85%] rounded-lg bg-primary/10 px-3 py-2 text-[13px] break-words whitespace-pre-wrap">
          {turn.question}
        </div>
      </div>
      <div className="flex gap-2.5">
        <AssistantIcon icon={icon} className="mt-0.5" />
        <div className="min-w-0 flex-1 space-y-2 pt-0.5">
          {answer && <div data-testid="chat-answer">{answer}</div>}
          {turn.status === 'pending' && turn.startedAt !== undefined && <Working since={turn.startedAt} detail={progress} />}
          {ended !== null && (
            <p
              role={turn.stopped ? 'status' : 'alert'}
              data-testid="chat-turn-end"
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
  return (
    <Button
      size="sm"
      variant={selected ? 'secondary' : 'ghost'}
      aria-pressed={selected}
      onClick={onSelect}
      className={cn('-ml-2 flex h-6 w-fit gap-1.5 px-2 text-xs text-muted-foreground', selected && 'text-foreground')}
    >
      <spec.icon className="size-3" />
      {spec.label}
    </Button>
  )
}

/** The side-panel switch in the toolbar. */
export function InsightToggle({ label, title, checked, onChange }: { label: string; title: string; checked: boolean; onChange: (checked: boolean) => void }) {
  return (
    <label className="flex cursor-pointer items-center gap-2 text-xs whitespace-nowrap" title={title}>
      <Checkbox aria-label={label} checked={checked} onCheckedChange={(value) => onChange(value === true)} />
      {label}
    </label>
  )
}
