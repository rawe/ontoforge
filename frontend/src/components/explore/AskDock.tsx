import { Check, ChevronRight, LoaderCircle, MessageSquarePlus, PanelLeftClose, Plus, X } from 'lucide-react'
import { memo, useEffect, useMemo, useRef, useState, type PointerEvent as ReactPointerEvent, type ReactNode } from 'react'
import { chatErrorText, type ChatRequest, type SharedEvent } from '@/api/chatStream'
import { useAssistants } from '@/api/hooks'
import type { AssistantKind, RuntimeAssistant } from '@/api/types'
import { Composer, InsightToggle, Intro, NewConversationDialog, TurnView } from '@/components/assistants/chat/AssistantChat'
import { DEFAULT_ASSISTANT, formatDuration, type Turn } from '@/components/assistants/chat/chatModel'
import type { ThreadOwner } from '@/components/assistants/chat/threadStore'
import { useAssistantConversation } from '@/components/assistants/chat/useAssistantConversation'
import { CitedAnswer } from '@/components/assistants/graph/CitedAnswer'
import { EntityCardList, StepList } from '@/components/assistants/graph/EvidenceSidebar'
import type { EntityCard, GraphEvent } from '@/components/assistants/graph/graphEvents'
import { graphTurns, type GraphInsight } from '@/components/assistants/graph/graphTurnModel'
import { ASSISTANT_KINDS } from '@/components/assistants/kinds'
import { Button } from '@/components/ui/button'
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select'
import { Skeleton } from '@/components/ui/skeleton'
import { Tooltip, TooltipContent, TooltipTrigger } from '@/components/ui/tooltip'
import { cn } from '@/lib/utils'
import { MAX_WIDTH, MIN_WIDTH, type useAskDock } from './useAskDock'

/* ----------------------------------- dock ---------------------------------- */

/** What one answer found, as the canvas needs it. */
export type Answer = Pick<GraphInsight, 'entities' | 'links'>

interface AskDockProps {
  ontologyKey: string
  lensKey: string
  kind: AssistantKind
  dock: ReturnType<typeof useAskDock>
  send: (assistantKey: string, body: ChatRequest, onEvent: (event: SharedEvent | GraphEvent) => void, signal: AbortSignal) => Promise<void>
  /** Entity ids on the canvas. */
  onCanvas: ReadonlySet<string>
  /** The entity the canvas points at — hovered or highlighted; its citations are marked. */
  pointed: string | null
  /** A click on an entity of an answer: added when not on the canvas, else shown there. */
  onEntity: (card: EntityCard, answer: Answer) => void
  /** The entity of an answer under the pointer, null when none is. */
  onHover: (entityId: string | null) => void
  /** An answer completed with auto-add on; resolves whether its entities were refused by the cap. */
  onAnswer: (turn: Turn<GraphInsight>) => Promise<'added' | 'refused'>
}

/**
 * The Explorer's ask dock on the canvas's left edge: a conversation with
 * one assistant of the lens whose answers fill the canvas. Open (resizable),
 * or collapsed to a rail that keeps the conversation — and a running answer
 * — alive. The chat's state lives here, so streamed answers never render
 * the canvas.
 */
