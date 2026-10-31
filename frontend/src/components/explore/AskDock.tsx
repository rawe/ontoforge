import { Check, ChevronRight, LoaderCircle, MessageSquarePlus, MessagesSquare, Plus, X } from 'lucide-react'
import { memo, useEffect, useMemo, useRef, useState, type PointerEvent as ReactPointerEvent, type ReactNode } from 'react'
import { chatErrorText, Composer, DEFAULT_ASSISTANT, InsightToggle, Intro, NewConversationDialog, type ThreadOwner, type Turn, TurnView, useAssistantConversation } from '@/assistants'
import type { EntityCard } from '@/api/entities'
import { useAssistants } from '@/api/hooks'
import type { AssistantKind, RuntimeAssistant } from '@/api/types'
import { CitedAnswer } from '@/components/assistants/entities/CitedAnswer'
import { EntityCardList } from '@/components/assistants/entities/EntityCardList'
import { ASSISTANT_KINDS } from '@/components/assistants/kinds'
import { Button } from '@/components/ui/button'
import { Select, SelectContent, SelectGroup, SelectItem, SelectLabel, SelectTrigger, SelectValue } from '@/components/ui/select'
import { Skeleton } from '@/components/ui/skeleton'
import { Tooltip, TooltipContent, TooltipTrigger } from '@/components/ui/tooltip'
import { cn } from '@/lib/utils'
import { ASK_KIND_ORDER, MAX_WIDTH, MIN_WIDTH, chooseAssistant, choiceValue, parseChoice } from './askDockModel'
import { ASK_KINDS } from './askKinds'
import type { useAskDock } from './useAskDock'

/* ----------------------------------- dock ---------------------------------- */

/** What one answer met, as the canvas needs it. */
export type Answer = Pick<Turn<unknown>, 'entities' | 'links'>

interface AskDockProps {
  ontologyKey: string
  lensKey: string
  dock: ReturnType<typeof useAskDock>
  /** Entity ids on the canvas. */
  onCanvas: ReadonlySet<string>
  /** The entity the canvas points at — hovered or highlighted; its citations and cards are marked. */
  pointed: string | null
  /** A click on an entity of an answer: added when not on the canvas, else shown there. */
  onEntity: (card: EntityCard, answer: Answer) => void
  /** The entity of an answer under the pointer, null when none is. */
  onHover: (entityId: string | null) => void
  /** An answer that cites completed with auto-add on; resolves whether its entities were refused by the cap. */
  onAnswer: (turn: Pick<Turn<unknown>, 'reply' | 'entities' | 'links'>) => Promise<'added' | 'refused'>
}

/** The assistants listed first-to-last in the picker: the kind's `Default` first. */
const defaultFirst = (list: readonly RuntimeAssistant[]) =>
  [...list].sort((a, b) => Number(b.key === DEFAULT_ASSISTANT) - Number(a.key === DEFAULT_ASSISTANT))

/**
 * The Explorer's ask dock on the canvas's left edge, resizable: a
 * conversation with one assistant of the lens — of any kind — whose
 * answers fill the canvas. The chat's state lives here, so streamed
 * answers never render the canvas.
 */
