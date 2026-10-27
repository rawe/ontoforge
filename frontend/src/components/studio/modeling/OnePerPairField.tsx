/**
 * A relation type's one per pair, one of its relation rules
 * (`RelationRulesField`): a switch with its help text. Turning it on is
 * written at once; the server checks the stored data and may refuse, and the
 * refusal report then shows in place of the change. Turning it off is never
 * refused. A parent relation always holds it, so the switch shows on and
 * locked while a parent end is set. Renders a fragment: the field, then the
 * report as its own row.
 */

import type { RelationType } from '@/api/types'
import { Switch } from '@/components/ui/switch'
import { cn } from '@/lib/utils'
import { ONE_PER_PAIR_RULES, relationRuleViolationsOf } from './errors'
import { useSetOnePerPair } from './mutations'
import { RuleRefusalReport } from './RuleRefusalReport'
import { useModelSchema } from './useModelSchema'

/** What one per pair says, wherever it is shown. */
export const ONE_PER_PAIR_HELP = 'At most one link of this type between the same two entities'

export function OnePerPairField({
  ontologyKey,
  relation,
  variant,
}: {
  ontologyKey: string
  relation: RelationType
  variant: 'panel' | 'page'
}) {
  const schema = useModelSchema(ontologyKey)
  const setOnePerPair = useSetOnePerPair(ontologyKey, relation.relationTypeId)
  const nameOf = (key: string) => schema.entityTypes.find((t) => t.key === key)?.displayName ?? key
  const implied = relation.parent !== null
  const violations = relationRuleViolationsOf(setOnePerPair.error)

  return (
    <>
      <label
        className={cn(
          'flex items-center gap-2 text-[12px] text-muted-foreground',
          variant === 'panel' && 'justify-between pt-1',
        )}
        title={implied ? `${ONE_PER_PAIR_HELP}. Implied by the parent end.` : `${ONE_PER_PAIR_HELP}.`}
      >
        <span className="grid">
          One per pair
          {implied && <span className="text-[10.5px] text-muted-foreground/70">Implied by the parent end</span>}
        </span>
        <Switch
          size="sm"
          checked={relation.onePerPair}
          disabled={implied || setOnePerPair.isPending}
          onCheckedChange={(on) => setOnePerPair.mutate(on)}
          aria-label="One per pair"
        />
      </label>

      {violations !== null && (
        <RuleRefusalReport
          ontologyKey={ontologyKey}
          title="One per pair not saved: the stored data links some pairs more than once. Nothing was changed."
          rules={ONE_PER_PAIR_RULES}
          hint={`${ONE_PER_PAIR_HELP}. Delete the extra relations in the Workbench, then retry.`}
          violations={violations}
          nameOf={nameOf}
          onDismiss={() => setOnePerPair.reset()}
        />
      )}
    </>
  )
}

/** The mark of a one-per-pair relation type in the outline and on the canvas. A parent relation keeps its own mark instead. */
export function OnePerPairBadge({ className }: { className?: string }) {
  return (
    <span
      className={cn(
        'inline-flex shrink-0 items-center rounded border px-1 font-sans text-[9.5px] leading-3.5 text-muted-foreground',
        className,
      )}
      title={`One per pair: ${ONE_PER_PAIR_HELP.toLowerCase()}`}
    >
      one per pair
    </span>
  )
}
