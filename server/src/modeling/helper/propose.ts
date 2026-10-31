/**
 * The Studio helper's schema proposal tool: the model hands in a whole
 * proposal (`proposals/proposal.ts`), the server checks it without writing
 * (`proposals/check.ts`) and returns the check. A later call in the same
 * turn replaces the turn's proposal, so a refused step never blocks its
 * fix; the turn's last proposal and its check are the turn's artifact.
 * Calls run one at a time. Only a person applies a proposal, from the
 * Studio: the model has no apply tool and no field to consent with.
 */

import type { Artifact, Tool } from "../../assistants/index.js";
import type { ModelingStore } from "../../core/ports.js";
import { DATA_TYPES } from "../../core/schemas.js";
import { checkProposal, type CheckResult } from "../proposals/check.js";
import { MAX_PROPOSAL_STEPS, Proposal } from "../proposals/proposal.js";
import { expectedError } from "./tools.js";

export const PROPOSE_SCHEMA_CHANGE = "propose_schema_change";

/** One Studio turn's state: its last checked proposal, if any. */
export interface StudioTurn {
  proposal: { proposal: Proposal; check: CheckResult } | null;
}

/** The turn's artifacts: its last proposal with its check, if any. */
export function turnArtifacts(turn: StudioTurn): Artifact[] {
  return turn.proposal === null ? [] : [{ type: "proposal", version: 1, value: turn.proposal }];
}

export function proposeSchemaChangeTool(store: ModelingStore): Tool<StudioTurn> {
  return {
    name: PROPOSE_SCHEMA_CHANGE,
    description:
      "Propose a change to the ontology's schema for the person to review and apply. Nothing is written: " +
      "the server checks the whole proposal against the current design and returns the check; only the " +
      "person can apply it, in the Studio. Each call replaces your earlier proposal of this message, so " +
      "always send the complete proposal. summary: one sentence on what it does. steps: in order, 1 to " +
      `${MAX_PROPOSAL_STEPS}; each has a unique id (s1, s2, …), an op, an optional reason and the op's fields:\n` +
      "- create_entity_type: key, name, description (optional). The type gets a string property 'name'.\n" +
      "- create_relation_type: key, name, source and target (entity type keys), description (optional).\n" +
      "- add_property: entityType or relationType (the type's key, exactly one), key, name, dataType " +
      `(${DATA_TYPES.join(", ")}; document only on entity types), required (default false), defaultValue ` +
      "(a string, optional), description (optional).\n" +
      "- set_description: entityType or relationType (exactly one), property (a property key of that type; " +
      "leave it out to describe the type itself), description (not empty).\n" +
      "Keys are lowercase letters, digits and underscores, starting with a letter. A step may use a type or " +
      "property an earlier step creates. Nothing can be deleted, renamed or cleared, and a step that would " +
      "need cascade (changing lenses or search indices to fit) is refused. Returns {ok, baseRevision, " +
      "refusals: [{stepId, code, message}], validation: {introduced, preExisting}, warnings, impact: " +
      "{lenses, indices}, limits}. ok true: the proposal can be applied as checked. Otherwise fix the " +
      "refused steps or the introduced validation errors and call again.",
    input: Proposal,
    serial: true,
    run: async (args, turn) => {
      const proposal = Proposal.parse(args);
      const check = await checkProposal(store, proposal);
      turn.proposal = { proposal, check };
      return check;
    },
    expected: expectedError,
  };
}
