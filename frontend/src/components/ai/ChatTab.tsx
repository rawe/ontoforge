import { useQuery } from '@tanstack/react-query'
import { AlertCircle, Bot, SendHorizonal, Trash2 } from 'lucide-react'
import { useEffect, useMemo, useRef, useState, type KeyboardEvent } from 'react'
import { qk } from '@/api/queryKeys'
import { aiAgentChat, aiChat, listAiAgents } from '@/api/runtime'
import type { ChatMessage } from '@/api/types'
import type { ChatEvent } from '@/api/chatStream'
import { EmptyState } from '@/components/EmptyState'
import { ElapsedIndicator } from '@/components/ai/ElapsedIndicator'
import { Markdown } from '@/components/ai/Markdown'
import { ToolCallList } from '@/components/ai/ToolCallList'
import {
  clearChatHistory,
  readChatHistory,
  writeChatHistory,
  type StoredChatMessage,
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
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@/components/ui/select'
import { Textarea } from '@/components/ui/textarea'

const DEFAULT_AGENT = '_default'

/**
 * Chat tab: agent picker in the header, markdown message list with per-message
 * tool-call inspection, Enter-to-send input, elapsed-seconds pending state and
 * per-lens+agent persisted history.
 */
export function ChatTab({ ontologyKey, lensKey }: { ontologyKey: string; lensKey: string }) {
  const agents = useQuery({
    queryKey: qk.agents(ontologyKey, lensKey),
    queryFn: () => listAiAgents(ontologyKey, lensKey),
  })
  const agentOptions = useMemo(() => {
    const list = agents.data ?? []
    return list.some((a) => a.key === DEFAULT_AGENT)
      ? list
      : [{ key: DEFAULT_AGENT, name: 'Default assistant', description: null }, ...list]
  }, [agents.data])

  const [agentKey, setAgentKey] = useState(DEFAULT_AGENT)
  const [messages, setMessages] = useState<StoredChatMessage[]>(() =>
    readChatHistory(ontologyKey, lensKey, DEFAULT_AGENT),
  )
  const [input, setInput] = useState('')
  const [confirmClear, setConfirmClear] = useState(false)
  const scrollRef = useRef<HTMLDivElement>(null)
  const inputRef = useRef<HTMLTextAreaElement>(null)
  const conversations = useRef(new Map<string, StoredChatMessage[]>())
  const active = useRef<{ interrupt: () => void } | null>(null)
  const isPending = messages.some((m) => m.status === 'pending')

  useEffect(() => () => active.current?.interrupt(), [])
  useEffect(() => {
    const el = scrollRef.current
    if (el !== null) el.scrollTop = el.scrollHeight
  }, [messages])

  const submit = async (text: string) => {
    const trimmed = text.trim()
    if (!trimmed || active.current) return
    const history: ChatMessage[] = messages
      .filter((m) => m.content && (m.role === 'user' || !m.status || m.status === 'completed'))
      .map(({ role, content }) => ({ role, content }))
    const controller = new AbortController()
    let turn: StoredChatMessage = { role: 'assistant', content: '', status: 'pending', toolCalls: [] }
    const preceding = [...messages, { role: 'user' as const, content: trimmed }].slice(-49)
    const save = () => {
      const next = [...preceding, turn]
      setMessages(next)
      conversations.current.set(agentKey, next)
      writeChatHistory(ontologyKey, lensKey, agentKey, next)
    }
    const fail = (message: string) => {
      turn = { ...turn, status: 'failed', error: message,
        toolCalls: turn.toolCalls?.map((call) => call.status === 'pending'
          ? { ...call, status: 'interrupted' } : call) }
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
    save()
    const onEvent = (event: ChatEvent) => {
      if (active.current !== request) return
      switch (event.type) {
        case 'tool_call':
          turn = { ...turn, toolCalls: [...(turn.toolCalls ?? []), {
            callId: event.callId, tool: event.tool, args: event.args, status: 'pending',
          }] }
          break
        case 'tool_result':
          turn = { ...turn, toolCalls: turn.toolCalls?.map((call) => call.callId === event.callId
            ? { ...call, result: event.result, status: 'completed' } : call) }
          break
        case 'final': turn = { ...turn, content: event.reply, status: 'completed' }; break
        case 'error': fail(event.error.message); return
      }
      save()
    }
    try {
      const body = { message: trimmed, history }
      if (agentKey === DEFAULT_AGENT) await aiChat(ontologyKey, lensKey, body, onEvent, controller.signal)
      else await aiAgentChat(ontologyKey, lensKey, agentKey, body, onEvent, controller.signal)
    } catch (error) {
      if (active.current === request) fail(error instanceof Error ? error.message : 'Chat failed')
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
          onValueChange={(key) => {
            // Each agent keeps its own persisted thread.
            active.current?.interrupt()
            setAgentKey(key)
            setMessages(conversations.current.get(key) ?? readChatHistory(ontologyKey, lensKey, key))
          }}
        >
          <SelectTrigger size="sm" className="h-7 w-56 text-[13px]">
            <SelectValue placeholder="Agent" />
          </SelectTrigger>
          <SelectContent>
            {agentOptions.map((a) => (
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
        <div className="ml-auto">
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

      {/* Messages */}
      <div ref={scrollRef} className="min-h-0 flex-1 overflow-y-auto px-4 py-4">
        {messages.length === 0 ? (
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
                    {m.toolCalls !== undefined && <ToolCallList toolCalls={m.toolCalls} />}
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
            disabled={isPending}
          />
          <Button
            size="icon"
            className="size-9 shrink-0"
            aria-label="Send message"
            disabled={input.trim() === '' || isPending}
            onClick={() => submit(input)}
          >
            <SendHorizonal className="size-4" />
          </Button>
        </div>
      </div>

      <AlertDialog open={confirmClear} onOpenChange={setConfirmClear}>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>Clear this chat?</AlertDialogTitle>
            <AlertDialogDescription>
              Removes the stored history for this agent in this lens. This cannot be
              undone.
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel>Cancel</AlertDialogCancel>
            <AlertDialogAction
              onClick={() => {
                active.current?.interrupt()
                conversations.current.delete(agentKey)
                clearChatHistory(ontologyKey, lensKey, agentKey)
                setMessages([])
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
