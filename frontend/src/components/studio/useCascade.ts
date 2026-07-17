import { useState } from 'react'
import { isCascadeError } from './lib'

export interface CascadeState {
  /** Backend message for the conflict. */
  message: string
  /** Ontologies whose scope will be updated by the cascade. */
  affectedOntologies: string[]
  /** Re-runs the operation with `cascade=true`. */
  retry: () => void
}

/**
 * State + guard for the CASCADE_REQUIRED (409) flow. Call `guard(error, retry)`
 * in a mutation's error handler: it captures cascade conflicts (returning true)
 * so the `CascadeDialog` can offer the cascading retry.
 */
export function useCascade() {
  const [cascade, setCascade] = useState<CascadeState | null>(null)
  const guard = (error: unknown, retry: () => void): boolean => {
    if (isCascadeError(error)) {
      setCascade({
        message: error.message,
        affectedOntologies: error.affectedOntologies ?? [],
        retry,
      })
      return true
    }
    return false
  }
  return { cascade, guard, clear: () => setCascade(null) }
}
