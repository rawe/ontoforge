/**
 * The schema page's "Issues" button: live lint warnings (`lint.ts`), grouped
 * by kind. Nothing here blocks a change. Clicking an issue selects and
 * reveals its type, and opens the property for a property issue.
 */

import { useState } from 'react'
import { AlertTriangle, CheckCircle2, FileQuestion, Unlink, UserSquare, type LucideIcon } from 'lucide-react'
import { Button } from '@/components/ui/button'
import { Popover, PopoverContent, PopoverTrigger } from '@/components/ui/popover'
import { cn } from '@/lib/utils'
import type { IssueKind } from '../modeling/lint'
import { useIssues } from '../modeling/useIssues'
import { useSchemaWorkspace } from './workspaceContext'

const GROUPS: { kind: IssueKind; label: string; icon: LucideIcon }[] = [
  { kind: 'no-description', label: 'Missing descriptions', icon: FileQuestion },
  { kind: 'isolated', label: 'Isolated entity types', icon: Unlink },
  { kind: 'only-name', label: 'Only the name property', icon: UserSquare },
]

export function IssuesPopover() {
  const { ontologyKey, select } = useSchemaWorkspace()
  const { issues } = useIssues(ontologyKey)
  const [open, setOpen] = useState(false)
  return (
    <Popover open={open} onOpenChange={setOpen}>
      <PopoverTrigger asChild>
        <Button variant="outline" size="sm" className={cn(issues.length > 0 && 'text-(--tc-amber)')}>
          {issues.length > 0 ? (
            <AlertTriangle className="size-3.5" />
          ) : (
            <CheckCircle2 className="size-3.5 text-(--tc-emerald)" />
          )}
          Issues
          <span className="rounded-full bg-muted px-1.5 text-[10.5px] text-foreground tabular-nums">
            {issues.length}
          </span>
        </Button>
      </PopoverTrigger>
      <PopoverContent align="end" className="w-96 p-0">
        <div className="border-b px-3 py-2">
          <p className="text-[13px] font-medium">Schema health</p>
          <p className="text-[11.5px] text-muted-foreground">Warnings only — nothing here blocks a change.</p>
        </div>
        <div className="max-h-[60vh] overflow-y-auto py-1">
          {issues.length === 0 && (
            <p className="px-3 py-6 text-center text-[12px] text-muted-foreground">No issues.</p>
          )}
          {GROUPS.map((g) => {
            const list = issues.filter((i) => i.kind === g.kind)
            if (list.length === 0) return null
            return (
              <div key={g.kind} className="py-1">
                <p className="flex items-center gap-1.5 px-3 py-1 text-[10.5px] font-medium tracking-wider text-muted-foreground uppercase">
                  <g.icon className="size-3.5" /> {g.label}
                  <span className="text-muted-foreground/70">{list.length}</span>
                </p>
                <ul>
                  {list.map((i) => (
                    <li key={i.id}>
                      <button
                        type="button"
                        className="flex w-full cursor-pointer items-center gap-2 px-3 py-1 text-left text-[12px] hover:bg-muted/60"
                        onClick={() => {
                          setOpen(false)
                          select(i.target, { reveal: true, propertyKey: i.propertyKey })
                        }}
                      >
                        <span className="size-1.5 shrink-0 rounded-full bg-(--tc-amber)" />
                        <span className="truncate font-mono text-[11.5px]">{i.subject}</span>
                        <span className="ml-auto shrink-0 text-[11px] text-muted-foreground">{i.message}</span>
                      </button>
                    </li>
                  ))}
                </ul>
              </div>
            )
          })}
        </div>
      </PopoverContent>
    </Popover>
  )
}
