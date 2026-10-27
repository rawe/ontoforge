/**
 * A relation type's parent end, one of its relation rules
 * (`RelationRulesField`): "Parent: — / Source (X) / Target (Y)". Setting and
 * flipping are written at once; the server checks the stored data and may
 * refuse, and the refusal report then shows in place of the change (the flag
 * is unchanged). Clearing is never refused and asks once here. Renders a
 * fragment: the field, then the report as its own row.
 */

import { useState } from 'react'
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
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@/components/ui/select'
import { cn } from '@/lib/utils'
import { PARENT_RULES, relationRuleViolationsOf } from './errors'
import { useSetParent } from './mutations'
import { RuleRefusalReport } from './RuleRefusalReport'
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
  const violations = relationRuleViolationsOf(setParent.error)

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
        <RuleRefusalReport
          ontologyKey={ontologyKey}
          title={`Parent ${endLabel(setParent.variables)} not saved: the stored data breaks the parent rules. Nothing was changed.`}
          rules={PARENT_RULES}
          hint="Every entity has at most one parent, and there are no cycles. Fix the data in the Workbench, then retry."
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
              longer apply to them. One per pair stays on until you turn it off.
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
