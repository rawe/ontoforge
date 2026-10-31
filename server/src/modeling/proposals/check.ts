/**
 * Checking and applying a schema proposal (`proposal.ts`). Both run the
 * same checks, in two stages:
 *
 * 1. cheap ones on the design as read, without a lock: step ids, the keys
 *    each step creates, and what it refers to — an existing type or
 *    property, or one an earlier step creates;
 * 2. the full check: every step through the modeling commands
 *    (`service.ts`, their forms inside a design change) in one design
 *    change, then the resulting design's validation, split into what the
 *    proposal introduces and what was there before.
 *
 * A check owns its design change and always rolls it back (the store's
 * `rollback`); on a store already inside a design change it is refused,
 * as a nested change has nothing of its own to roll back. The after-commit
 * work the steps queue is dropped with it. Apply runs both stages again,
 * in a design change that expects the revision the person checked, so it
 * commits every step or none; once committed, it runs the queued work once,
 * on a store of its own.
 *
 * A step that fails a modeling rule is a refusal naming the step; the
 * full check stops at the first. A step that would need cascade consent
 * is a refusal too: a proposal cannot consent.
 */

import { sameDesign } from "../../core/designRevision.js";
import {
  CascadeRequiredError,
  ConflictError,
  NotFoundError,
  StaleDesignError,
  ValidationError,
} from "../../core/exceptions.js";
import { getModelingStore, type DesignRevision, type ModelingStore } from "../../core/ports.js";
import { DEFAULT_NAME_PROPERTY, type TypeKind } from "../../core/schemas.js";
import { EffectQueue } from "../effects.js";
import * as service from "../service.js";
import type { Proposal, ProposalStep } from "./proposal.js";

type Row = Record<string, unknown>;

export interface Refusal {
  stepId: string;
  code: string;
  message: string;
  details?: unknown;
}

/** A validation issue: where in the design, and what. */
export interface Issue {
  path: string;
  message: string;
}

export interface CheckResult {
  /** No refusal, and no validation error the proposal introduces. */
  ok: boolean;
  /** The design the check ran on, read under its hold; Apply expects it. */
  baseRevision: DesignRevision;
  refusals: Refusal[];
  /** The resulting design's validation errors: new ones, and those the design had before. */
  validation: { introduced: Issue[]; preExisting: Issue[] };
  warnings: { stepId?: string; path?: string; message: string }[];
  /** The lenses that show what the proposal adds or describes, and the search indices it changes. */
  impact: { lenses: string[]; indices: string[] };
  /** What the check does not prove. */
  limits: string[];
}

export interface Receipt {
  /** The revision the applied proposal committed. */
  revision: DesignRevision;
  /** The id of everything created, by its design path: `entityTypes.<key>`,
   * `relationTypes.<key>`, `<type path>.properties.<key>`. */
  created: Record<string, string>;
}

/** Apply refused the proposal; nothing was written. -> 409, `details.code`
 * `PROPOSAL_REFUSED` with the check. */
export class ProposalRefusedError extends ConflictError {
  constructor(check: CheckResult) {
    super("The proposal was refused; nothing was written", { code: "PROPOSAL_REFUSED", check });
  }
}

const LIMITS = [
  "The check ran every step and validated the resulting design inside a design change it rolled back: " +
    "constraints the storage checks only at commit did not run. Apply runs them, and commits all steps or none.",
  "The result holds for baseRevision only: Apply checks everything again and refuses when the design changed since.",
  "Stored data can change without changing the design revision; Apply repeats every check that reads it.",
  "No search index is built by the check; after Apply, the search indices are brought up to date in the background.",
];
const NOT_RUN = "The full check did not run: a step was refused before it. Nothing else was checked.";
const STOPPED = "The steps after the refused one did not run, and the resulting design was not validated.";

/** The parts of a result the full check fills, empty. */
const unchecked = () => ({ validation: { introduced: [], preExisting: [] }, warnings: [], impact: { lenses: [], indices: [] } });

// ---------------------------------------------------------------------------
// Cheap checks
// ---------------------------------------------------------------------------

/** Each type of a design by key, with its property keys. */
interface Known {
  entityTypes: Map<string, Set<string>>;
  relationTypes: Map<string, Set<string>>;
}

function knownDesign(schema: Row): Known {
  const keys = (rows: unknown) => new Map((rows as Row[]).map((row) =>
    [row.key as string, new Set(((row.properties as Row[] | undefined) ?? []).map((p) => p.key as string))]));
  return { entityTypes: keys(schema.entityTypes), relationTypes: keys(schema.relationTypes) };
}

type OwnedStep = Extract<ProposalStep, { op: "add_property" | "set_description" }>;

