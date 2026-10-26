/**
 * The report a refused relation rules write shows in place of the change:
 * a count per rule the write checked and the first five breaking entities,
 * each a Workbench link, a hint and Dismiss. Shared by every relation rule
 * (`RelationRulesField`). A row of its own (`basis-full` breaks the page
 * header's row).
 */

import { Link } from 'react-router-dom'
import type { RelationRule, RelationRuleViolation } from '@/api/types'
import { Button } from '@/components/ui/button'
import { useTargetLens } from '@/components/layout/surfaceTargets'
import { refusalReport } from './errors'

export function RuleRefusalReport({
  ontologyKey,
  title,
  rules,
  hint,
  violations,
  nameOf,
  onDismiss,
}: {
  ontologyKey: string
  /** "Parent Source (Customer) not saved: …". */
  title: string
  /** The rules the refused write checked, in report order. */
  rules: readonly RelationRule[]
  /** What the rules say and how to go on. */
  hint: string
  violations: readonly RelationRuleViolation[]
  nameOf: (typeKey: string) => string
  onDismiss: () => void
}) {
  // The lens the Studio's switch opens; null while it loads or when there is none.
  const { lens } = useTargetLens(ontologyKey)
  return (
    <div
      role="alert"
      className="grid basis-full gap-1.5 rounded-lg border border-destructive/40 bg-destructive/5 p-3 text-[12px]"
    >
      <p className="font-medium text-destructive">{title}</p>
      <ul className="grid gap-1">
        {refusalReport(violations, rules).map((line) => (
          <li key={line.rule}>
            <span className="font-medium">{line.summary}</span>
            {line.entities.length > 0 && (
              <span className="mt-0.5 flex flex-wrap gap-x-2 gap-y-0.5">
                {line.entities.map((e) => {
                  const label = `${nameOf(e.type)} ${e.id.slice(0, 8)}`
                  return lens === null ? (
                    <span key={e.id} className="font-mono text-[11px]" title={e.id}>
                      {label}
                    </span>
                  ) : (
                    <Link
                      key={e.id}
                      to={`/o/${ontologyKey}/w/${lens.key}/e/${encodeURIComponent(e.type)}/${encodeURIComponent(e.id)}`}
                      title={`Open in the Workbench (lens ${lens.name}) · ${e.id}`}
                      className="font-mono text-[11px] text-primary hover:underline"
                    >
                      {label}
                    </Link>
                  )
                })}
                {line.more > 0 && <span className="text-muted-foreground">and {line.more} more</span>}
              </span>
            )}
          </li>
        ))}
      </ul>
      <p className="text-muted-foreground">{hint}</p>
      <Button variant="ghost" size="xs" className="justify-self-start" onClick={onDismiss}>
        Dismiss
      </Button>
    </div>
  )
}
