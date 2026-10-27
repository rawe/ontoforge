/**
 * The relation rules of a relation type, in its header: one "Rules" group
 * holding each rule's field, the parent end (`ParentField`) and one per pair
 * (`OnePerPairField`). Every rule is set, changed and cleared here alone, and
 * a refusal by the stored data shows the same report (`RuleRefusalReport`).
 */

import type { RelationType } from '@/api/types'
import { cn } from '@/lib/utils'
import { OnePerPairField } from './OnePerPairField'
import { ParentField } from './ParentField'

export function RelationRulesField({
  ontologyKey,
  relation,
  variant,
}: {
  ontologyKey: string
  relation: RelationType
  variant: 'panel' | 'page'
}) {
  return (
    <div
      role="group"
      aria-label="Rules"
      className={cn(
        'flex flex-wrap items-center gap-x-4 gap-y-1',
        variant === 'panel' && 'grid gap-1 rounded-lg border p-2',
      )}
    >
      <span className="text-[11px] font-medium uppercase tracking-wide text-muted-foreground/80">Rules</span>
      <ParentField ontologyKey={ontologyKey} relation={relation} variant={variant} />
      <OnePerPairField ontologyKey={ontologyKey} relation={relation} variant={variant} />
    </div>
  )
}
