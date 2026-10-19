/**
 * A relation type's parent end, in its header: "Parent: — / Source (X) /
 * Target (Y)". Setting and flipping are written at once; the server checks
 * the stored data and may refuse, and the refusal report then shows in place
 * of the change (the flag is unchanged). Clearing is never refused and asks
 * once here. Renders a fragment: the field, then the report as its own row
 * (`basis-full` breaks the page header's row).
 */

import { useState } from 'react'
import { Link } from 'react-router-dom'
import type { ParentEnd, RelationType } from '@/api/types'
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
import { useTargetLens } from '@/components/layout/surfaceTargets'
import { cn } from '@/lib/utils'
import { parentViolationsOf, refusalReport } from './errors'
import { useSetParent } from './mutations'
import { useModelSchema } from './useModelSchema'

/** The Select's value for an ordinary relation type (an item cannot be ''). */
const NONE = 'none'

export function ParentField({
  ontologyKey,
  relation,
  variant,
}: {
  ontologyKey: string
  relation: RelationType
  variant: 'panel' | 'page'
}) {
  const schema = useModelSchema(ontologyKey)
  const setParent = useSetParent(ontologyKey, relation.relationTypeId)
  const [confirmClear, setConfirmClear] = useState(false)
  const nameOf = (key: string) => schema.entityTypes.find((t) => t.key === key)?.displayName ?? key
  const endLabel = (end: ParentEnd) =>
    end === 'source'
      ? `Source (${nameOf(relation.sourceEntityTypeKey)})`
      : `Target (${nameOf(relation.targetEntityTypeKey)})`
  const violations = parentViolationsOf(setParent.error)

  return (
    <>
      <label
        className={cn(
          'flex items-center gap-2 text-[12px] text-muted-foreground',
          variant === 'panel' && 'justify-between pt-1',
        )}
      >
        Parent
        <Select
          value={relation.parent ?? NONE}
          onValueChange={(v) => {
            if (v === (relation.parent ?? NONE)) return
            if (v === NONE) setConfirmClear(true)
            else setParent.mutate(v as ParentEnd)
          }}
          disabled={setParent.isPending}
        >
          <SelectTrigger
            size="sm"
            title="Parent end — the end that holds the parent. Every entity has at most one parent, and there are no cycles."
            className="min-w-36 text-xs"
          >
            <SelectValue />
          </SelectTrigger>
          <SelectContent>
            <SelectItem value={NONE}>—</SelectItem>
            <SelectItem value="source">{endLabel('source')}</SelectItem>
            <SelectItem value="target">{endLabel('target')}</SelectItem>
          </SelectContent>
        </Select>
      </label>

      {violations !== null && setParent.variables != null && (
        <RefusalReport
          ontologyKey={ontologyKey}
          attempted={endLabel(setParent.variables)}
          violations={violations}
          nameOf={nameOf}
          onDismiss={() => setParent.reset()}
        />
      )}

      <AlertDialog open={confirmClear} onOpenChange={setConfirmClear}>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>Clear the parent end of "{relation.key}"?</AlertDialogTitle>
            <AlertDialogDescription>
              It becomes an ordinary relation type. Its relations stay, and the parent rules no
              longer apply to them.
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel>Cancel</AlertDialogCancel>
            <AlertDialogAction onClick={() => setParent.mutate(null)}>Clear</AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </>
  )
}

/** A count per parent rule and the first five breaking entities, each a Workbench link. */
function RefusalReport({
  ontologyKey,
  attempted,
  violations,
  nameOf,
  onDismiss,
}: {
  ontologyKey: string
  attempted: string
  violations: Parameters<typeof refusalReport>[0]
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
      <p className="font-medium text-destructive">
        Parent {attempted} not saved: the stored data breaks the parent rules. Nothing was changed.
      </p>
      <ul className="grid gap-1">
        {refusalReport(violations).map((line) => (
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
      <p className="text-muted-foreground">
        Every entity has at most one parent, and there are no cycles. Fix the data in the
        Workbench, then retry.
      </p>
      <Button variant="ghost" size="xs" className="justify-self-start" onClick={onDismiss}>
        Dismiss
      </Button>
    </div>
  )
}