export const AskDock = memo(function AskDock({ dock, ...props }: AskDockProps) {
  const { ontologyKey, lensKey } = props
  const queries: Record<AssistantKind, ReturnType<typeof useAssistants>> = {
    navigators: useAssistants(ontologyKey, lensKey, 'navigators'),
    retrievers: useAssistants(ontologyKey, lensKey, 'retrievers'),
    agents: useAssistants(ontologyKey, lensKey, 'agents'),
  }
  const settled = ASK_KIND_ORDER.every((kind) => !queries[kind].isPending)
  const lists: Partial<Record<AssistantKind, RuntimeAssistant[]>> = {}
  for (const kind of ASK_KIND_ORDER) if (queries[kind].data !== undefined) lists[kind] = defaultFirst(queries[kind].data)
  const choice = settled ? chooseAssistant(lists, { kind: dock.settings.kind, key: dock.settings.assistant }) : undefined
  const assistant = choice ? lists[choice.kind]?.find((a) => a.key === choice.key) : undefined
  const failed = ASK_KIND_ORDER.filter((kind) => queries[kind].error)
  const [width, setWidth] = useState<number | null>(null)

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

  const picker = choice === undefined ? <Skeleton className="h-7 w-40" /> : (
    <Select
      value={choice === null ? undefined : choiceValue(choice)}
      onValueChange={(value) => {
        const next = parseChoice(value)
        if (next !== null) dock.setAssistant(next)
      }}
    >
      <SelectTrigger size="sm" aria-label="Assistant" className="h-7 min-w-0 flex-1 text-[13px]">
        <SelectValue>{assistant?.name}</SelectValue>
      </SelectTrigger>
      <SelectContent position="popper" align="start">
        {ASK_KIND_ORDER.map((kind) => {
          const list = lists[kind]
          const { many, icon: Icon } = ASSISTANT_KINDS[kind]
          if (list?.length === 0) return null
          return (
            <SelectGroup key={kind}>
              <SelectLabel className="flex items-center gap-1.5 capitalize">
                <Icon className="size-3.5" /> {many}
              </SelectLabel>
              {list === undefined
                ? <p className="px-1.5 pb-1 text-xs text-destructive">Could not load {many}.</p>
                : list.map((a) => (
                    <SelectItem key={a.key} value={choiceValue({ kind, key: a.key })} className="text-[13px]">
                      <span className="flex items-baseline gap-2">
                        {a.name}
                        <span className="font-mono text-[10.5px] text-muted-foreground">{a.key}</span>
                      </span>
                    </SelectItem>
                  ))}
            </SelectGroup>
          )
        })}
      </SelectContent>
    </Select>
  )
  const close = <IconButton label="Close" onClick={dock.close}><X className="size-3.5" /></IconButton>

  return (
    <aside
      aria-label="Ask dock"
      style={{ width: width ?? dock.width }}
      className="relative flex h-full shrink-0 flex-col border-r bg-background"
    >
      {choice === null ? (
        <>
          <div className="flex min-h-11 items-center gap-1.5 border-b px-3 py-2">
            <MessagesSquare className="size-4 shrink-0 text-muted-foreground" />
            <span className="flex-1 text-[13px] font-medium">Ask</span>
            {close}
          </div>
          <div className="p-4 text-[13px]">
            {failed.length > 0 ? <>
              <p role="alert">Could not load the assistants: {chatErrorText(queries[failed[0]!].error, 'request failed')}</p>
              <Button variant="outline" size="sm" className="mt-3" onClick={() => failed.forEach((kind) => void queries[kind].refetch())}>Reload</Button>
            </> : <p className="text-muted-foreground">This lens has no assistants.</p>}
          </div>
        </>
      ) : (
        <AskConversation
          // Another assistant: its own conversation; a running answer is cancelled.
          key={choice === undefined ? 'loading' : choiceValue(choice)}
          {...props}
          kind={choice?.kind ?? dock.settings.kind}
          assistantKey={choice?.key ?? null}
          assistant={assistant ?? null}
          picker={picker}
          close={close}
          autoAdd={dock.settings.autoAdd}
          onAutoAdd={dock.setAutoAdd}
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
  )
})

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
  kind: AssistantKind
  /** Null while the lists load: nothing can be asked yet. */
  assistantKey: string | null
  assistant: RuntimeAssistant | null
  picker: ReactNode
  close: ReactNode
  autoAdd: boolean
  onAutoAdd: (on: boolean) => void
}

/** One conversation with the chosen assistant; its kind's entry says how to ask and what to show. */
function AskConversation({
  ontologyKey, lensKey, kind, assistantKey, assistant, picker, close, autoAdd, onAutoAdd,
  onCanvas, pointed, onEntity, onHover, onAnswer,
}: AskConversationProps) {
  // Fixed for a mount: another assistant remounts.
  const spec = ASK_KINDS[kind]
  const owner = useMemo<ThreadOwner | null>(
    () => (assistantKey === null ? null : { ontologyKey, lensKey, kind, assistantKey }),
    [ontologyKey, lensKey, kind, assistantKey],
  )
  // Answers whose entities the canvas refused (the cap).
  const [refused, setRefused] = useState<ReadonlySet<string>>(new Set())
  const [confirmNew, setConfirmNew] = useState(false)
  const conversation = useAssistantConversation({
    owner,
    model: spec.model,
    send: (body, onEvent, signal) =>
      (assistantKey === null ? Promise.resolve() : spec.send(ontologyKey, lensKey, assistantKey, body, onEvent, signal)),
    blocked: assistantKey === null,
    onComplete: (turn) => {
      if (!autoAdd || !spec.cites) return
      void onAnswer(turn).then((result) => {
        if (result === 'refused') setRefused((current) => new Set(current).add(turn.id))
      })
    },
  })
  const { turns, running, restoring, notice } = conversation
  const { icon, one } = ASSISTANT_KINDS[kind]
  const name = assistant?.name ?? one
  const scroll = useRef<HTMLDivElement>(null)
  useEffect(() => {
    if (scroll.current !== null) scroll.current.scrollTop = scroll.current.scrollHeight
  }, [turns])

  return (
    <div className="flex min-h-0 flex-1 flex-col">
      <div className="flex min-h-11 items-center gap-1 border-b px-2 py-2">
        <KindIcon kind={kind} />
        {picker}
        <IconButton label="New conversation" disabled={running || turns.length === 0} onClick={() => setConfirmNew(true)}>
          <MessageSquarePlus className="size-3.5" />
        </IconButton>
        {close}
      </div>
      {/* Only kinds whose answers cite have something to add on their own. */}
      {spec.cites && (
        <div className="border-b px-3 py-1.5">
          <InsightToggle
            label="Add cited entities to the canvas"
            title="When an answer completes, put the entities it cites on the canvas, with the relations between them"
            checked={autoAdd}
            onChange={onAutoAdd}
          />
        </div>
      )}

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
            name={name}
            description={assistant?.description}
            intro="Ask about the data of this lens. Click an entity an answer met to put it on the canvas; click it again to find it there."
          />
        ) : (
          <div className="space-y-5">
            {turns.map((turn) => {
              const pointedRef = pointed === null ? null : turn.entities.find((card) => card.id === pointed)?.ref ?? null
              const select = (ref: string) => {
                const card = turn.entities.find((c) => c.ref === ref)
                if (card !== undefined) onEntity(card, turn)
              }
              const hover = (ref: string | null) => onHover(ref === null ? null : turn.entities.find((c) => c.ref === ref)?.id ?? null)
              return (
                <TurnView
                  key={turn.id}
                  turn={turn}
                  icon={icon}
                  answer={turn.reply && (
                    <CitedAnswer text={turn.reply} entities={turn.entities} selected={pointedRef} onSelect={select} onHover={hover} />
                  )}
                  progress={turn.status === 'pending' ? spec.model.progress(turn.insight) : undefined}
                  insight={
                    <AnswerDetails
                      ontologyKey={ontologyKey}
                      lensKey={lensKey}
                      kind={kind}
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
        <Composer name={name} placeholder="Ask about your data…" conversation={conversation} disabled={assistantKey === null} />
      </div>
      <NewConversationDialog open={confirmNew} onOpenChange={setConfirmNew} onConfirm={conversation.startOver} />
    </div>
  )
}

function KindIcon({ kind }: { kind: AssistantKind }) {
  const Icon = ASSISTANT_KINDS[kind].icon
  return <Icon className="mx-1 size-4 shrink-0 text-muted-foreground" />
}

/** Under an answer: the canvas's refusal, the entities it met and what its kind did — each collapsible. */
function AnswerDetails({ ontologyKey, lensKey, kind, turn, refused, onCanvas, pointed, onSelect, onHover }: {
  ontologyKey: string
  lensKey: string
  kind: AssistantKind
  turn: Turn<unknown>
  refused: boolean
  onCanvas: ReadonlySet<string>
  pointed: string | null
  onSelect: (ref: string) => void
  onHover: (ref: string | null) => void
}) {
  const [open, setOpen] = useState<'found' | 'details' | null>(null)
  const { entities } = turn
  const { details } = ASK_KINDS[kind]
  const label = details?.label(turn) ?? null
  if (entities.length === 0 && label === null && !refused) return null
  const placed = entities.filter((card) => onCanvas.has(card.id)).length
  const toggle = (section: 'found' | 'details') => setOpen((current) => (current === section ? null : section))
  return (
    <div className="space-y-1.5">
      {refused && (
        <p role="status" className="text-xs text-(--tc-amber)">
          Its entities were not added: the canvas would pass its limit.
        </p>
      )}
      <div className="flex flex-wrap gap-1">
        {entities.length > 0 && (
          <SectionButton open={open === 'found'} onClick={() => toggle('found')}>
            Found {entities.length}
            <span className="text-muted-foreground/70">· {placed} on canvas</span>
          </SectionButton>
        )}
        {label !== null && (
          <SectionButton open={open === 'details'} onClick={() => toggle('details')}>{label}</SectionButton>
        )}
      </div>
      {open === 'found' && entities.length > 0 && (
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
      {open === 'details' && label !== null && details?.content(turn, { ontologyKey, lensKey })}
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
