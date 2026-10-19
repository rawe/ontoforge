/**
 * Pure helpers for the Workbench's view of parent relations: which parent
 * relations an entity type takes part in, path labels, and the parent-rule
 * form errors. No React, no I/O — unit-tested with `node --test`.
 */

import type { PathStep, SchemaRelationType } from '../../api/types.ts'

/** One parent relation seen from an entity: the neighbors in `direction` are its parent or its children. */
export interface HierarchyLink {
  relationType: SchemaRelationType
  direction: 'outgoing' | 'incoming'
}

/**
 * The parent relations an entity type takes part in. `parents`: the links where
 * it is the child end, reaching its parent. `children`: the links where it is
 * the parent end, reaching its children. A parent self-relation is in both.
 */
export function hierarchyLinks(
  relationTypes: readonly SchemaRelationType[],
  typeKey: string,
): { parents: HierarchyLink[]; children: HierarchyLink[] } {
  const parents: HierarchyLink[] = []
  const children: HierarchyLink[] = []
  for (const rt of relationTypes) {
    if (rt.parent === null) continue
    const parentEndType = rt.parent === 'source' ? rt.fromEntityTypeKey : rt.toEntityTypeKey
    const childEndType = rt.parent === 'source' ? rt.toEntityTypeKey : rt.fromEntityTypeKey
    // From the source, the target is outgoing; from the target, the source is incoming.
    if (childEndType === typeKey) {
      parents.push({ relationType: rt, direction: rt.parent === 'source' ? 'incoming' : 'outgoing' })
    }
    if (parentEndType === typeKey) {
      children.push({ relationType: rt, direction: rt.parent === 'source' ? 'outgoing' : 'incoming' })
    }
  }
  return { parents, children }
}

/** The entity type at the far end of a link: the parent's or the children's type. */
export function linkedTypeKey(link: HierarchyLink): string {
  return link.direction === 'outgoing'
    ? link.relationType.toEntityTypeKey
    : link.relationType.fromEntityTypeKey
}

/** A path step's label: its name, else the truncated id (as `displayLabel`). */
export function stepLabel(step: PathStep): string {
  return step.name !== null && step.name.trim() !== '' ? step.name : step.id.slice(0, 12)
}

/** A path as one line: "ACME › P1 › T1". */
export function formatPath(steps: readonly PathStep[]): string {
  return steps.map(stepLabel).join(' › ')
}

const ALREADY_HAS_PARENT = /^Entity '([^']+)' already has a parent$/

/**
 * A relation create's endpoint error, with the server's entity id replaced by
 * the entity's label: "T1 already has a parent". Other messages pass through.
 */
export function labelParentError(
  message: string,
  labels: Readonly<Record<string, string>>,
): string {
  const match = ALREADY_HAS_PARENT.exec(message)
  const label = match === null ? undefined : labels[match[1]!]
  return label === undefined ? message : `${label} already has a parent`
}

const RELATION_PROPERTY = 'parentRelation.properties.'

/**
 * The field errors of a create with a parent relation, split: the entity's
 * own (`name`), the parent relation's properties (`phase`, from
 * `parentRelation.properties.phase`), and any other parent relation fault as
 * one form message.
 */
export function splitParentErrors(fields: Readonly<Record<string, string>>): {
  entity: Record<string, string>
  relation: Record<string, string>
  form: string | null
} {
  const entity: Record<string, string> = {}
  const relation: Record<string, string> = {}
  const form: string[] = []
  for (const [key, message] of Object.entries(fields)) {
    if (key.startsWith(RELATION_PROPERTY)) relation[key.slice(RELATION_PROPERTY.length)] = message
    else if (key.startsWith('parentRelation')) form.push(message)
    else entity[key] = message
  }
  return { entity, relation, form: form.length === 0 ? null : form.join(' · ') }
}
