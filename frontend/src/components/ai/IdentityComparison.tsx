import { useEffect, useRef, useState } from 'react'
import { compareEntities } from '@/api/decisions'
import { useDisplayLabel } from '@/api/hooks'
import type { EntityIdentityComparison, JsonValue, SearchHit } from '@/api/types'
import { Button } from '@/components/ui/button'
import { coerceDraft } from '@/components/schema/propertyDraft'
import type { ReviewEntityItem } from './reviewModel'
import { compareSequentially, identitySnapshot } from './identityComparisonModel'

const labels = {
  same: 'Likely same entity',
  different: 'Likely different entities',
  insufficient: 'Insufficient information',
}
const percent = (value: number) => `${(value * 100).toFixed(1)}%`

/** An explicit advisory action. Its parent remounts it when inputs change. */
export function IdentityComparison({ ontologyKey, lensKey, item, candidates, disabled }: {
  ontologyKey: string
  lensKey: string
  item: ReviewEntityItem
  candidates: SearchHit[]
  disabled: boolean
}) {
  const displayLabel = useDisplayLabel()
  const active = useRef<AbortController | null>(null)
  const [pending, setPending] = useState(false)
  const [results, setResults] = useState<Record<string, EntityIdentityComparison>>({})
  const [error, setError] = useState<string | null>(null)
  useEffect(() => () => active.current?.abort(), [])

  const compare = async () => {
    if (disabled || active.current || !item.type) return
    const values: Record<string, JsonValue> = {}
    for (const property of item.type.properties) {
      if (property.dataType === 'document') continue
      const coerced = coerceDraft(property.dataType, item.drafts[property.key] ?? '')
      if (!coerced.ok || (typeof coerced.value === 'number' && !Number.isFinite(coerced.value))) {
        setError(`Fix ${property.displayName} before comparing identity.`)
        return
      }
      if (coerced.value !== null) values[property.key] = coerced.value
    }
    const left = identitySnapshot(item.type.properties, values)
    const properties = item.type.properties
    const controller = new AbortController()
    active.current = controller
    setPending(true)
    setError(null)
    setResults({})
    try {
      await compareSequentially(candidates, controller.signal,
        ({ entity }) => compareEntities(ontologyKey, lensKey, {
          entityTypeKey: item.entityTypeKey,
          left,
          right: identitySnapshot(properties, entity),
        }, controller.signal),
        ({ entity }, result) => setResults((previous) => ({ ...previous, [entity._id]: result })),
      )
    } catch (failure) {
      if (!controller.signal.aborted) setError(failure instanceof Error ? failure.message : 'Comparison failed')
    } finally {
      if (!controller.signal.aborted) {
        active.current = null
        setPending(false)
      }
    }
  }

  return (
    <div className="mt-2 space-y-1.5 text-xs" aria-live="polite">
      <p className="text-[11px] text-muted-foreground">Do these records describe the same real-world entity?</p>
      <Button variant="outline" size="sm" className="h-7 text-xs" disabled={disabled || pending} onClick={() => void compare()}>
        {pending ? 'Comparing identity…' : 'Compare identity'}
      </Button>
      {Object.keys(results).length > 0 && <p className="text-[11px] text-muted-foreground">Model assessment; choose an existing entity manually.</p>}
      {candidates.slice(0, 3).map(({ entity }) => {
        const result = results[entity._id]
        if (!result) return null
        return (
          <div key={entity._id} className="rounded border p-2">
            <p><span className="font-medium">{displayLabel(entity)}</span>: {labels[result.decision]}</p>
            <details className="mt-1 text-[11px] text-muted-foreground">
              <summary className="cursor-pointer">Model probabilities and confidence</summary>
              <p>Same: {percent(result.probabilities.same)} · Different: {percent(result.probabilities.different)} · Insufficient: {percent(result.probabilities.insufficient)}</p>
              <p>Model confidence: {percent(result.confidence)}. These values are not calibrated correctness guarantees.</p>
            </details>
            {result.truncatedFields.length > 0 && <p className="mt-1 text-[11px] text-muted-foreground">Comparison used shortened text: {result.truncatedFields.join(', ')}.</p>}
          </div>
        )
      })}
      {error && <p role="alert" className="text-destructive">{error}</p>}
    </div>
  )
}
