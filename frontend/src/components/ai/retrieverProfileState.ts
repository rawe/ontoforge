import type { RetrievalConfig } from '../../api/retrievalPrototype'

/** Saved execution must never silently consume an edited browser configuration. */
export function retrieverExecution(
  profile: { key: string; config: RetrievalConfig; configVersion?: number; validation: { valid: boolean } } | null,
  config: RetrievalConfig,
  preview: boolean,
  repairReviewed = false,
): { mode: 'saved'; key: string } | { mode: 'draft' } | { mode: 'blocked'; reason: string } {
  if (!profile) return { mode: 'draft' }
  if ((profile.configVersion !== undefined && profile.configVersion !== 1) || !editableRetrievalConfig(profile.config)) {
    return repairReviewed && preview ? { mode: 'draft' } : { mode: 'blocked', reason: 'Unsupported saved configuration. Export or review and apply a version 1 repair before previewing or saving.' }
  }
  const dirty = JSON.stringify(profile.config) !== JSON.stringify(config)
  if (dirty) return preview ? { mode: 'draft' } : { mode: 'blocked', reason: 'Save these changes or explicitly preview the draft before running.' }
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
