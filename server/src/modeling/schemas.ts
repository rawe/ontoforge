/**
 * Zod schemas for the modeling REST surface. Wire shapes mirror the Python
 * reference models (`backend/src/ontoforge_server/modeling/schemas.py`):
 * camelCase field names, internal identifiers exposed by design, nullable
 * optionals serialized as explicit `null`.
 */

import { z } from "zod";

import { DATA_TYPES, KEY_PATTERN } from "../core/schemas.js";

// --- Ontology ---

export const OntologyCreate = z.object({
  key: z.string().regex(KEY_PATTERN),
  name: z.string(),
  description: z.string().nullable().optional(),
});

/** Sparse update; the key is immutable and absent from this surface. */
export const OntologyUpdate = z.object({
  name: z.string().nullable().optional(),
  description: z.string().nullable().optional(),
});

export const OntologyResponse = z.object({
  ontologyId: z.string(),
  key: z.string(),
  name: z.string(),
  description: z.string().nullable(),
  createdAt: z.iso.datetime(),
  updatedAt: z.iso.datetime(),
});

// --- Scope Management ---

/** Adding an inclusion names the type by KEY in the body. */
export const IncludeTypeRequest = z.object({
  key: z.string(),
  // Absent (or explicit null) means "all properties" — not the same as [].
  properties: z.array(z.string()).nullable().optional(),
});

export const IncludeTypeUpdate = z.object({
  properties: z.array(z.string()).nullable().optional(),
});

export const IncludeTypeResponse = z.object({
  key: z.string(),
  properties: z.array(z.string()).nullable(),
});

// --- Validation ---

export const SchemaValidationErrorItem = z.object({
  path: z.string(),
  message: z.string(),
});

export const ValidationResult = z.object({
  valid: z.boolean(),
  errors: z.array(SchemaValidationErrorItem),
});

// --- Entity Type ---

export const EntityTypeCreate = z.object({
  key: z.string().regex(KEY_PATTERN),
  displayName: z.string(),
  description: z.string().nullable().optional(),
});

export const EntityTypeUpdate = z.object({
  displayName: z.string().nullable().optional(),
  description: z.string().nullable().optional(),
});

export const EntityTypeResponse = z.object({
  entityTypeId: z.string(),
  key: z.string(),
  displayName: z.string(),
  description: z.string().nullable(),
  createdAt: z.iso.datetime(),
  updatedAt: z.iso.datetime(),
});

// --- Relation Type ---

export const RelationTypeCreate = z.object({
  key: z.string().regex(KEY_PATTERN),
  displayName: z.string(),
  description: z.string().nullable().optional(),
  sourceEntityTypeKey: z.string(),
  targetEntityTypeKey: z.string(),
});

export const RelationTypeUpdate = z.object({
  displayName: z.string().nullable().optional(),
  description: z.string().nullable().optional(),
});

export const RelationTypeResponse = z.object({
  relationTypeId: z.string(),
  key: z.string(),
  displayName: z.string(),
  description: z.string().nullable(),
  sourceEntityTypeKey: z.string(),
  targetEntityTypeKey: z.string(),
  createdAt: z.iso.datetime(),
  updatedAt: z.iso.datetime(),
});

// --- Property Definition ---

export const PropertyDefinitionCreate = z.object({
  key: z.string().regex(KEY_PATTERN),
  displayName: z.string(),
  description: z.string().nullable().optional(),
  dataType: z.enum(DATA_TYPES),
  required: z.boolean().default(false),
  // Defaults are stored as strings and NOT validated against the data type
  // at definition time — a bad default is legal to store.
  defaultValue: z.string().nullable().optional(),
});

/**
 * Sparse update: an omitted field is left unchanged, so a description can
 * never be cleared. `defaultValue` is the single exception — an explicit
 * `null` clears the default (see the service's clear-default handling).
 */
export const PropertyDefinitionUpdate = z.object({
  displayName: z.string().nullable().optional(),
  description: z.string().nullable().optional(),
  required: z.boolean().nullable().optional(),
  defaultValue: z.string().nullable().optional(),
});

export const PropertyDefinitionResponse = z.object({
  propertyId: z.string(),
  key: z.string(),
  displayName: z.string(),
  description: z.string().nullable(),
  dataType: z.string(),
  required: z.boolean(),
  defaultValue: z.string().nullable(),
  createdAt: z.iso.datetime(),
  updatedAt: z.iso.datetime(),
});

// --- AI Agent Config ---

/**
 * Agent and saved-query keys: hyphens allowed, unlike type and property
 * keys. Kept as a STRING so validation-error messages can carry the exact
 * pattern text the Python reference interpolates.
 */