export const AskDock = memo(function AskDock({ dock, ...props }: AskDockProps) {
  const { ontologyKey, lensKey, kind } = props
  const assistants = useAssistants(ontologyKey, lensKey, kind)
  const list = assistants.data
  const assistant = list === undefined ? undefined
    : list.find((a) => a.key === dock.settings.assistant) ?? list.find((a) => a.key === DEFAULT_ASSISTANT) ?? list[0]
  const [running, setRunning] = useState(false)
  const [width, setWidth] = useState<number | null>(null)
  const { one, icon: Icon } = ASSISTANT_KINDS[kind]
  const collapsed = dock.view === 'collapsed'

  const resize = (event: ReactPointerEvent<HTMLDivElement>) => {
    event.preventDefault()
    const start = event.clientX
    const from = dock.width
    let latest = from
    const move = (e: PointerEvent) => {
      latest = Math.min(MAX_WIDTH, Math.max(MIN_WIDTH, from + e.clientX - start))
      setWidth(latest)
    }
    const up = () => {
      window.removeEventListener('pointermove', move)
      window.removeEventListener('pointerup', up)
      setWidth(null)
      dock.setWidth(latest)
    }
    window.addEventListener('pointermove', move)
    window.addEventListener('pointerup', up)
  }

  const picker = list === undefined ? <Skeleton className="h-7 w-40" /> : (
    <Select value={assistant?.key} onValueChange={dock.setAssistant}>
      <SelectTrigger size="sm" aria-label={one} className="h-7 min-w-0 flex-1 text-[13px]">
        <SelectValue>{assistant?.name}</SelectValue>
      </SelectTrigger>
      <SelectContent position="popper" align="start">
        {list.map((a) => (
          <SelectItem key={a.key} value={a.key} className="text-[13px]">
            <span className="flex items-baseline gap-2">
              {a.name}
              <span className="font-mono text-[10.5px] text-muted-foreground">{a.key}</span>
            </span>
          </SelectItem>
        ))}
      </SelectContent>
    </Select>
  )
  const frame = (
    <>
      <IconButton label="Collapse" onClick={dock.collapse}><PanelLeftClose className="size-3.5" /></IconButton>
      <IconButton label="Close" onClick={dock.close}><X className="size-3.5" /></IconButton>
    </>
  )

  return (
    <>
      {collapsed && (
        <button
          type="button"
          onClick={dock.open}
          aria-label={`Open the ${one.toLowerCase()} dock`}
          title={assistant === undefined ? one : `${one}: ${assistant.name}`}
          className="flex h-full w-10 shrink-0 flex-col items-center gap-3 border-r bg-card/95 py-3 text-muted-foreground transition-colors hover:bg-muted/60 hover:text-foreground"
        >
          <Icon className="size-4 shrink-0" />
          {running && <LoaderCircle aria-label="Answering" className="size-3.5 shrink-0 animate-spin text-primary" />}
          <span className="min-h-0 truncate text-xs font-medium [writing-mode:vertical-rl]">{assistant?.name ?? one}</span>
        </button>
      )}
      <aside
        aria-label={`${one} dock`}
        hidden={collapsed}
        style={{ width: width ?? dock.width }}
        className="relative flex h-full shrink-0 flex-col border-r bg-background"
      >
        {assistants.error || (list !== undefined && assistant === undefined) ? (
          <>
            <div className="flex min-h-11 items-center gap-1.5 border-b px-3 py-2">
              <Icon className="size-4 shrink-0 text-muted-foreground" />
              <span className="flex-1 text-[13px] font-medium">{one}</span>
              {frame}
            </div>
            <div className="p-4 text-[13px]">
              {assistants.error ? <>
                <p role="alert">Could not load {ASSISTANT_KINDS[kind].many}: {chatErrorText(assistants.error, 'request failed')}</p>
                <Button variant="outline" size="sm" className="mt-3" onClick={() => void assistants.refetch()}>Reload</Button>
              </> : <p className="text-muted-foreground">This lens has no {ASSISTANT_KINDS[kind].many}.</p>}
            </div>
          </>
        ) : (
          <AskConversation
            // Another assistant: its own conversation; a running answer is cancelled.
            key={assistant?.key ?? 'loading'}
            {...props}
            assistant={assistant ?? null}
            picker={picker}
            frame={frame}
            autoAdd={dock.settings.autoAdd}
            onAutoAdd={dock.setAutoAdd}
            onRunning={setRunning}
          />
        )}
        <div
          role="separator"
          aria-orientation="vertical"
          aria-label="Resize"
          onPointerDown={resize}
          className="absolute inset-y-0 -right-1 z-10 w-2 cursor-col-resize transition-colors hover:bg-primary/20"
        />
      </aside>
    </>
  )
})

function KindIcon({ kind }: { kind: AssistantKind }) {
  const Icon = ASSISTANT_KINDS[kind].icon
  return <Icon className="mx-1 size-4 shrink-0 text-muted-foreground" />
}

