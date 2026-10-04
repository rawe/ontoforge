import type { RetrievalConfig } from '../../api/retrievalPrototype'

/** A retriever runs only from its saved, unchanged and valid server configuration. */
export function retrieverExecution(
  profile: { key: string; config: RetrievalConfig; configVersion?: number; validation: { valid: boolean } } | null,
  config: RetrievalConfig,
  repairReviewed = false,
): { mode: 'saved'; key: string } | { mode: 'blocked'; reason: string } {
  if (!profile) return { mode: 'blocked', reason: 'Save this new retriever before running it.' }
  if ((profile.configVersion !== undefined && profile.configVersion !== 1) || !editableRetrievalConfig(profile.config)) {
    return { mode: 'blocked', reason: repairReviewed ? 'Save the reviewed version 1 repair before running.' : 'Unsupported saved configuration. Export it, or review and save a version 1 repair.' }
  }
  if (repairReviewed || JSON.stringify(profile.config) !== JSON.stringify(config)) return { mode: 'blocked', reason: 'Save or discard your changes before running.' }
  if (!profile.validation.valid) return { mode: 'blocked', reason: 'This saved retriever is invalid in the current lens. Repair its configuration before running.' }
  return { mode: 'saved', key: profile.key }
}

/** Keep invalid schema references intact while preventing malformed JSON from breaking the editor. */
export function editableRetrievalConfig(value: unknown): value is RetrievalConfig {
  const record = (item: unknown): item is Record<string, unknown> => typeof item === 'object' && item !== null && !Array.isArray(item)
  if (!record(value)) return false
  const config = value as unknown as RetrievalConfig
  const strings = (items: unknown): items is string[] => Array.isArray(items) && items.every((item) => typeof item === 'string')
  return Number.isFinite(config.threshold) && Array.isArray(config.buckets) && config.buckets.every((bucket) =>
    record(bucket) && typeof bucket.entityTypeKey === 'string' && strings(bucket.searchFields) && strings(bucket.answerFields) && Array.isArray(bucket.conditions) && bucket.conditions.every((condition) =>
      record(condition) && typeof condition.id === 'string' && ['hard', 'soft'].includes(condition.mode) && typeof condition.targetField === 'string' && strings(condition.textFields) && Array.isArray(condition.path) && condition.path.every((hop) => record(hop) && typeof hop.relationTypeKey === 'string' && ['incoming', 'outgoing'].includes(hop.direction)),
    ),
  )
}
