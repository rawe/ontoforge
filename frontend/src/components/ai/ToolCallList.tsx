import { ChevronRight, Wrench } from 'lucide-react'
import { useState } from 'react'
import type { ToolCall } from '@/api/types'
import { cn } from '@/lib/utils'

/**
 * Collapsible tool-call inspection attached to an assistant chat message:
 * count badge in the summary row, tool name + pretty-printed args per call.
 */
export function ToolCallList({ toolCalls }: { toolCalls: ToolCall[] }) {
  const [open, setOpen] = useState(false)
  if (toolCalls.length === 0) return null

  return (
    <div className="mt-2">
      <button
        type="button"
        onClick={() => setOpen((o) => !o)}
        className={cn(
          'flex items-center gap-1.5 rounded-md px-1.5 py-0.5 text-xs text-muted-foreground',
          'transition-colors hover:bg-muted/60 hover:text-foreground',
        )}
        aria-expanded={open}
      >
        <ChevronRight
          className={cn('size-3 transition-transform', open && 'rotate-90')}
        />
        <Wrench className="size-3" />
        {toolCalls.length} tool {toolCalls.length === 1 ? 'call' : 'calls'}
      </button>
      {open && (
        <ol className="mt-1.5 space-y-1.5 border-l pl-3">
          {toolCalls.map((call, i) => (
            <li key={i} className="rounded-md border bg-muted/30 p-2">
              <div className="font-mono text-xs font-medium">{call.tool}</div>
              <pre className="mt-1 overflow-x-auto font-mono text-[11px] leading-relaxed text-muted-foreground">
                {JSON.stringify(call.args, null, 2)}
              </pre>
            </li>
          ))}
        </ol>
      )}
    </div>
  )
}
