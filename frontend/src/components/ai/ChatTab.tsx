import { useMutation, useQuery } from '@tanstack/react-query'
import { AlertCircle, Bot, RotateCcw, SendHorizonal, Trash2, X } from 'lucide-react'
import { useEffect, useMemo, useRef, useState, type KeyboardEvent } from 'react'
import { qk } from '@/api/queryKeys'
import { aiAgentChat, aiChat, listAiAgents } from '@/api/runtime'
import type { ChatMessage } from '@/api/types'
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
 * per-ontology+agent persisted history.
 */
export function ChatTab({ ontologyKey }: { ontologyKey: string }) {
  const agents = useQuery({
    queryKey: qk.agents(ontologyKey),
    queryFn: () => listAiAgents(ontologyKey),
  })
  const agentOptions = useMemo(() => {
    const list = agents.data ?? []
    return list.some((a) => a.key === DEFAULT_AGENT)
      ? list
      : [{ key: DEFAULT_AGENT, name: 'Default assistant', description: null }, ...list]
  }, [agents.data])

  const [agentKey, setAgentKey] = useState(DEFAULT_AGENT)
  const [messages, setMessages] = useState<StoredChatMessage[]>(() =>
    readChatHistory(ontologyKey, DEFAULT_AGENT),
  )
  const [input, setInput] = useState('')
  /** Message optimistically shown while the request is in flight / failed. */
  const [pendingText, setPendingText] = useState<string | null>(null)
  const [confirmClear, setConfirmClear] = useState(false)
  const scrollRef = useRef<HTMLDivElement>(null)
  const inputRef = useRef<HTMLTextAreaElement>(null)

  const send = useMutation({
    mutationFn: async (text: string) => {
      const history: ChatMessage[] = messages.map(({ role, content }) => ({
        role,
        content,
      }))
      const body = { message: text, history, includeToolCalls: true }
      return agentKey === DEFAULT_AGENT
        ? aiChat(ontologyKey, body)
        : aiAgentChat(ontologyKey, agentKey, body)
    },
    onSuccess: (response, text) => {
      const userMessage: StoredChatMessage = { role: 'user', content: text }
      const assistantMessage: StoredChatMessage = {
        role: 'assistant',
        content: response.reply,
      }
      if (response.toolCalls !== null && response.toolCalls.length > 0) {
        assistantMessage.toolCalls = response.toolCalls
      }
      const next = [...messages, userMessage, assistantMessage].slice(-50)
      setMessages(next)
      writeChatHistory(ontologyKey, agentKey, next)
      setPendingText(null)
    },
  })

  // Keep the list pinned to the bottom as messages/pending states change.
  useEffect(() => {
    const el = scrollRef.current
    if (el !== null) el.scrollTop = el.scrollHeight
  }, [messages, pendingText, send.isPending, send.isError])

  const submit = (text: string) => {
    const trimmed = text.trim()
    if (trimmed === '' || send.isPending) return
    setPendingText(trimmed)
    setInput('')
    send.mutate(trimmed)
  }

  const onInputKeyDown = (e: KeyboardEvent<HTMLTextAreaElement>) => {
    if (e.key === 'Enter' && !e.shiftKey) {
      e.preventDefault()
      submit(input)
    }
  }

  const dismissError = () => {
    setPendingText(null)
    send.reset()
    inputRef.current?.focus()
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
            setAgentKey(key)
            setMessages(readChatHistory(ontologyKey, key))
            setPendingText(null)
            send.reset()
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
        {messages.length === 0 && pendingText === null ? (
          <EmptyState
            icon={Bot}
            title="Chat with your knowledge graph"
            description="The agent can look up entities, traverse relations and run queries against this ontology. Answers may take a while with local models."
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
                    <Markdown>{m.content}</Markdown>
                    {m.toolCalls !== undefined && <ToolCallList toolCalls={m.toolCalls} />}
                  </div>
                </div>
              ),
            )}

            {pendingText !== null && (
              <div className="flex justify-end">
                <div className="max-w-[85%] whitespace-pre-wrap rounded-lg bg-primary/10 px-3 py-2 text-[13px] opacity-70">
                  {pendingText}
                </div>
              </div>
            )}
            {send.isPending && (
              <div className="flex gap-2.5">
                <div className="mt-0.5 flex size-6 shrink-0 items-center justify-center rounded-md border bg-muted/40">
                  <Bot className="size-3.5 text-muted-foreground" />
                </div>
                <ElapsedIndicator label="Thinking" />
              </div>
            )}
            {send.isError && pendingText !== null && (
              <div className="mx-auto flex max-w-lg items-start gap-2 rounded-lg border border-destructive/40 bg-destructive/5 px-3 py-2 text-[13px]">
                <AlertCircle className="mt-0.5 size-3.5 shrink-0 text-destructive" />
                <div className="min-w-0 flex-1">
                  <p className="text-destructive">{send.error.message}</p>
                  <div className="mt-1.5 flex gap-1.5">
                    <Button
                      variant="outline"
                      size="sm"
                      className="h-6 gap-1 px-2 text-xs"
                      onClick={() => send.mutate(pendingText)}
                    >
                      <RotateCcw className="size-3" />
                      Retry
                    </Button>
                    <Button
                      variant="ghost"
                      size="sm"
                      className="h-6 gap-1 px-2 text-xs text-muted-foreground"
                      onClick={dismissError}
                    >
                      <X className="size-3" />
                      Dismiss
                    </Button>
                  </div>
                </div>
              </div>
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
            disabled={send.isPending}
          />
          <Button
            size="icon"
            className="size-9 shrink-0"
            aria-label="Send message"
            disabled={input.trim() === '' || send.isPending}
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
              Removes the stored history for this agent in this ontology. This cannot be
              undone.
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel>Cancel</AlertDialogCancel>
            <AlertDialogAction
              onClick={() => {
                clearChatHistory(ontologyKey, agentKey)
                setMessages([])
                setPendingText(null)
                send.reset()
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
