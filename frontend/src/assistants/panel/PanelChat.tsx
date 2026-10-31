import { ChevronRight, LoaderCircle, MessageSquarePlus, X } from 'lucide-react'
import { useEffect, useMemo, useRef, useState, type ReactNode } from 'react'
import type { StudioChatRequest } from '@/api/model'
import type { ToolCall } from '@/api/types'
import { Markdown } from '@/components/ai/Markdown'
import { Button } from '@/components/ui/button'
import { Tooltip, TooltipContent, TooltipTrigger } from '@/components/ui/tooltip'
import { cn } from '@/lib/utils'
import { studio } from '../adapters/studio'
import { DEFAULT_ASSISTANT, type Turn } from '../conversation/chatModel'
import type { ThreadOwner } from '../conversation/threadStore'
import { useAssistantConversation } from '../conversation/useAssistantConversation'
import { Composer, Intro, NewConversationDialog, TurnView } from '../shell/AssistantChat'
import type { Binding, Focus } from '../types'
import { useAssistantPanel } from './panelContext'
import { focusLabel } from './panelModel'

/**
 * The panel's conversation with the Studio helper: header, the focus chip,
 * the messages with each answer's steps and cards, and the input. The chip's
 * focus goes with each message as structured `focus`, the open draft
 * editor's draft as `draft`; the input starts empty. Remount it (React `key`) for another ontology or principal.
 */
export function PanelChat({ binding, focus, onRemoveFocus, onClose }: {
  binding: Binding
  focus: Focus | null
  onRemoveFocus: () => void
  onClose: () => void
}) {
  const { ontologyKey, lensKey } = binding
  // Fixed for a mount: another ontology remounts.
  const owner = useMemo<ThreadOwner>(
    () => ({ ontologyKey, lensKey, kind: studio.kind, assistantKey: DEFAULT_ASSISTANT }),
    [ontologyKey, lensKey],
  )
  const [confirmNew, setConfirmNew] = useState(false)
  const { draftEditor } = useAssistantPanel()
  const conversation = useAssistantConversation({
    owner,
    model: studio.model,
    send: (body, onEvent, signal) => {
      const open = draftEditor()?.state()
      const draft = open === undefined || open.ontologyKey !== ontologyKey
        ? undefined
        : { target: open.target, version: open.version, fields: open.fields }
      const request: StudioChatRequest = {
        ...body, ...(focus === null ? {} : { focus }), ...(draft === undefined ? {} : { draft }),
      }
      return studio.send(binding, DEFAULT_ASSISTANT, request, onEvent, signal)
    },
    blocked: false,
  })
  const { turns, running, restoring, notice } = conversation
  const { icon: Icon, nouns: { one: name } } = studio
  const scroll = useRef<HTMLDivElement>(null)
  useEffect(() => {
    if (scroll.current !== null) scroll.current.scrollTop = scroll.current.scrollHeight
  }, [turns])

  return (
    <div className="flex min-h-0 flex-1 flex-col">
      <div className="flex min-h-11 items-center gap-1 border-b px-2 py-2">
        <Icon className="mx-1 size-4 shrink-0 text-muted-foreground" />
        <h2 className="flex-1 truncate text-[13px] font-medium">{name}</h2>
        <IconButton label="New conversation" testId="assistant-panel-new" disabled={running || turns.length === 0} onClick={() => setConfirmNew(true)}>
          <MessageSquarePlus className="size-3.5" />
        </IconButton>
        <IconButton label="Close" testId="assistant-panel-close" onClick={onClose}>
          <X className="size-3.5" />
        </IconButton>
      </div>
      {focus !== null && (
        <div className="flex items-center gap-2 border-b px-3 py-1.5 text-xs">
          <span className="text-muted-foreground">Focus</span>
          <FocusChip focus={focus} onRemove={onRemoveFocus} />
        </div>
      )}

      <div ref={scroll} className="min-h-0 flex-1 overflow-y-auto px-3 py-4" data-testid="assistant-messages">
        {notice !== null && (
          <p role="status" className="mb-4 rounded border border-amber-500/30 bg-amber-500/5 px-3 py-2 text-xs">{notice}</p>
        )}
        {restoring ? (
          <p role="status" className="flex items-center justify-center gap-2 py-12 text-xs text-muted-foreground">
            <LoaderCircle className="size-3.5 animate-spin" /> Restoring the conversation …
          </p>
        ) : turns.length === 0 ? (
          <Intro
            icon={Icon}
            name={name}
            intro="Explains and reviews this ontology's design. It reads the design only, never instance data, and changes nothing."
          />
        ) : (
          <div className="space-y-5">
            {turns.map((turn) => (
              <TurnView
                key={turn.id}
                turn={turn}
                icon={Icon}
                answer={turn.reply && <Markdown>{turn.reply}</Markdown>}
                progress={turn.status === 'pending' ? studio.model.progress(turn.insight) : undefined}
                insight={<AnswerExtras binding={binding} turn={turn} />}
              />
            ))}
          </div>
        )}
      </div>

      <div className="border-t px-3 pt-3 pb-2.5">
        <Composer name={name} placeholder="Message" conversation={conversation} disabled={false} />
      </div>
      <NewConversationDialog open={confirmNew} onOpenChange={setConfirmNew} onConfirm={conversation.startOver} />
    </div>
  )
}

/** The page's focus: sent with the next message until removed. */
function FocusChip({ focus, onRemove }: { focus: Focus; onRemove: () => void }) {
  const { name, what } = focusLabel(focus)
  return (
    <span
      data-testid="assistant-focus-chip"
      className="inline-flex min-w-0 items-center gap-1 rounded-md border bg-muted/40 py-0.5 pr-0.5 pl-2"
    >
      <span className="truncate font-mono text-[11px]" title={name}>{name}</span>
      <span className="shrink-0 text-muted-foreground">· {what}</span>
      <Button
        variant="ghost"
        size="icon-xs"
        aria-label="Remove focus"
        data-testid="assistant-focus-remove"
        className="size-5 shrink-0"
        onClick={onRemove}
      >
        <X className="size-3" />
      </Button>
    </span>
  )
}

/** Under an answer: its steps, collapsed, and the cards its tool results brought. */
function AnswerExtras({ binding, turn }: { binding: Binding; turn: Turn<ToolCall[]> }) {
  const [open, setOpen] = useState(false)
  const { details, cards } = studio
  const label = details?.label(turn) ?? null
  return (
    <div className="space-y-1.5">
      {label !== null && (
        <Button
          size="sm"
          variant={open ? 'secondary' : 'ghost'}
          aria-expanded={open}
          data-testid="assistant-steps-toggle"
          onClick={() => setOpen(!open)}
          className={cn('-ml-1 flex h-6 w-fit gap-1 px-2 text-xs text-muted-foreground', open && 'text-foreground')}
        >
          <ChevronRight className={cn('size-3 transition-transform', open && 'rotate-90')} />
          {label}
        </Button>
      )}
      {open && label !== null && <div data-testid="assistant-steps">{details?.content(turn, binding)}</div>}
      {cards?.(turn, binding)}
    </div>
  )
}

function IconButton({ label, testId, onClick, disabled, children }: {
  label: string
  testId: string
  onClick: () => void
  disabled?: boolean
  children: ReactNode
}) {
  return (
    <Tooltip>
      <TooltipTrigger asChild>
        <Button variant="ghost" size="icon-sm" aria-label={label} data-testid={testId} disabled={disabled} onClick={onClick} className="size-7 shrink-0">
          {children}
        </Button>
      </TooltipTrigger>
      <TooltipContent>{label}</TooltipContent>
    </Tooltip>
  )
}
