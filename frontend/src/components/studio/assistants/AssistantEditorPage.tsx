import { ChevronLeft, Plus } from 'lucide-react'
import type { ReactNode } from 'react'
import type { AssistantKind } from '@/api/types'
import { AssistantExplainerButton } from '@/components/assistants/explainers/AssistantExplainer'
import { ASSISTANT_KINDS } from '@/components/assistants/kinds'
import { Badge } from '@/components/ui/badge'
import { Button } from '@/components/ui/button'
import { ASSISTANT_DEFAULT, ASSISTANT_DEFAULT_TEXT, ASSISTANT_STATUS_TEXT, type AssistantStatus } from './assistantModel'

/**
 * The editor page of one assistant: title row (back, name, explainer, key,
 * status), then the form column (children) beside the test panel.
 */
export function AssistantEditorPage({ kind, title, assistantKey, status, onBack, test, children }: {
  kind: AssistantKind
  /** The draft's name, else the saved name, else "New …". */
  title: string
  /** The saved key, shown as a badge; null while new. */
  assistantKey: string | null
  status: AssistantStatus
  onBack: () => void
  /** The right column: an `AssistantTestPanel`. */
  test: ReactNode
  /** The left column: the kind's form, `AssistantActionBar` first. */
  children: ReactNode
}) {
  const { text, className } = ASSISTANT_STATUS_TEXT[status]
  return (
    <div className="space-y-4">
      <div className="flex flex-wrap items-center gap-2">
        <Button variant="ghost" size="sm" className="-ml-2 h-7 gap-1 text-xs text-muted-foreground" onClick={onBack}>
          <ChevronLeft className="size-3.5" /> All {ASSISTANT_KINDS[kind].many}
        </Button>
        <h2 className="text-[14px] font-semibold">{title}</h2>
        <AssistantExplainerButton kind={kind} className="-ml-1.5" />
        {assistantKey !== null && <Badge variant="outline" className="font-mono text-[11px]" title="Immutable key">{assistantKey}</Badge>}
        <span className={`text-xs ${className}`}>{text}</span>
      </div>
      <div className="grid items-start gap-6 xl:grid-cols-[minmax(0,1fr)_minmax(0,1.2fr)]">
        <div className="min-w-0">{children}</div>
        {test}
      </div>
    </div>
  )
}

/** The built-in default's read-only page: its sentence and New in place of a form, beside its test panel. */
export function AssistantDefaultPage({ kind, onBack, onNew, test }: {
  kind: AssistantKind
  onBack: () => void
  onNew: () => void
  /** The right column: an `AssistantTestPanel` chatting with `_default`. */
  test: ReactNode
}) {
  return (
    <AssistantEditorPage kind={kind} title="Default" assistantKey={ASSISTANT_DEFAULT} status="builtIn" onBack={onBack} test={test}>
      <section className="rounded-xl border bg-card p-4">
        <p className="text-xs text-muted-foreground">{ASSISTANT_DEFAULT_TEXT[kind]}</p>
        <Button size="sm" className="mt-3" onClick={onNew}><Plus className="size-3.5" /> New {ASSISTANT_KINDS[kind].one.toLowerCase()}</Button>
      </section>
    </AssistantEditorPage>
  )
}
