import { Bot } from 'lucide-react'
import { useCallback, useEffect, type ReactNode } from 'react'
import { useSearchParams } from 'react-router-dom'
import { chatErrorText } from '@/api/chatStream'
import { useAssistants } from '@/api/hooks'
import type { AssistantKind, RuntimeAssistant } from '@/api/types'
import { Button } from '@/components/ui/button'
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select'
import { Skeleton } from '@/components/ui/skeleton'
import { DEFAULT_ASSISTANT } from './chatModel'

const PARAM = 'assistant'
const NOUN: Record<AssistantKind, { one: string; many: string }> = {
  agents: { one: 'Agent', many: 'agents' },
  retrievers: { one: 'Retriever', many: 'retrievers' },
}

/**
 * A Workbench Assistants tab: the kind's runtime list (the built-in
 * default first), the assistant chosen in `?assistant=<key>` — else, or
 * when the lens has no such assistant, Default, written back to the address
 * — and its picker, handed to the kind's chat.
 */
export function AssistantTab({
  ontologyKey,
  lensKey,
  kind,
  enabled = true,
  children,
}: {
  ontologyKey: string
  lensKey: string
  kind: AssistantKind
  enabled?: boolean
  children: (assistant: RuntimeAssistant, picker: ReactNode) => ReactNode
}) {
  const assistants = useAssistants(ontologyKey, lensKey, kind, enabled)
  const [searchParams, setSearchParams] = useSearchParams()
  const requested = searchParams.get(PARAM)
  const list = assistants.data
  const assistant = list === undefined ? undefined
    : list.find((a) => a.key === requested) ?? list.find((a) => a.key === DEFAULT_ASSISTANT) ?? list[0]
  const shownKey = assistant?.key
  const choose = useCallback((key: string) =>
    setSearchParams((current) => {
      const next = new URLSearchParams(current)
      next.set(PARAM, key)
      return next
    }, { replace: true }), [setSearchParams])
  // The address always names the assistant shown, also when it was picked by default.
  useEffect(() => {
    if (shownKey !== undefined && shownKey !== requested) choose(shownKey)
  }, [shownKey, requested, choose])

  if (assistants.isPending) {
    return (
      <div className="flex items-center gap-2 border-b px-4 py-2">
        <Skeleton className="h-7 w-48" />
      </div>
    )
  }
  if (assistants.error || list === undefined) {
    return (
      <div className="p-6 text-sm">
        <p role="alert">Could not load {NOUN[kind].many}: {chatErrorText(assistants.error, 'request failed')}</p>
        <Button variant="outline" size="sm" className="mt-3" onClick={() => void assistants.refetch()}>Reload</Button>
      </div>
    )
  }
  if (assistant === undefined) {
    return <p className="p-6 text-sm text-muted-foreground">This lens has no {NOUN[kind].many}.</p>
  }

  const picker = (
    <div className="flex min-w-0 items-center gap-2">
      <Bot className="size-4 shrink-0 text-muted-foreground" />
      <Select value={assistant.key} onValueChange={choose}>
        <SelectTrigger size="sm" aria-label={NOUN[kind].one} className="h-7 max-w-72 min-w-40 text-[13px]">
          <SelectValue>{assistant.name}</SelectValue>
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
    </div>
  )
  return <>{children(assistant, picker)}</>
}
