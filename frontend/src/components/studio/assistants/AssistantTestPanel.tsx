import { useState, type ReactNode } from 'react'
import type { AssistantKind } from '@/api/types'
import { ASSISTANT_KINDS } from '@/components/assistants/kinds'

/**
 * The editor's sticky Test panel: a header with the chat's "New conversation"
 * target, the kind's extras and one hint, then the kind's chat — or a note
 * when the server has no AI provider.
 */
export function AssistantTestPanel({ kind, aiEnabled, hint, extras, children }: {
  kind: AssistantKind
  aiEnabled: boolean
  /** One muted sentence under the header: what the test asks and when it resets. */
  hint: string
  /** Header controls after the chat's actions (Retrievers: the Chat/Retrieve switch). */
  extras?: ReactNode
  /** The kind's chat, given where its "New conversation" action goes. */
  children: (actions: HTMLElement | null) => ReactNode
}) {
  const [actions, setActions] = useState<HTMLElement | null>(null)
  return (
    <section aria-label="Test" className="flex h-[85dvh] min-h-[640px] min-w-0 flex-col overflow-hidden rounded-xl border bg-card xl:sticky xl:top-4">
      <div className="border-b px-4 py-3">
        <div className="flex items-center justify-between gap-3">
          <h3 className="text-[13px] font-semibold">Test</h3>
          <div className="flex items-center gap-2">
            <div ref={setActions} className="flex items-center" />
            {extras}
          </div>
        </div>
        <p className="mt-0.5 text-xs text-muted-foreground">{hint}</p>
      </div>
      {aiEnabled ? children(actions)
        : <p className="p-4 text-xs text-muted-foreground">This server has no AI provider configured; {ASSISTANT_KINDS[kind].many} cannot answer here.</p>}
    </section>
  )
}
