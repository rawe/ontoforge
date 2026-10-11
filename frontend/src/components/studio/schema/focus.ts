/**
 * Focus mode's set of entity types — pure, unit-tested with `node --test`.
 * An entity type stays visible with its one-hop neighbours (the other
 * endpoint of every relation type touching it); a relation type with its two
 * endpoints. Everything else dims.
 */

import type { ModelSchema } from '../modeling/useModelSchema'
import type { SchemaSelection } from './schemaUrl'

/** The entity type ids in focus, or null when the selection names no type. */
export function focusSet(
  schema: Pick<ModelSchema, 'entityTypes' | 'relationTypes'>,
  sel: SchemaSelection | null,
): Set<string> | null {
  if (sel === null) return null
  const idOfKey = new Map(schema.entityTypes.map((t) => [t.key, t.entityTypeId]))
  const ids = new Set<string>()
  const addEnds = (r: ModelSchema['relationTypes'][number]) => {
    for (const key of [r.sourceEntityTypeKey, r.targetEntityTypeKey]) {
      const id = idOfKey.get(key)
      if (id !== undefined) ids.add(id)
    }
  }
  if (sel.kind === 'entity-types') {
    const id = idOfKey.get(sel.key)
    if (id === undefined) return null
    ids.add(id)
    for (const r of schema.relationTypes) {
      if (r.sourceEntityTypeKey === sel.key || r.targetEntityTypeKey === sel.key) addEnds(r)
    }
  } else {
    const r = schema.relationTypes.find((t) => t.key === sel.key)
    if (r === undefined) return null
    addEnds(r)
  }
  return ids
}