/** The type a step names: kind, key, its design path. */
interface Owner {
  kind: TypeKind;
  key: string;
  path: string;
}

/** The type a step names by exactly one of `entityType` and `relationType`; null when it names none or both. */
function ownerOf(step: OwnedStep): Owner | null {
  if ((step.entityType === undefined) === (step.relationType === undefined)) return null;
  return step.entityType !== undefined
    ? { kind: "EntityType", key: step.entityType, path: `entityTypes.${step.entityType}` }
    : { kind: "RelationType", key: step.relationType!, path: `relationTypes.${step.relationType}` };
}

const typeName = (kind: TypeKind) => (kind === "EntityType" ? "Entity type" : "Relation type");

/**
 * The refusals the design as read gives, in step order: a step id used
 * before, a key that exists or an earlier step creates, a reference to
 * neither, a type named by neither or both of entityType and relationType,
 * a document property on a relation type.
 */
export function cheapRefusals(proposal: Proposal, schema: Row): Refusal[] {
  const known = knownDesign(schema);
  const refusals: Refusal[] = [];
  const ids = new Set<string>();
  const refuse = (step: ProposalStep, code: string, message: string) => refusals.push({ stepId: step.id, code, message });
  const missing = (what: string) => `${what} does not exist, and no earlier step creates it`;
  const owned = (step: OwnedStep): Set<string> | null => {
    const owner = ownerOf(step);
    if (owner === null) {
      refuse(step, "INVALID", "Name the type with exactly one of entityType and relationType");
      return null;
    }
    const properties = (owner.kind === "EntityType" ? known.entityTypes : known.relationTypes).get(owner.key);
    if (properties === undefined) refuse(step, "NOT_FOUND", missing(`${typeName(owner.kind)} '${owner.key}'`));
    return properties ?? null;
  };

  for (const step of proposal.steps) {
    if (ids.has(step.id)) {
      refuse(step, "DUPLICATE_STEP_ID", `Step id '${step.id}' is taken by an earlier step`);
      continue;
    }
    ids.add(step.id);
    switch (step.op) {
      case "create_entity_type":
        if (known.entityTypes.has(step.key)) refuse(step, "ALREADY_EXISTS", `Entity type '${step.key}' already exists`);
        else known.entityTypes.set(step.key, new Set([DEFAULT_NAME_PROPERTY]));
        break;
      case "create_relation_type":
        if (known.relationTypes.has(step.key)) {
          refuse(step, "ALREADY_EXISTS", `Relation type '${step.key}' already exists`);
          break;
        }
        for (const [end, key] of [["Source", step.source], ["Target", step.target]] as const) {
          if (!known.entityTypes.has(key)) refuse(step, "NOT_FOUND", missing(`${end} entity type '${key}'`));
        }
        // Known from here on even when refused, so later steps are not refused for it too.
        known.relationTypes.set(step.key, new Set());
        break;
      case "add_property": {
        const properties = owned(step);
        if (properties === null) break;
        if (step.relationType !== undefined && step.dataType === "document") {
          refuse(step, "INVALID", "Document properties are only supported on entity types");
        } else if (properties.has(step.key)) {
          refuse(step, "ALREADY_EXISTS", `Property '${step.key}' already exists on this type`);
        }
        properties.add(step.key);
        break;
      }
      case "set_description": {
        const properties = owned(step);
        if (properties !== null && step.property !== undefined && !properties.has(step.property)) {
          refuse(step, "NOT_FOUND", missing(`Property '${step.property}'`));
        }
        break;
      }
    }
  }
  return refusals;
}

/** The result of a check that stopped at the cheap checks. */
function refusedEarly(baseRevision: DesignRevision, refusals: Refusal[]): CheckResult {
  return { ok: false, baseRevision, refusals, ...unchecked(), limits: [NOT_RUN] };
}

// ---------------------------------------------------------------------------
// The full check
// ---------------------------------------------------------------------------

/** What a step adds or describes, for the impact. */
interface Touched {
  kind: TypeKind;
  key: string;
  property?: string;
}

/** A modeling rule's refusal of a step; null for any other error, which aborts. */
function refusalOf(stepId: string, error: unknown): Refusal | null {
  if (error instanceof CascadeRequiredError) {
    return {
      stepId, code: "CASCADE_REQUIRED",
      message: `${error.message.replace(/ Use \?cascade=true.*$/, "")} A proposal cannot consent to that: ` +
        "change the step so it needs no cascade, or leave it to the person.",
      details: { affectedLenses: error.affectedLenses, affectedIndices: error.affectedIndices },
    };
  }
  const code = error instanceof NotFoundError ? "NOT_FOUND"
    : error instanceof ValidationError ? "INVALID"
      : error instanceof ConflictError ? ((error.details?.code as string | undefined) ?? "CONFLICT")
        : null;
  if (code === null) return null;
  const { message, details } = error as ConflictError;
  return { stepId, code, message, ...(details === null ? {} : { details }) };
}

