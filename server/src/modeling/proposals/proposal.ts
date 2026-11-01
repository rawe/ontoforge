/**
 * A schema proposal: an ordered list of additive design steps, each with a
 * stable id, by key — what the Studio helper proposes and a person
 * applies (`check.ts`). Only the v1 subset: create an entity type, create
 * a relation type, add a property to a new or existing type, set a
 * description. No step deletes, renames or clears anything, and no field
 * expresses cascade or consent: a step that would need it is refused.
 */

import { z } from "zod";

import { DATA_TYPES, MAX_KEY_LENGTH, SCHEMA_KEY_PATTERN } from "../../core/schemas.js";

/** At most this many steps in one proposal: its full check holds the
 * design exclusively, and a data write waits at most 5 s for it
 * (`adapters/postgres/design.ts`). Measured on 20 types, 19 relation types
 * and 10 lenses: about 50 ms plus 2.5 ms per step, so 50 steps hold it
 * for about 0.2 s. */
export const MAX_PROPOSAL_STEPS = 50;

const Key = z.string().regex(SCHEMA_KEY_PATTERN).max(MAX_KEY_LENGTH);
const Name = z.string().min(1);
const Description = z.string().regex(/\S/, "A description is not empty");
const StepFields = { id: z.string().min(1), reason: z.string().optional() };

/** The type gets a string property `name`; `nameDescription` and
 * `nameRequired` set that property's description and required flag. */
export const CreateEntityTypeStep = z
  .object({
    ...StepFields, op: z.literal("create_entity_type"), key: Key, name: Name, description: Description.optional(),
    nameDescription: Description.optional(), nameRequired: z.boolean().optional(),
  })
  .strict();

export const CreateRelationTypeStep = z
  .object({
    ...StepFields, op: z.literal("create_relation_type"), key: Key, name: Name,
    source: Key, target: Key, description: Description.optional(),
  })
  .strict();

/** Names its type by exactly one of `entityType` and `relationType`. */
export const AddPropertyStep = z
  .object({
    ...StepFields, op: z.literal("add_property"), entityType: Key.optional(), relationType: Key.optional(),
    key: Key, name: Name, dataType: z.enum(DATA_TYPES), required: z.boolean().optional(),
    defaultValue: z.string().optional(), description: Description.optional(),
  })
  .strict();

/** Names its type by exactly one of `entityType` and `relationType`, and
 * a property of it by `property`; without, the type itself. */
export const SetDescriptionStep = z
  .object({
    ...StepFields, op: z.literal("set_description"), entityType: Key.optional(), relationType: Key.optional(),
    property: Key.optional(), description: Description,
  })
  .strict();

export const ProposalStep = z.discriminatedUnion("op", [
  CreateEntityTypeStep,
  CreateRelationTypeStep,
  AddPropertyStep,
  SetDescriptionStep,
]);
export type ProposalStep = z.infer<typeof ProposalStep>;

export const Proposal = z
  .object({ summary: z.string().optional(), steps: z.array(ProposalStep).min(1).max(MAX_PROPOSAL_STEPS) })
  .strict();
export type Proposal = z.infer<typeof Proposal>;

/** A design revision as the routes carry it. */
export const DesignRevisionBody = z.object({ ontologyId: z.string(), revision: z.number().int() }).strict();
