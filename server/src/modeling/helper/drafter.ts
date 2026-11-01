/**
 * The Studio helper's drafters: what fills an editor's unsaved draft. A
 * drafter is a plug for one kind of editor — the address kind of the item
 * it edits — and brings everything about that editor: the shape of its
 * values, how they read to the model, its guide (its part of the prompt)
 * and the check of a proposal. The helper's core names no drafter: it
 * finds the plug for the draft a message brings (`drafters/index.ts`),
 * sends the draft as a block of the message's context and the plug's guide
 * with the first message of the thread that needs it, and hands the one
 * `fill_draft` tool's calls to the plug.
 *
 * What the thread sends only ever grows (D12): the tools and the system
 * prompt are the same on every turn, whichever editor is open; only the
 * messages carry what an editor needs. No proposal writes: the person
 * fills it into the editor and saves it there.
 */

import { z } from "zod";

import type { ContextBlock, Guide, Tool } from "../../assistants/index.js";
import { ValidationError } from "../../core/exceptions.js";
import type { ModelingStore } from "../../core/ports.js";
import { addressLines, type DesignAddress } from "./address.js";
import { expectedError } from "./tools.js";

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
  /** Names its draft's context block and its guide: "Agent draft". */
  label: string;
  /** The editor's values, as the page sends them. */
  fields: z.ZodType<F>;
  /** The values as lines for the model, after the address. */
  show(fields: F): string[];
  /** Its part of the prompt: when and how to fill its editor's draft —
   * the fields to pass, their shape and rules. */
  guide(): Promise<string>;
  /** The values to propose for `draft` from the model's `proposed`, checked
   * as a save would check them; an expected error the model reads and
   * corrects when they do not pass. Writes nothing. */
  fill(draft: Draft<F>, proposed: Row, store: ModelingStore): Promise<Row>;
}

/** The result of a `fill_draft` call: the values it proposes for the draft
 * of `target` as it stood at `sourceVersion`. */
export interface DraftProposal {
  target: DesignAddress;
  sourceVersion: number;
  fields: Row;
}

/** An open draft with its drafter. */
export interface OpenDraft {
  drafter: Drafter;
  draft: Draft;
}

/** The draft as a labelled block: the person's own unsaved values. */
export function draftBlock({ drafter, draft }: OpenDraft): ContextBlock {
  return {
    label: drafter.label,
    source: "the editor the person has open, unsaved",
    text: [...addressLines(draft.target), ...drafter.show(draft.fields)].join("\n"),
  };
}

/** The drafter's guide for the open draft. */
export async function draftGuide({ drafter }: OpenDraft): Promise<Guide> {
  return { label: drafter.label, text: await drafter.guide() };
}

/** `value` as `schema` parses it; a validation error naming each issue's path otherwise. */
export function parsed<T>(schema: z.ZodType<T>, value: unknown): T {
  const result = schema.safeParse(value);
  if (result.success) return result.data;
  const fields: Record<string, string> = {};
  for (const issue of result.error.issues) {
    const path = issue.path.map(String).join(".") || "fields";
    fields[path] = fields[path] === undefined ? issue.message : `${fields[path]}; ${issue.message}`;
  }
  throw new ValidationError("Invalid draft fields", { fields });
}

export const FILL_DRAFT = "fill_draft";

/** The one draft tool, the same on every turn: proposes values for the
 * open draft through its drafter; refused when no draft is open. */
export function fillDraftTool(open: OpenDraft | undefined, store: ModelingStore): Tool<unknown> {
  return {
    name: FILL_DRAFT,
    description:
      "Propose values for the draft in the editor the person has open. It works only while their message " +
      "comes with a draft block of that editor's unsaved values; a guide for that kind of editor came with " +
      "the first such message and says when to call this tool and which fields to pass. Call it only when the " +
      "person asks you to draft, write or change what that editor holds. fields: the values you propose, " +
      "under the field names the guide gives. Nothing is saved: the person fills the editor from your " +
      "proposal, reviews it and saves it. Returns the proposal {target, sourceVersion, fields}; a refused " +
      "proposal returns an error with every reason: fix it and call again. Without such an editor open the " +
      "call is refused: describe the item in your answer instead.",
    input: z.object({ fields: z.record(z.string(), z.unknown()) }),
    run: async (args) => {
      if (open === undefined) {
        throw new ValidationError("No editor with a draft is open, so there is nothing to fill: describe the item in your answer instead.");
      }
      const { drafter, draft } = open;
      const fields = await drafter.fill(draft, args.fields as Row, store);
      return { target: draft.target, sourceVersion: draft.version, fields } satisfies DraftProposal;
    },
    expected: expectedError,
  };
}
