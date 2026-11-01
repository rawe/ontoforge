/**
 * How each drafter's proposal shows in the assistant panel, by the kind of
 * item its editor edits: the card's title, what a new item is called, and
 * the labels of the fields it fills. Every proposal comes from the one
 * draft tool, `fill_draft`. A drafter's editor binds the draft itself
 * (`useDraftFill`, `AiChangedMark`); a new drafter is one entry here.
 *
 * No React, no I/O — unit-tested with `node --test`.
 */

import type { AddressKind } from '../address.ts'

export interface DraftView {
  /** The address kind of the items its editor edits. */
  kind: AddressKind
  /** The card's title: "Agent draft". */
  title: string
  /** What a new item, not saved yet, is called on the card. */
  newItem: string
  /** The label of each field it fills, in the order the card lists them. */
  fields: Record<string, string>
}

export const DRAFT_VIEWS: readonly DraftView[] = [
  {
    kind: 'agent',
    title: 'Agent draft',
    newItem: 'new agent',
    fields: { name: 'Name', description: 'Description', systemPrompt: 'System prompt', tools: 'Tools' },
  },
  {
    kind: 'searchIndex',
    title: 'Search index draft',
    newItem: 'new index',
    fields: {
      name: 'Name', key: 'Key', description: 'Description', entityType: 'Entity type', fields: 'Own fields',
      header: 'Owner line', relations: 'Relation groups', semantic: 'Semantic', keyword: 'Keyword',
    },
  },
]

/** The tool whose results are draft proposals. */
export const FILL_DRAFT = 'fill_draft'

/** The view of the drafter for items of `kind`; undefined when no drafter fills them. */
export const draftViewOf = (kind: AddressKind): DraftView | undefined => DRAFT_VIEWS.find((view) => view.kind === kind)

/** The labels of the fields a proposal fills, in the view's order; fields the view does not know are left out. */
export function proposedLabels(view: DraftView, fields: Record<string, unknown>): string[] {
  return Object.entries(view.fields).filter(([field]) => Object.hasOwn(fields, field)).map(([, label]) => label)
}