export const AGENT_KEY_PATTERN = "^[a-z][a-z0-9_-]*$";

export const AiAgentConfigUpsert = z.object({
  name: z.string(),
  description: z.string().nullable().optional(),
  systemPrompt: z.string().nullable().optional(),
  tools: z.array(z.string()).nullable().optional(),
});

export const AiAgentConfigResponse = z.object({
  key: z.string(),
  name: z.string(),
  description: z.string().nullable(),
  systemPrompt: z.string().nullable(),
  tools: z.array(z.string()).nullable(),
  createdAt: z.iso.datetime(),
  updatedAt: z.iso.datetime(),
});

// --- Saved Query Config ---

export const STEP_NAME_PATTERN = /^[a-zA-Z_]\w*$/;

/** One saved-query step. `oql` steps carry the query text in `oql`;
 * `semantic_search` steps carry their search text in `query`. */
export const StepSchema = z.object({
  name: z.string().regex(STEP_NAME_PATTERN),
  type: z.enum(["oql", "semantic_search"]),
  oql: z.string().nullable().optional(),
  entityTypeKey: z.string().nullable().optional(),
  query: z.string().nullable().optional(),
  limit: z.number().int().min(1).max(100).nullable().optional(),
  minScore: z.number().min(0).max(1).nullable().optional(),
  bindings: z.record(z.string(), z.string()).nullable().optional(),
});

export const SavedQueryParameterSchema = z.object({
  name: z.string().regex(STEP_NAME_PATTERN),
  description: z.string(),
  dataType: z.enum(DATA_TYPES),
});

export const SavedQueryUpsert = z.object({
  name: z.string(),
  description: z.string(),
  steps: z.array(StepSchema).min(1),
  parameters: z.array(SavedQueryParameterSchema).default([]),
});

/** Response steps carry every field, absent ones as explicit null —
 * matching the Python response model's serialization. */
export const StepResponse = z.object({
  name: z.string(),
  type: z.string(),
  oql: z.string().nullable(),
  entityTypeKey: z.string().nullable(),
  query: z.string().nullable(),
  limit: z.number().nullable(),
  minScore: z.number().nullable(),
  bindings: z.record(z.string(), z.string()).nullable(),
});

export const SavedQueryResponse = z.object({
  key: z.string(),
  name: z.string(),
  description: z.string(),
  steps: z.array(StepResponse),
  parameters: z.array(SavedQueryParameterSchema),
  createdAt: z.iso.datetime(),
  updatedAt: z.iso.datetime(),
});

export type OntologyCreateInput = z.infer<typeof OntologyCreate>;
export type OntologyUpdateInput = z.infer<typeof OntologyUpdate>;
export type OntologyResponseBody = z.infer<typeof OntologyResponse>;
export type IncludeTypeRequestInput = z.infer<typeof IncludeTypeRequest>;
export type IncludeTypeUpdateInput = z.infer<typeof IncludeTypeUpdate>;
export type IncludeTypeResponseBody = z.infer<typeof IncludeTypeResponse>;
export type ValidationResultBody = z.infer<typeof ValidationResult>;
export type EntityTypeCreateInput = z.infer<typeof EntityTypeCreate>;
export type EntityTypeUpdateInput = z.infer<typeof EntityTypeUpdate>;
export type EntityTypeResponseBody = z.infer<typeof EntityTypeResponse>;
export type RelationTypeCreateInput = z.infer<typeof RelationTypeCreate>;
export type RelationTypeUpdateInput = z.infer<typeof RelationTypeUpdate>;
export type RelationTypeResponseBody = z.infer<typeof RelationTypeResponse>;
export type PropertyDefinitionCreateInput = z.infer<typeof PropertyDefinitionCreate>;
export type PropertyDefinitionUpdateInput = z.infer<typeof PropertyDefinitionUpdate>;
export type PropertyDefinitionResponseBody = z.infer<typeof PropertyDefinitionResponse>;
export type AiAgentConfigUpsertInput = z.infer<typeof AiAgentConfigUpsert>;
export type AiAgentConfigResponseBody = z.infer<typeof AiAgentConfigResponse>;
export type StepInput = z.infer<typeof StepSchema>;
export type SavedQueryParameterInput = z.infer<typeof SavedQueryParameterSchema>;
export type SavedQueryUpsertInput = z.infer<typeof SavedQueryUpsert>;
export type StepResponseBody = z.infer<typeof StepResponse>;
export type SavedQueryResponseBody = z.infer<typeof SavedQueryResponse>;
