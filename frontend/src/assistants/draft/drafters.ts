/**
 * How each drafter's proposal shows in the assistant panel, by the tool
 * that makes it: the card's title, what a new item is called, and the
 * labels of the fields it fills. A drafter's editor binds the draft itself
 * (`useDraftFill`, `AiChangedMark`); a new drafter is one entry here.
 *
 * No React, no I/O — unit-tested with `node --test`.
 */

import type { AddressKind } from '../address.ts'

export interface DraftView {
  /** The address kind of the items its editor edits. */
  kind: AddressKind
  /** The tool whose result is a proposal for that editor. */
  tool: string
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
    tool: 'fill_agent_draft',
    title: 'Agent draft',
    newItem: 'new agent',
    fields: { name: 'Name', description: 'Description', systemPrompt: 'System prompt', tools: 'Tools' },
  },
]

/** The view of the drafter whose tool is `tool`; undefined for any other tool. */
export const draftViewOf = (tool: string): DraftView | undefined => DRAFT_VIEWS.find((view) => view.tool === tool)

/** The labels of the fields a proposal fills, in the view's order; fields the view does not know are left out. */
export function proposedLabels(view: DraftView, fields: Record<string, unknown>): string[] {
  return Object.entries(view.fields).filter(([field]) => Object.hasOwn(fields, field)).map(([, label]) => label)
}