function IconButton({ label, onClick, disabled, children }: { label: string; onClick: () => void; disabled?: boolean; children: ReactNode }) {
  return (
    <Tooltip>
      <TooltipTrigger asChild>
        <Button variant="ghost" size="icon-sm" aria-label={label} disabled={disabled} onClick={onClick} className="size-7 shrink-0">
          {children}
        </Button>
      </TooltipTrigger>
      <TooltipContent>{label}</TooltipContent>
    </Tooltip>
  )
}

/* ------------------------------- conversation ------------------------------ */

type AskConversationProps = Omit<AskDockProps, 'dock'> & {
  /** Null while the list loads: nothing can be asked yet. */
  assistant: RuntimeAssistant | null
  picker: ReactNode
  frame: ReactNode
  autoAdd: boolean
  onAutoAdd: (on: boolean) => void
  onRunning: (running: boolean) => void
}

function AskConversation({
  ontologyKey, lensKey, kind, send, assistant, picker, frame, autoAdd, onAutoAdd, onRunning,
  onCanvas, pointed, onEntity, onHover, onAnswer,
}: AskConversationProps) {
  const assistantKey = assistant?.key ?? null
  const owner = useMemo<ThreadOwner | null>(
    () => (assistantKey === null ? null : { ontologyKey, lensKey, kind, assistantKey }),
    [ontologyKey, lensKey, kind, assistantKey],
  )
  // Answers whose entities the canvas refused (the cap).
  const [refused, setRefused] = useState<ReadonlySet<string>>(new Set())
  const [confirmNew, setConfirmNew] = useState(false)
  const conversation = useAssistantConversation({
    owner,
    model: graphTurns,
    send: (body, onEvent, signal) => (assistantKey === null ? Promise.resolve() : send(assistantKey, body, onEvent, signal)),
    blocked: assistantKey === null,
    onComplete: (turn) => {
      if (!autoAdd) return
      void onAnswer(turn).then((result) => {
        if (result === 'refused') setRefused((current) => new Set(current).add(turn.id))
      })
    },
  })
  const { turns, running, restoring, notice } = conversation
  const { icon, one } = ASSISTANT_KINDS[kind]
  const scroll = useRef<HTMLDivElement>(null)
  useEffect(() => {
    if (scroll.current !== null) scroll.current.scrollTop = scroll.current.scrollHeight
  }, [turns])
  useEffect(() => {
    onRunning(running)
  }, [running, onRunning])
  useEffect(() => () => onRunning(false), [onRunning])

  return (
    <div className="flex min-h-0 flex-1 flex-col">
      <div className="flex min-h-11 items-center gap-1 border-b px-2 py-2">
        <KindIcon kind={kind} />
        {picker}
        <IconButton label="New conversation" disabled={running || turns.length === 0} onClick={() => setConfirmNew(true)}>
          <MessageSquarePlus className="size-3.5" />
        </IconButton>
        {frame}
      </div>
      <div className="border-b px-3 py-1.5">
        <InsightToggle
          label="Add cited entities to the canvas"
          title="When an answer completes, put the entities it cites on the canvas, with the relations between them"
          checked={autoAdd}
          onChange={onAutoAdd}
        />
      </div>

      <div ref={scroll} className="min-h-0 flex-1 overflow-y-auto px-3 py-4">
        {notice !== null && (
          <p role="status" className="mb-4 rounded border border-amber-500/30 bg-amber-500/5 px-3 py-2 text-xs">{notice}</p>
        )}
        {restoring ? (
          <p role="status" className="flex items-center justify-center gap-2 py-12 text-xs text-muted-foreground">
            <LoaderCircle className="size-3.5 animate-spin" /> Restoring the conversation …
          </p>
        ) : turns.length === 0 ? (
          <Intro
            icon={icon}
            name={assistant?.name ?? one}
            description={assistant?.description}
            intro="Ask how things are connected. Click an entity the answer names to put it on the canvas; click it again to find it there."
          />
        ) : (
          <div className="space-y-5">
            {turns.map((turn) => {
              const answer = turn.insight
              const pointedRef = pointed === null ? null : answer.entities.find((card) => card.id === pointed)?.ref ?? null
              const select = (ref: string) => {
                const card = answer.entities.find((c) => c.ref === ref)
                if (card !== undefined) onEntity(card, answer)
              }
              const hover = (ref: string | null) => onHover(ref === null ? null : answer.entities.find((c) => c.ref === ref)?.id ?? null)
              return (
                <TurnView
                  key={turn.id}
                  turn={turn}
                  icon={icon}
                  answer={turn.reply && (
                    <CitedAnswer text={turn.reply} entities={answer.entities} selected={pointedRef} onSelect={select} onHover={hover} />
                  )}
                  progress={turn.status === 'pending' ? graphTurns.progress(answer) : undefined}
                  insight={
                    <AnswerDetails
                      ontologyKey={ontologyKey}
                      lensKey={lensKey}
                      turn={turn}
                      refused={refused.has(turn.id)}
                      onCanvas={onCanvas}
                      pointed={pointedRef}
                      onSelect={select}
                      onHover={hover}
                    />
                  }
                />
              )
            })}
          </div>
        )}
      </div>

      <div className="border-t px-3 pt-3 pb-2.5">
        <Composer
          name={assistant?.name ?? one}
          placeholder="Ask how things are connected…"
          conversation={conversation}
          disabled={assistantKey === null}
        />
      </div>
      <NewConversationDialog open={confirmNew} onOpenChange={setConfirmNew} onConfirm={conversation.startOver} />
    </div>
  )
}

