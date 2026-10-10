import { AlertCircle, Bot, LoaderCircle, SendHorizonal, Trash2, Wrench } from 'lucide-react'
import { useEffect, useMemo, useRef, useState, type KeyboardEvent } from 'react'
import { chatErrorText, threadError, type ChatEvent } from '@/api/chatStream'
import { useAssistants } from '@/api/hooks'
import { agentChat } from '@/api/runtime'
import { EmptyState } from '@/components/EmptyState'
import { ElapsedIndicator } from '@/components/ai/ElapsedIndicator'
import { Markdown } from '@/components/ai/Markdown'
import { ToolCallList } from '@/components/ai/ToolCallList'
import { ToolCallPanel } from '@/components/ai/ToolCallPanel'
import {
  applyChatEvent,
  failTurn,
  inspectedTurn,
  pendingTurn,
  questionOf,
  toolError,
} from '@/components/ai/chatTurnModel'
import {
  EXPIRED_TEXT,
  forgetThread,
  rememberThread,
  rememberedThread,
  restoreThread,
  type ChatEntry,
} from '@/components/ai/chatStore'
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
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@/components/ui/select'
import { Textarea } from '@/components/ui/textarea'
import { readString, storageKeys, writeString } from '@/lib/storage'
import { cn } from '@/lib/utils'

const DEFAULT_AGENT = '_default'

/** One agent's conversation of this session: its thread and what the view shows. */
interface Conversation { threadId: string | null; messages: ChatEntry[] }

/**
 * Chat tab: agent picker in the header (the runtime list, the built-in
 * default first), markdown message list, Enter-to-send input and
 * elapsed-seconds pending state. Each agent's conversation is a server
 * thread; the browser remembers its id per lens + agent and restores the
 * messages on open. Tool calls stream into a panel on the right — each
 * answer's "tool calls" button shows its own there; with the panel switched
 * off they list inline.
 */
