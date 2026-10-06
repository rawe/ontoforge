import type { Matched, SearchCatalogEntry } from '@/api/types'

/** The parts of a lens schema the "matched via" line reads (a `RuntimeSchema` fits). */
export interface MatchedViaSchema {
  entityTypes: readonly { key: string; properties: readonly { key: string; displayName: string }[] }[]
  relationTypes: readonly { key: string; displayName: string }[]
}

/**
 * The document property a passage index chunks: from the catalog, else
 * from a managed passage key (`<type>~<documentProperty>`).
 */
function passageProperty(
  index: string,
  entry: SearchCatalogEntry | undefined,
): { entityType: string; property: string } | null {
  if (entry?.documentProperty != null) {
    return { entityType: entry.entityType, property: entry.documentProperty }
  }
  const [entityType, suffix] = index.split('~')
  if (suffix === undefined || suffix === '' || suffix === 'default') return null
  return { entityType, property: suffix }
}

/**
 * One short line telling which entry a search hit was found by — no
 * scores. `via Employment → ACME` for a relation part (the group label,
 * else the relation type's display name; the target's label, else its
 * truncated id), `via passage in Bio` for a passage, null for the entity's
 * own fields and for servers that send no `matched`.
 */
export function matchedViaText(
  matched: Matched | undefined,
  schema: MatchedViaSchema | undefined,
  catalog: readonly SearchCatalogEntry[] = [],
): string | null {
  if (matched === undefined) return null
  const entry = catalog.find((c) => c.key === matched.index)

  if (matched.partKind === 'relation') {
    const relationType = matched.relationType
    const label =
      entry?.relations.find((g) => g.relationType === relationType && g.label !== null)
        ?.label ??
      schema?.relationTypes.find((r) => r.key === relationType)?.displayName ??
      relationType
    const target = matched.target
    const targetLabel = target === null ? null : (target.label ?? target.id.slice(0, 12))
    if (label === null) return targetLabel === null ? null : `via ${targetLabel}`
    return targetLabel === null ? `via ${label}` : `via ${label} → ${targetLabel}`
  }

  if (matched.partKind === 'passage') {
    const passage = passageProperty(matched.index, entry)
    if (passage === null) return 'via passage'
    const displayName =
      schema?.entityTypes
        .find((t) => t.key === passage.entityType)
        ?.properties.find((p) => p.key === passage.property)?.displayName ?? passage.property
    return `via passage in ${displayName}`
  }

  return null
}
