import type { JsonPrimitive, JsonValue, SchemaProperty } from '../../api/types'

/** Only declared scalar fields may enter a comparison; never document stubs or IDs. */
export function identitySnapshot(
  properties: readonly SchemaProperty[],
  values: Record<string, JsonValue>,
): Record<string, JsonPrimitive> {
  const snapshot: Record<string, JsonPrimitive> = {}
  for (const property of properties) {
    if (property.dataType === 'document' || property.key.startsWith('_')) continue
    const value = values[property.key]
    if (value === null || typeof value === 'string' || typeof value === 'boolean' ||
      (typeof value === 'number' && Number.isFinite(value))) snapshot[property.key] = value
  }
  return snapshot
}

/** Stop at cancellation or failure; never begin another provider call in parallel. */
export async function compareSequentially<T, R>(
  candidates: readonly T[],
  signal: AbortSignal,
  compare: (candidate: T) => Promise<R>,
  receive: (candidate: T, result: R) => void,
) {
  for (const candidate of candidates.slice(0, 3)) {
    if (signal.aborted) return
    const result = await compare(candidate)
    if (signal.aborted) return
    receive(candidate, result)
  }
}
