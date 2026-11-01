/**
 * Every drafter the Studio helper has, and the draft a message brings,
 * checked against its drafter. A new drafter is one plug in its own file
 * and one entry in `DRAFTERS`; the helper's core stays as it is.
 */

import { z } from "zod";

import type { ContextBlock, Guide } from "../../../assistants/index.js";
import { DesignAddress } from "../address.js";
import { draftBlock, draftGuide, type Drafter, type OpenDraft } from "../drafter.js";
import { agentDrafter } from "./agent.js";
import { searchIndexDrafter } from "./searchIndex.js";

export const DRAFTERS: readonly Drafter[] = [agentDrafter, searchIndexDrafter];

/** The drafter of an editor of `kind`; undefined when that editor takes no draft. */
export const drafterFor = (kind: string): Drafter | undefined => DRAFTERS.find((drafter) => drafter.kind === kind);

/** The open editor's draft, as a message brings it: its target must be of
 * a kind some drafter fills, its values must fit that drafter. */
export const DraftPayload = z
  .object({
    target: DesignAddress,
    version: z.number().int().nonnegative(),
    fields: z.record(z.string(), z.unknown()),
  })
  .strict()
  .superRefine((draft, ctx) => {
    const drafter = drafterFor(draft.target.kind);
    if (drafter === undefined) {
      ctx.addIssue({ code: "custom", path: ["target", "kind"], message: `No editor of kind '${draft.target.kind}' takes a draft` });
      return;
    }
    const parsed = drafter.fields.safeParse(draft.fields);
    for (const issue of parsed.error?.issues ?? []) ctx.addIssue({ ...issue, path: ["fields", ...issue.path] } as never);
  });
export type DraftPayload = z.infer<typeof DraftPayload>;

/** What an open draft brings to a turn: its block for the message, its
 * drafter's guide and the draft the one draft tool fills. */
export interface DraftPart {
  block: ContextBlock;
  guide: Guide;
  open: OpenDraft;
}

/** The part of a turn `payload` brings, from its drafter. */
export async function draftPart(payload: DraftPayload): Promise<DraftPart> {
  const drafter = drafterFor(payload.target.kind)!;
  const open: OpenDraft = { drafter, draft: { ...payload, fields: drafter.fields.parse(payload.fields) } };
  return { block: draftBlock(open), guide: await draftGuide(open), open };
}
