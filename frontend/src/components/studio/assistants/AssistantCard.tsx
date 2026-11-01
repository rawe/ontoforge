import { Plus } from 'lucide-react'
import type { ReactNode } from 'react'
import type { AssistantKind } from '@/api/types'
import { adapters } from '@/assistants'
import { Badge } from '@/components/ui/badge'
import { Button } from '@/components/ui/button'
import { ASSISTANT_DEFAULT, ASSISTANT_DEFAULT_TEXT } from './assistantModel'

/** One assistant in a kind's list: the whole card opens its editor; kinds pass their badges and summary line. */
export function AssistantCard({ name, assistantKey, badges, description, summary, onOpen }: {
  name: string
  assistantKey: string
  /** Kind badges after the key (validity, warnings, tools). */
  badges?: ReactNode
  description: string | null
  /** One muted line under the description (what it searches, follows). */
  summary?: ReactNode
  onOpen: () => void
}) {
  return (
    <button type="button" onClick={onOpen} className="rounded-xl border bg-card p-4 text-left transition-colors hover:bg-muted/40">
      <div className="flex flex-wrap items-center gap-2">
        <span className="text-[13px] font-semibold">{name}</span>
        <Badge variant="outline" className="font-mono text-[11px]">{assistantKey}</Badge>
        {badges}
      </div>
      {description && <p className="mt-1 line-clamp-2 text-xs text-muted-foreground">{description}</p>}
      {summary && <p className="mt-2 text-xs text-muted-foreground">{summary}</p>}
    </button>
  )
}

/** The valid/invalid badge and the warnings count of an assistant the lens validates (retrievers, navigators). */
export function AssistantValidityBadges({ valid, warnings }: { valid: boolean; warnings: number }) {
  return (
    <>
      {!valid ? <Badge variant="destructive">invalid</Badge>
        : <Badge variant="outline" className="border-(--tc-emerald-border) text-(--tc-emerald)">valid</Badge>}
      <AssistantWarningsBadge warnings={warnings} />
    </>
  )
}

/** The amber "N warnings" badge; nothing without warnings. */
export function AssistantWarningsBadge({ warnings }: { warnings: number }) {
  if (warnings === 0) return null
  return (
    <Badge variant="outline" className="border-(--tc-amber-border) text-(--tc-amber)">
      {warnings} warning{warnings === 1 ? '' : 's'}
    </Badge>
  )
}

/** The built-in default of a kind, first in its list; the whole card opens its read-only page. */
export function AssistantDefaultCard({ kind, onOpen }: { kind: AssistantKind; onOpen: () => void }) {
  return (
    <button type="button" onClick={onOpen} className="rounded-xl border border-dashed p-4 text-left transition-colors hover:bg-muted/40">
      <div className="flex flex-wrap items-center gap-2">
        <span className="text-[13px] font-semibold">Default</span>
        <Badge variant="outline" className="font-mono text-[11px]">{ASSISTANT_DEFAULT}</Badge>
        <Badge variant="secondary">built in</Badge>
      </div>
      <p className="mt-1 text-xs text-muted-foreground">{ASSISTANT_DEFAULT_TEXT[kind]}</p>
    </button>
  )
}

/** The card after the default when a kind has none of its own yet. */
export function AssistantEmptyCard({ kind, text, onNew }: { kind: AssistantKind; text: string; onNew: () => void }) {
  const { one, many } = adapters[kind].nouns
  return (
    <div className="rounded-xl border bg-card p-4">
      <p className="text-[13px] font-semibold">No {many} yet</p>
      <p className="mt-1 text-xs text-muted-foreground">{text}</p>
      <Button size="sm" className="mt-3" onClick={onNew}><Plus className="size-3.5" /> New {one.toLowerCase()}</Button>
    </div>
  )
}