/** The id and kind of the type a step names, in the design change. */
async function resolveOwner(s: ModelingStore, step: OwnedStep): Promise<Owner & { id: string }> {
  const owner = ownerOf(step)!;
  const row = owner.kind === "EntityType" ? await s.getEntityTypeByKey(owner.key) : await s.getRelationTypeByKey(owner.key);
  if (!row) throw new NotFoundError(`${typeName(owner.kind)} '${owner.key}' not found`);
  return { ...owner, id: (owner.kind === "EntityType" ? row.entityTypeId : row.relationTypeId) as string };
}

/** Run one step in the design change; records what it created. */
async function runStep(
  s: ModelingStore,
  effects: EffectQueue,
  step: ProposalStep,
  created: Record<string, string>,
): Promise<Touched> {
  const description = "description" in step ? (step.description ?? null) : null;
  switch (step.op) {
    case "create_entity_type": {
      const row = await service.createEntityTypeIn(s, effects, {
        key: step.key, displayName: step.name, description, nameProperty: DEFAULT_NAME_PROPERTY,
      });
      const path = `entityTypes.${step.key}`;
      created[path] = row.entityTypeId as string;
      const name = await s.getPropertyByKey(row.entityTypeId as string, "EntityType", row.nameProperty as string);
      if (name) {
        created[`${path}.properties.${name.key as string}`] = name.propertyId as string;
        // The name property as the step asks for it; the new type holds no data yet.
        const update = {
          ...(step.nameDescription === undefined ? {} : { description: step.nameDescription }),
          ...(step.nameRequired === undefined ? {} : { required: step.nameRequired }),
        };
        if (Object.keys(update).length > 0) {
          await service.updatePropertyIn(s, effects, row.entityTypeId as string, "EntityType", name.propertyId as string, update);
        }
      }
      return { kind: "EntityType", key: step.key };
    }
    case "create_relation_type": {
      const row = await service.createRelationTypeIn(s, {
        key: step.key, displayName: step.name, description,
        sourceEntityTypeKey: step.source, targetEntityTypeKey: step.target,
      });
      created[`relationTypes.${step.key}`] = row.relationTypeId as string;
      return { kind: "RelationType", key: step.key };
    }
    case "add_property": {
      const owner = await resolveOwner(s, step);
      const row = await service.createPropertyIn(s, effects, owner.id, owner.kind, {
        key: step.key, displayName: step.name, description, dataType: step.dataType,
        required: step.required ?? false, defaultValue: step.defaultValue ?? null,
      }, false);
      created[`${owner.path}.properties.${step.key}`] = row.propertyId as string;
      return { kind: owner.kind, key: owner.key, property: step.key };
    }
    case "set_description": {
      const owner = await resolveOwner(s, step);
      if (step.property !== undefined) {
        const property = await s.getPropertyByKey(owner.id, owner.kind, step.property);
        if (!property) throw new NotFoundError(`Property '${step.property}' not found on ${owner.key}`);
        await service.updatePropertyIn(s, effects, owner.id, owner.kind, property.propertyId as string, { description: step.description });
        return { kind: owner.kind, key: owner.key, property: step.property };
      }
      if (owner.kind === "EntityType") {
        await service.updateEntityTypeIn(s, effects, owner.id, { description: step.description });
      } else {
        await service.updateRelationTypeIn(s, owner.id, { description: step.description });
      }
      return { kind: owner.kind, key: owner.key };
    }
  }
}

/** Whether a lens of the full schema shows what a step touched. */
function lensShows(lens: Row, touched: Touched): boolean {
  const entities = lens.entityInclusions as Row[];
  const relations = lens.relationInclusions as Row[];
  if (entities.length === 0 && relations.length === 0) return true;
  const included = (touched.kind === "EntityType" ? entities : relations).find((row) => row.key === touched.key);
  if (included === undefined) return false;
  const allowlist = included.properties as string[] | null;
  return touched.property === undefined || allowlist === null || allowlist.includes(touched.property);
}

/** Each search index's definition by key, as JSON. */
async function indexDefinitions(s: ModelingStore): Promise<Map<string, string>> {
  return new Map((await s.searchIndices().listIndices()).map((index) => [index.key, JSON.stringify(index.definition)]));
}

/** The issues of `after` that `before` does not have. */
function introducedIssues(before: Issue[], after: Issue[]): Issue[] {
  const id = (issue: Issue) => `${issue.path}\n${issue.message}`;
  const seen = new Set(before.map(id));
  return after.filter((issue) => !seen.has(id(issue)));
}