/** Under an answer: the canvas's refusal, what it found and its steps — each collapsible. */
function AnswerDetails({ ontologyKey, lensKey, turn, refused, onCanvas, pointed, onSelect, onHover }: {
  ontologyKey: string
  lensKey: string
  turn: Turn<GraphInsight>
  refused: boolean
  onCanvas: ReadonlySet<string>
  pointed: string | null
  onSelect: (ref: string) => void
  onHover: (ref: string | null) => void
}) {
  const [open, setOpen] = useState<'found' | 'steps' | null>(null)
  const { entities, summary } = turn.insight
  if (!graphTurns.hasInsight(turn.insight)) return null
  const placed = entities.filter((card) => onCanvas.has(card.id)).length
  const toggle = (section: 'found' | 'steps') => setOpen((current) => (current === section ? null : section))
  return (
    <div className="space-y-1.5">
      {refused && (
        <p role="status" className="text-xs text-(--tc-amber)">
          Its entities were not added: the canvas would pass its limit.
        </p>
      )}
      <div className="flex flex-wrap gap-1">
        <SectionButton open={open === 'found'} onClick={() => toggle('found')}>
          Found {entities.length}
          {entities.length > 0 && <span className="text-muted-foreground/70">· {placed} on canvas</span>}
        </SectionButton>
        <SectionButton open={open === 'steps'} onClick={() => toggle('steps')}>
          Steps
          {summary?.durationMs !== undefined && <span className="text-muted-foreground/70">· {formatDuration(summary.durationMs)}</span>}
        </SectionButton>
      </div>
      {open === 'found' && (
        <EntityCardList
          ontologyKey={ontologyKey}
          lensKey={lensKey}
          turn={turn}
          selected={pointed}
          onSelect={onSelect}
          onHover={onHover}
          compact
          aside={(card) => onCanvas.has(card.id)
            ? <span title="On the canvas — click to show it" className="flex shrink-0 items-center gap-0.5 text-[10.5px] text-muted-foreground"><Check className="size-3" /> On canvas</span>
            : <span title="Click to add it to the canvas" className="flex shrink-0 items-center gap-0.5 text-[10.5px] text-primary"><Plus className="size-3" /> Add</span>}
        />
      )}
      {open === 'steps' && <div className="rounded-lg border p-3"><StepList turn={turn} /></div>}
    </div>
  )
}

function SectionButton({ open, onClick, children }: { open: boolean; onClick: () => void; children: ReactNode }) {
  return (
    <Button
      size="sm"
      variant={open ? 'secondary' : 'ghost'}
      aria-expanded={open}
      onClick={onClick}
      className={cn('-ml-1 flex h-6 w-fit gap-1 px-2 text-xs text-muted-foreground', open && 'text-foreground')}
    >
      <ChevronRight className={cn('size-3 transition-transform', open && 'rotate-90')} />
      {children}
    </Button>
  )
}