export function ChatTab({ ontologyKey, lensKey }: { ontologyKey: string; lensKey: string }) {
  const agents = useAssistants(ontologyKey, lensKey, 'agents')

  const [agentKey, setAgentKey] = useState(DEFAULT_AGENT)
  const owner = useMemo(() => ({ ontologyKey, lensKey, kind: 'agents' as const, assistantKey: agentKey }), [ontologyKey, lensKey, agentKey])
  const [messages, setMessages] = useState<ChatEntry[]>([])
  // Until the remembered thread is read back, nothing can be sent.
  const [restoring, setRestoring] = useState(true)
  const [notice, setNotice] = useState<string | null>(null)
  const [input, setInput] = useState('')
  const [confirmClear, setConfirmClear] = useState(false)
  const scrollRef = useRef<HTMLDivElement>(null)
  const inputRef = useRef<HTMLTextAreaElement>(null)
  const threadId = useRef<string | null>(null)
  // Conversations of this session, per agent: switching back keeps the tool calls.
  const conversations = useRef(new Map<string, Conversation>())
  const active = useRef<{ interrupt: () => void } | null>(null)
  const isPending = messages.some((m) => m.status === 'pending')
  const [showToolCalls, setShowToolCalls] = useState(() => readString(storageKeys.chatToolCalls) !== 'false')
  // The turn the panel shows; null follows the latest turn with tool calls.
  const [selectedTurn, setSelectedTurn] = useState<string | null>(null)
  const shownTurn = inspectedTurn(messages, selectedTurn)

  useEffect(() => () => active.current?.interrupt(), [])
  useEffect(() => {
    const el = scrollRef.current
    if (el !== null) el.scrollTop = el.scrollHeight
  }, [messages])

  // Restore the agent's remembered thread from the server, once per session.
  useEffect(() => {
    if (conversations.current.has(owner.assistantKey)) return
    const controller = new AbortController()
    restoreThread(owner, controller.signal).then(
      (restored) => {
        if (controller.signal.aborted) return
        const entries: ChatEntry[] = restored.messages.map(({ role, content }) =>
          role === 'assistant' ? { role, content, status: 'completed' } : { role, content })
        threadId.current = restored.threadId
        conversations.current.set(owner.assistantKey, { threadId: restored.threadId, messages: entries })
        setMessages(entries)
        setNotice(restored.expired ? EXPIRED_TEXT : null)
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
  }, [owner])

  const switchAgent = (key: string) => {
    active.current?.interrupt()
    const cached = conversations.current.get(key)
    threadId.current = cached?.threadId ?? null
    setMessages(cached?.messages ?? [])
    setRestoring(cached === undefined)
    setNotice(null)
    setSelectedTurn(null)
    setAgentKey(key)
  }

  const submit = async (text: string) => {
    const trimmed = text.trim()
    if (!trimmed || active.current || restoring) return
    const key = agentKey
    const thread = owner
    const controller = new AbortController()
    let turn = pendingTurn(crypto.randomUUID(), Date.now())
    const preceding = [...messages, { role: 'user' as const, content: trimmed }]
    const save = () => {
      const next = [...preceding, turn]
      setMessages(next)
      conversations.current.set(key, { threadId: threadId.current, messages: next })
    }
    const fail = (message: string) => {
      turn = failTurn(turn, message, Date.now())
      save()
    }
    const request = { interrupt: () => {
      if (active.current !== request) return
      active.current = null
      controller.abort()
      if (turn.status === 'pending') fail('Turn interrupted')
    } }
    active.current = request
    setInput('')
    setNotice(null)
    setSelectedTurn(null)
    save()
    const onEvent = (event: ChatEvent) => {
      if (active.current !== request) return
      if (event.type === 'thread') {
        threadId.current = event.threadId
        rememberThread(thread, event.threadId)
      }
      turn = applyChatEvent(turn, event, Date.now())
      save()
    }
    try {
      await agentChat(ontologyKey, lensKey, key, { message: trimmed, threadId: threadId.current ?? undefined }, onEvent, controller.signal)
    } catch (error) {
      if (active.current !== request) return
      if (threadError(error) === 'THREAD_NOT_FOUND') {
        // The thread expired: start over, the question back in the input.
        active.current = null
        forgetThread(thread)
        threadId.current = null
        conversations.current.set(key, { threadId: null, messages: [] })
        setMessages([])
        setNotice(EXPIRED_TEXT)
        setInput(trimmed)
        return
      }
      fail(chatErrorText(error, 'Chat failed'))
    } finally {
      if (active.current === request) active.current = null
    }
  }

  const onInputKeyDown = (e: KeyboardEvent<HTMLTextAreaElement>) => {
    if (e.key === 'Enter' && !e.shiftKey) {
      e.preventDefault()
      submit(input)
    }
  }

  return (
    <div className="flex min-h-0 flex-1 flex-col">
      {/* Header row: agent picker + clear */}
      <div className="flex items-center gap-2 border-b px-4 py-2">
        <Bot className="size-4 text-muted-foreground" />
        <Select
          value={agentKey}
          onValueChange={switchAgent}
        >
          <SelectTrigger size="sm" className="h-7 w-56 text-[13px]">
            <SelectValue placeholder="Agent" />
          </SelectTrigger>
          <SelectContent>
            {(agents.data ?? []).map((a) => (
              <SelectItem key={a.key} value={a.key} className="text-[13px]">
                <span className="flex items-center gap-2">
                  {a.name}
                  <span className="font-mono text-[10.5px] text-muted-foreground">
                    {a.key}
                  </span>
                </span>
              </SelectItem>
            ))}
          </SelectContent>
        </Select>
        <div className="ml-auto flex items-center gap-3">
          <label
            className="flex cursor-pointer items-center gap-2 text-xs"
            title="Show each answer's tool calls in a panel on the right, as they run"
          >
            <Checkbox
              aria-label="Show tool calls"
              checked={showToolCalls}
              onCheckedChange={(checked) => {
                setShowToolCalls(checked === true)
                writeString(storageKeys.chatToolCalls, String(checked === true))
              }}
            />
            Show tool calls
          </label>
          <Button
            variant="ghost"
            size="sm"
            className="h-7 gap-1.5 text-xs text-muted-foreground"
            disabled={messages.length === 0}
            onClick={() => setConfirmClear(true)}
          >
            <Trash2 className="size-3.5" />
            Clear chat
          </Button>
        </div>
      </div>

      {/* Conversation beside the tool-call panel; stacked when narrow. */}
      <div className="@container flex min-h-0 flex-1 flex-col">
        <div className="flex min-h-0 flex-1 flex-col @3xl:flex-row">
          <section className="flex min-h-[320px] min-w-0 flex-1 flex-col">
            {/* Messages */}
            <div ref={scrollRef} className="min-h-0 flex-1 overflow-y-auto px-4 py-4">
              {notice !== null && (
                <p role="status" className="mx-auto mb-4 max-w-2xl rounded border border-amber-500/30 bg-amber-500/5 px-3 py-2 text-xs">
                  {notice}
                </p>
              )}
              {restoring ? (
                <p role="status" className="flex items-center justify-center gap-2 py-12 text-xs text-muted-foreground">
                  <LoaderCircle className="size-3.5 animate-spin" /> Restoring the conversation …
                </p>
              ) : messages.length === 0 ? (
                <EmptyState
                  icon={Bot}
                  title="Chat with your knowledge graph"
                  description="The agent can look up entities, traverse relations and run queries against this lens. Answers may take a while with local models."
                  className="py-12"
                />
              ) : (
                <div className="mx-auto max-w-2xl space-y-4">
                  {messages.map((m, i) =>
                    m.role === 'user' ? (
                      <div key={i} className="flex justify-end">
                        <div className="max-w-[85%] whitespace-pre-wrap rounded-lg bg-primary/10 px-3 py-2 text-[13px]">
                          {m.content}
                        </div>
                      </div>
                    ) : (
                      <div key={i} className="flex gap-2.5">
                        <div className="mt-1 flex size-6 shrink-0 items-center justify-center rounded-md border bg-muted/40">
                          <Bot className="size-3.5 text-muted-foreground" />
                        </div>
                        <div className="min-w-0 flex-1">
                          {m.content && <Markdown>{m.content}</Markdown>}
                          {m.status === 'pending' && <ElapsedIndicator label="Thinking" />}
                          {m.status === 'failed' && (
                            <p role="alert" className="flex items-center gap-1.5 text-[13px] text-destructive">
                              <AlertCircle className="size-3.5" /> Incomplete: {m.error}
                            </p>
                          )}
                          {m.toolCalls !== undefined &&
                            (showToolCalls ? (
                              <ToolCallsButton
                                message={m}
                                selected={m.id !== undefined && m.id === shownTurn?.id}
                                onSelect={() => setSelectedTurn(m.id ?? null)}
                              />
                            ) : (
                              <ToolCallList toolCalls={m.toolCalls} />
                            ))}
                        </div>
                      </div>
                    ),
                  )}


                </div>
              )}
            </div>

            {/* Input */}
            <div className="border-t p-3">
              <div className="mx-auto flex max-w-2xl items-end gap-2">
                <Textarea
                  ref={inputRef}
                  value={input}
                  onChange={(e) => setInput(e.target.value)}
                  onKeyDown={onInputKeyDown}
                  placeholder="Ask about your data… (Enter to send, Shift+Enter for a new line)"
                  rows={2}
                  className="min-h-9 resize-none text-[13px]"
                  disabled={isPending || restoring}
                />
                <Button
                  size="icon"
                  className="size-9 shrink-0"
                  aria-label="Send message"
                  disabled={input.trim() === '' || isPending || restoring}
                  onClick={() => submit(input)}
                >
                  <SendHorizonal className="size-4" />
                </Button>
              </div>
            </div>
          </section>
          {showToolCalls && (
            <aside
              aria-label="Tool calls"
              className="flex max-h-[60vh] min-h-[280px] w-full shrink-0 flex-col border-t @3xl:max-h-none @3xl:w-[360px] @3xl:border-t-0 @3xl:border-l @5xl:w-[440px] @7xl:w-[520px]"
            >
              <div className="border-b px-4 py-2.5">
                <h2 className="flex items-center gap-1.5 text-sm font-medium">
                  <Wrench className="size-3.5 text-muted-foreground" /> Tool calls
                </h2>
                <p className="mt-0.5 text-xs text-muted-foreground">
                  What the agent looked up for the selected answer. Pick another answer with its tool-calls button.
                </p>
              </div>
              <ToolCallPanel
                key={shownTurn?.id ?? 'none'}
                ontologyKey={ontologyKey}
                lensKey={lensKey}
                turn={shownTurn}
                question={shownTurn === undefined ? undefined : questionOf(messages, shownTurn)}
                hasRestoredTurns={messages.some((m) => m.role === 'assistant' && m.id === undefined)}
              />
            </aside>
          )}
        </div>
      </div>

      <AlertDialog open={confirmClear} onOpenChange={setConfirmClear}>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>Clear this chat?</AlertDialogTitle>
            <AlertDialogDescription>
              Starts a new conversation with this agent in this lens. The current one
              can no longer be opened.
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel>Cancel</AlertDialogCancel>
            <AlertDialogAction
              onClick={() => {
                active.current?.interrupt()
                forgetThread(owner)
                threadId.current = null
                conversations.current.set(agentKey, { threadId: null, messages: [] })
                setMessages([])
                setNotice(null)
              }}
            >
              Clear
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </div>
  )
}

/** Under an answer: how many tool calls it made; selects it for the panel. */
function ToolCallsButton({
  message,
  selected,
  onSelect,
}: {
  message: ChatEntry
  selected: boolean
  onSelect: () => void
}) {
  const calls = message.toolCalls ?? []
  if (calls.length === 0) return null
  const running = calls.some((c) => c.status === 'pending')
  const errors = calls.filter((c) => toolError(c) !== null).length
  return (
    <Button
      size="sm"
      variant={selected ? 'secondary' : 'ghost'}
      aria-pressed={selected}
      onClick={onSelect}
      className={cn('mt-2 flex h-6 w-fit gap-1.5 px-2 text-xs text-muted-foreground', selected && 'text-foreground')}
    >
      {running ? <LoaderCircle className="size-3 animate-spin" /> : <Wrench className="size-3" />}
      {calls.length} tool {calls.length === 1 ? 'call' : 'calls'}
      {errors > 0 && <span className="text-(--tc-amber)">· {errors} with error</span>}
    </Button>
  )
}