/** Both stages on a store inside the design change `base` started:
 * the check, and the ids of what the steps created. */
async function fullCheck(
  s: ModelingStore,
  effects: EffectQueue,
  proposal: Proposal,
  base: DesignRevision,
): Promise<{ check: CheckResult; created: Record<string, string> }> {
  const schema = await s.getFullSchema();
  const refusals = cheapRefusals(proposal, schema);
  if (refusals.length > 0) return { check: refusedEarly(base, refusals), created: {} };
  const validationBefore = await service.validateAll(s);
  const indicesBefore = await indexDefinitions(s);

  const created: Record<string, string> = {};
  const touched: Touched[] = [];
  for (const step of proposal.steps) {
    try {
      touched.push(await runStep(s, effects, step, created));
    } catch (error) {
      const refusal = refusalOf(step.id, error);
      if (refusal === null) throw error;
      // The change may be unusable after a failed statement: nothing more runs in it.
      return { check: { ok: false, baseRevision: base, refusals: [refusal], ...unchecked(), limits: [...LIMITS, STOPPED] }, created };
    }
  }

  const validationAfter = await service.validateAll(s);
  const introduced = introducedIssues(validationBefore.errors, validationAfter.errors);
  const preExisting = validationAfter.errors.filter((issue) => !introduced.includes(issue));
  const warnings: CheckResult["warnings"] = introducedIssues(validationBefore.warnings, validationAfter.warnings);
  const existing = knownDesign(schema).entityTypes;
  for (const step of proposal.steps) {
    if (step.op === "add_property" && step.entityType !== undefined && existing.has(step.entityType) &&
      step.required === true && step.defaultValue === undefined) {
      warnings.push({
        stepId: step.id,
        message: `Entity type '${step.entityType}' exists already: the entities it stores, if any, get no value ` +
          `for the required property '${step.key}', which has no default.`,
      });
    }
  }

  const final = await s.getFullSchema();
  const lenses = (final.lenses as Row[])
    .filter((lens) => touched.some((item) => lensShows(lens, item)))
    .map((lens) => lens.key as string)
    .sort();
  const indicesAfter = await indexDefinitions(s);
  const indices = [...new Set([...indicesBefore.keys(), ...indicesAfter.keys()])]
    .filter((key) => indicesBefore.get(key) !== indicesAfter.get(key))
    .sort();

  return {
    check: {
      ok: introduced.length === 0, baseRevision: base, refusals: [],
      validation: { introduced, preExisting }, warnings, impact: { lenses, indices }, limits: LIMITS,
    },
    created,
  };
}

// ---------------------------------------------------------------------------
// Check and apply
// ---------------------------------------------------------------------------

/** Check `proposal` against the store's design; writes nothing. */
export async function checkProposal(store: ModelingStore, proposal: Proposal): Promise<CheckResult> {
  const refusals = cheapRefusals(proposal, await store.getFullSchema());
  if (refusals.length > 0) return refusedEarly(await store.searchIndices().designRevision(), refusals);
  // The work the steps queue goes with the rollback.
  return store.changeDesign(
    async (s, base) => (await fullCheck(s, new EffectQueue(), proposal, base)).check,
    { rollback: true },
  );
}

/**
 * Apply `proposal` to the design `expected` names: every step or none.
 * Another revision in force -> `StaleDesignError` (409 DESIGN_CHANGED); a
 * refusal or an introduced validation error -> `ProposalRefusedError`.
 * After the commit, the queued after-commit work runs once on a fresh
 * store of the ontology.
 */
export async function applyProposal(
  ontologyKey: string,
  store: ModelingStore,
  proposal: Proposal,
  expected: DesignRevision,
): Promise<Receipt> {
  // Without the lock first, so a stale proposal never waits for it. Every
  // check of the design runs under the hold, after `expected` is compared:
  // a change committed in between is a stale revision, never a refusal.
  const current = await store.searchIndices().designRevision();
  if (!sameDesign(current, expected)) throw new StaleDesignError(current);

  const effects = new EffectQueue();
  const receipt = await store.changeDesign(async (s, base) => {
    const { check, created } = await fullCheck(s, effects, proposal, base);
    if (!check.ok) throw new ProposalRefusedError(check);
    return { revision: await s.searchIndices().designRevision(), created };
  }, { expected });
  // Best effort, as every design change's after-commit work: the change stands.
  try {
    await effects.run(await getModelingStore(ontologyKey));
  } catch (error) {
    console.warn(`The work after applying a proposal to ontology '${ontologyKey}' failed:`, error);
  }
  return receipt;
}
