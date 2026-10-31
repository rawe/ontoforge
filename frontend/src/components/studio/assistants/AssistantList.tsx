import { Plus } from 'lucide-react'
import type { ReactNode } from 'react'
import type { AssistantKind } from '@/api/types'
import { EmptyState } from '@/components/EmptyState'
import { AssistantExplainerButton } from '@/components/assistants/explainers/AssistantExplainer'
import { adapters } from '@/assistants'
import { Button } from '@/components/ui/button'
import { Skeleton } from '@/components/ui/skeleton'
import { AssistantDefaultCard, AssistantEmptyCard } from './AssistantCard'
import { assistantErrorLines } from './assistantModel'

/**
 * The list view of one kind: header with the count and the actions, then the
 * built-in default's card and the kind's cards — or the empty card.
 */
export function AssistantList({ kind, count, extras, emptyText, onNew, onOpenDefault, children }: {
  kind: AssistantKind
  /** How many the lens defines; the default does not count. */
  count: number
  /** Kind actions before New (Retrievers: Import). */
  extras?: ReactNode
  /** The empty card's sentence. */
  emptyText: string
  onNew: () => void
  onOpenDefault: () => void
  /** The kind's `AssistantCard`s. */
  children: ReactNode
}) {
  const { one, many } = adapters[kind].nouns
  return (
    <div className="space-y-4">
      <div className="flex flex-wrap items-center gap-2">
        <h3 className="text-[13px] font-semibold">{many[0].toUpperCase() + many.slice(1)}</h3>
        <span className="text-[13px] text-muted-foreground">{count}</span>
        <div className="ml-auto flex flex-wrap gap-2">
          <AssistantExplainerButton kind={kind} labeled />
          {extras}
          <Button size="sm" onClick={onNew}><Plus className="size-3.5" /> New {one.toLowerCase()}</Button>
        </div>
      </div>
      <div className="grid gap-3 lg:grid-cols-2">
        <AssistantDefaultCard kind={kind} onOpen={onOpenDefault} />
        {count === 0 ? <AssistantEmptyCard kind={kind} text={emptyText} onNew={onNew} /> : children}
      </div>
    </div>
  )
}

/** What a kind's tab shows while its lists load. */
export function AssistantLoading() {
  return <div className="space-y-3"><Skeleton className="h-8 w-64" /><Skeleton className="h-40 rounded-xl" /></div>
}

/** What a kind's tab shows when its lists failed to load, with Reload. */
export function AssistantLoadError({ kind, error, onReload }: { kind: AssistantKind; error: unknown; onReload: () => void }) {
  return (
    <div className="text-sm">
      <p role="alert" className="text-destructive">Could not load {adapters[kind].nouns.many}: {assistantErrorLines(error).join(' ')}</p>
      <Button variant="outline" size="sm" className="mt-3" onClick={onReload}>Reload</Button>
    </div>
  )
}

/** What the editor URL shows when the lens has no assistant under its key. */
export function AssistantNotFound({ kind, assistantKey, onBack }: { kind: AssistantKind; assistantKey: string; onBack: () => void }) {
  const { nouns: { one, many }, icon } = adapters[kind]
  return (
    <EmptyState
      icon={icon}
      title={`${one} not found`}
      description={`This lens has no ${one.toLowerCase()} ${assistantKey}. It may have been deleted.`}
      action={<Button variant="outline" onClick={onBack}>All {many}</Button>}
    />
  )
}
