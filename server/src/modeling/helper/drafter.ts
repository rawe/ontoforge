/**
 * The Studio helper's drafters: what fills an editor's unsaved draft. A
 * drafter is a plug for one kind of editor — the address kind of the item
 * it edits — and brings everything about that editor: the shape of its
 * values, how they read to the model, and its tools, whose descriptions
 * are its part of the prompt. The helper's core names no drafter: it finds
 * the plug for the draft a message brings (`drafters/index.ts`), sends the
 * draft as a block of the message's context and offers the plug's tools on
 * that turn only. No drafter's tool writes: each returns a draft proposal
 * the person fills into the editor and saves there.
 */

import type { z } from "zod";

import type { ContextBlock, Tool } from "../../assistants/index.js";
import type { ModelingStore } from "../../core/ports.js";
import { addressLines, type DesignAddress } from "./address.js";

type Row = Record<string, unknown>;

/** An open editor's draft: which item (its address; the item's key null
 * for a new one), its version — bumped by the editor on every edit — and
 * its values. */
export interface Draft<F = Row> {
  target: DesignAddress;
  version: number;
  fields: F;
}

/** A plug that fills the drafts of one kind of editor. */
export interface Drafter<F = Row> {
  /** The address kind of the items its editor edits. */
  kind: DesignAddress["kind"];
  /** The label of the draft's context block: "Agent draft". */
  label: string;
  /** The editor's values, as the page sends them. */
  fields: z.ZodType<F>;
  /** The values as lines for the model, after the address. */
  show(fields: F): string[];
  /** Its tools for one turn, bound to the open draft. Their descriptions
   * are its part of the prompt: offered only while its editor is open. */
  tools(draft: Draft<F>, store: ModelingStore): Promise<Tool<unknown>[]>;
}

/** A drafter tool's result: the values it proposes for the draft of
 * `target` as it stood at `sourceVersion`. */
export interface DraftProposal {
  target: DesignAddress;
  sourceVersion: number;
  fields: Row;
}

/** The proposal of `fields` for `draft`. */
export const draftProposal = (draft: Draft<unknown>, fields: Row): DraftProposal =>
  ({ target: draft.target, sourceVersion: draft.version, fields });

/** The draft as a labelled block: the person's own unsaved values. */
export function draftBlock<F>(drafter: Drafter<F>, draft: Draft<F>): ContextBlock {
  return {
    label: drafter.label,
    source: "the editor the person has open, unsaved",
    text: [...addressLines(draft.target), ...drafter.show(draft.fields)].join("\n"),
  };
}
