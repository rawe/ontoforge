/**
 * Zod schemas for the modeling REST surface: camelCase field names,
 * internal identifiers exposed by design, nullable optionals serialized as
 * explicit `null`.
 */

import { KeywordLanguage, KeywordLanguageSetSchema } from "../core/keywordLanguage.js";

import { z } from "zod";

import { DATA_TYPES, DEFAULT_NAME_PROPERTY, SCHEMA_KEY_PATTERN, MAX_KEY_LENGTH } from "../core/schemas.js";
import { SearchIndexDefinition } from "../core/searchIndex.js";

// --- Lens ---

export const LensCreate = z.object({
  key: z.string().regex(SCHEMA_KEY_PATTERN).max(MAX_KEY_LENGTH),
  name: z.string(),
  description: z.string().nullable().optional(),
});

/** Sparse update; the key is immutable and absent from this surface. */
export const LensUpdate = z.object({
  name: z.string().nullable().optional(),
  description: z.string().nullable().optional(),
});

export const LensResponse = z.object({
  lensId: z.string(),
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

/** A search-index inclusion names the index by key — request and
 * response alike. */
export const IncludeSearchIndex = z.object({
  key: z.string(),
});

// --- Validation ---

export const SchemaValidationErrorItem = z.object({
  path: z.string(),
  message: z.string(),
});

// Warnings never make a result invalid (lens validation: D3).
export const ValidationResult = z.object({
  valid: z.boolean(),
  errors: z.array(SchemaValidationErrorItem),
  warnings: z.array(SchemaValidationErrorItem),
});

// --- Entity Type ---

/** Creating an entity type creates its name property too: a non-required
 * `string` property under `nameProperty` (default `name`). */
export const EntityTypeCreate = z.object({
  key: z.string().regex(SCHEMA_KEY_PATTERN).max(MAX_KEY_LENGTH),
  displayName: z.string(),
  description: z.string().nullable().optional(),
  nameProperty: z.string().regex(SCHEMA_KEY_PATTERN).max(MAX_KEY_LENGTH).default(DEFAULT_NAME_PROPERTY),
});

/** `nameProperty` reassigns the name property to another `string` property
 * of the type. */
export const EntityTypeUpdate = z.object({
  displayName: z.string().nullable().optional(),
  description: z.string().nullable().optional(),
  nameProperty: z.string().nullable().optional(),
});

export const EntityTypeResponse = z.object({
  entityTypeId: z.string(),
  key: z.string(),
  displayName: z.string(),
  description: z.string().nullable(),
  /** Key of the type's name property — never null. */
  nameProperty: z.string(),
  createdAt: z.iso.datetime(),
  updatedAt: z.iso.datetime(),
});

// --- Relation Type ---

export const RelationTypeCreate = z.object({
  key: z.string().regex(SCHEMA_KEY_PATTERN).max(MAX_KEY_LENGTH),
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
  key: z.string().regex(SCHEMA_KEY_PATTERN).max(MAX_KEY_LENGTH),
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

// --- Agent Config ---

export const AgentConfigUpsert = z.object({
  name: z.string(),
  description: z.string().nullable().optional(),
  systemPrompt: z.string().nullable().optional(),
  tools: z.array(z.string()).nullable().optional(),
});

export const AgentConfigResponse = z.object({
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
 * `search` steps carry their search text in `query`. */
export const StepSchema = z.object({
  name: z.string().regex(STEP_NAME_PATTERN),
  type: z.enum(["oql", "search"]),
  oql: z.string().nullable().optional(),
  entityTypeKey: z.string().nullable().optional(),
  query: z.string().nullable().optional(),
  limit: z.number().int().min(1).max(100).nullable().optional(),
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

/** Response steps carry every field, absent ones as explicit null. */
export const StepResponse = z.object({
  name: z.string(),
  type: z.string(),
  oql: z.string().nullable(),
  entityTypeKey: z.string().nullable(),
  query: z.string().nullable(),
  limit: z.number().nullable(),
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

// --- Transfer format (export / import) ---
// These field names ARE the interchange format — renaming one invalidates
// every payload already written. Keys are unconstrained strings at parse
// time: import validates them itself so every offending key is COLLECTED
// and reported in one response instead of failing at the request shape.
// Data types are deliberately NOT checked against the enum
// (`docs/capabilities/transfer.md`) — the schema-validation operation is
// what catches those later.

/** Current transfer format version — what export writes and the only one
 * import reads; older versions reach it through the upgrade chain
 * (`modeling/transfer/upgrades.ts`). */
export const TRANSFER_FORMAT_VERSION = "7.0";

/** What import accepts as the request shape: an object with an optional
 * version string. The rest belongs to the version — its upgrader, then
 * import, check it (`ExportPayload`). */
export const TransferEnvelope = z.looseObject({
  formatVersion: z.string().optional(),
});

export const ExportProperty = z.object({
  key: z.string(),
  displayName: z.string(),
  description: z.string().nullable().optional(),
  dataType: z.string(),
  required: z.boolean(),
  defaultValue: z.string().nullable().optional(),
});

export const ExportEntityType = z.object({
  key: z.string(),
  displayName: z.string(),
  description: z.string().nullable().optional(),
  // Required — import checks it itself, collecting a missing one with the
  // other rule violations.
  nameProperty: z.string().optional(),
  properties: z.array(ExportProperty).default([]),
});

export const ExportRelationType = z.object({
  key: z.string(),
  displayName: z.string(),
  description: z.string().nullable().optional(),
  fromEntityTypeKey: z.string(),
  toEntityTypeKey: z.string(),
  properties: z.array(ExportProperty).default([]),
});

export const ExportLensInclusion = z.object({
  key: z.string(),
  properties: z.array(z.string()).nullable().optional(),
});

export const ExportLensInclusions = z.object({
  entityTypes: z.array(ExportLensInclusion).default([]),
  relationTypes: z.array(ExportLensInclusion).default([]),
});

export const ExportAgent = z.object({
  key: z.string(),
  name: z.string(),
  description: z.string().nullable().optional(),
  systemPrompt: z.string().nullable().optional(),
  tools: z.array(z.string()).nullable().optional(),
});

export const ExportSavedQueryParameter = z.object({
  name: z.string(),
  description: z.string(),
  dataType: z.string(),
});

/** Saved-query step in the transfer format — laxer than the definition-time
 * `StepSchema` (any name, any type, any limit): import re-checks each step
 * against the definition-time rules itself, collecting the failures. */
export const ExportSavedQueryStep = z.object({
  name: z.string(),
  type: StepSchema.shape.type,
  oql: z.string().nullable().optional(),
  entityTypeKey: z.string().nullable().optional(),
  query: z.string().nullable().optional(),
  limit: z.number().int().nullable().optional(),
  bindings: z.record(z.string(), z.string()).nullable().optional(),
});

export const ExportSavedQuery = z.object({
  key: z.string(),
  name: z.string(),
  description: z.string(),
  steps: z.array(ExportSavedQueryStep),
  parameters: z.array(ExportSavedQueryParameter).default([]),
});

/** One retriever in its portable form — also the single-agent
 * export. Kept as stored: a version this release cannot run travels too. */
export const ExportRetriever = z.object({
  key: z.string(),
  name: z.string(),
  description: z.string().nullable(),
  configVersion: z.number(),
  config: z.unknown(),
});
export type ExportRetrieverInput = z.infer<typeof ExportRetriever>;

/** A lens's assistants, one list per kind; each entry in its portable form. */
export const ExportAssistants = z.object({
  agents: z.array(ExportAgent).default([]),
  retrievers: z.array(ExportRetriever).default([]),
});

export const ExportLens = z.object({
  key: z.string(),
  name: z.string(),
  description: z.string().nullable().optional(),
  includes: ExportLensInclusions.nullable().optional(),
  // The keys of the indices the lens includes. Absent: the lens includes
  // the managed indices of the types it exposes, as a lens upgraded by
  // the storage step does.
  indexInclusions: z.array(z.string()).optional(),
  assistants: ExportAssistants.default({ agents: [], retrievers: [] }),
  savedQueries: z.array(ExportSavedQuery).default([]),
});

/** The transfer format's search indices: the custom definitions and the
 * managed indices switched off (managed definitions are derived from the
 * schema, so only their switches travel). */
export const ExportSearchIndices = z.object({
  custom: z.array(SearchIndexDefinition).default([]),
  disabled: z.array(z.string()).default([]),
});

/** The current version's payload, as import reads it once the upgrade
 * chain has brought it here. The keyword language set is required; import
 * reports its absence as a field error before this shape. */
export const ExportPayload = z.object({
  keywordLanguages: KeywordLanguageSetSchema,
  // Absent: no custom index, every managed index on.
  searchIndices: ExportSearchIndices.optional(),
  entityTypes: z.array(ExportEntityType).default([]),
  relationTypes: z.array(ExportRelationType).default([]),
  // Required, no default: a document without lenses (a pre-4.0
  // `ontologies[]` one) is no transfer payload.
  lenses: z.array(ExportLens),
});

// --- Search settings ---

export const SearchSettingsResponse = z.object({
  keywordLanguages: z.array(KeywordLanguage),
  /** The managed indices switched off, in key order. */
  disabledIndices: z.array(z.string()),
});

/** Either field may be absent; an absent one stays as it is. */
export const SearchSettingsUpdate = z.object({
  keywordLanguages: KeywordLanguageSetSchema.optional(),
  disabledIndices: z.array(z.string()).optional(),
});

// --- Search indices ---
// Definitions travel in the index wire format (`core/searchIndex.ts`).
// Request bodies are parsed by the service, so a malformed draft reports
// its issues by dotted path like every other definition issue; responses
// carry managed keys (`person~default`), which no key pattern admits.

/** A definition as the service parses it — any JSON object. */
export const SearchIndexBody = z.record(z.string(), z.unknown());

const RepresentationSchema = z.enum(["semantic", "keyword"]);

export const SearchIndexDefinitionResponse = z.object({
  key: z.string(),
  name: z.string(),
  description: z.string(),
  entityType: z.string(),
  fields: z.array(z.string()),
  header: z.array(z.string()).nullable(),
  relations: z.array(
    z.object({
      relationType: z.string(),
      direction: z.enum(["outgoing", "incoming"]),
      fields: z.array(z.string()),
      target: z.record(z.string(), z.array(z.string())),
      label: z.string().nullable(),
      template: z.string().nullable(),
    }),
  ),
  semantic: z.object({ enabled: z.boolean(), template: z.string().nullable() }),
  keyword: z.object({ enabled: z.boolean() }),
});

export const IndexStatusResponse = z.object({
  state: z.enum(["ready", "building", "stale", "failed", "disabled", "unavailable"]),
  representations: z.array(
    z.object({
      representation: RepresentationSchema,
      state: z.enum(["ready", "building", "stale", "failed", "unavailable"]),
      done: z.number().int(),
      total: z.number().int(),
      pending: z.number().int(),
      failed: z.number().int(),
    }),
  ),
  lastErrors: z.array(
    z.object({
      entityId: z.string(),
      partKind: z.string(),
      message: z.string(),
      at: z.iso.datetime(),
    }),
  ),
});

export const SearchIndexResponse = z.object({
  key: z.string(),
  kind: z.enum(["default", "passage", "custom"]),
  /** Custom indices always; managed ones unless switched off. */
  enabled: z.boolean(),
  definition: SearchIndexDefinitionResponse,
  documentProperty: z.string().nullable(),
  status: IndexStatusResponse,
  createdAt: z.iso.datetime(),
  updatedAt: z.iso.datetime(),
});

export const CostEstimateResponse = z.object({
  entities: z.number().int(),
  entries: z.number().int(),
  seconds: z.number(),
  perRepresentation: z.array(
    z.object({
      representation: RepresentationSchema,
      entries: z.number().int(),
      seconds: z.number(),
      measured: z.boolean(),
    }),
  ),
});

export const OutlinePartResponse = z.object({
  partKind: z.enum(["self", "relation", "passage"]),
  groupNo: z.number().int().nullable(),
  relationType: z.string().nullable(),
  direction: z.enum(["outgoing", "incoming"]).nullable(),
  targetType: z.string().nullable(),
  keywordText: z.string(),
  semanticText: z.string(),
  template: z.enum(["none", "rendered", "fallback"]),
  unresolved: z.array(z.string()),
});

export const SearchIndexPreviewResponse = z.object({
  valid: z.boolean(),
  issues: z.array(SchemaValidationErrorItem),
  estimate: CostEstimateResponse.nullable(),
  /** The entries per entity, composed from the schema; null when the
   * parts it reads — all but key, name and description — are not
   * well-shaped. */
  outline: z.array(OutlinePartResponse).nullable(),
});

export type LensCreateInput = z.infer<typeof LensCreate>;
export type LensUpdateInput = z.infer<typeof LensUpdate>;
export type LensResponseBody = z.infer<typeof LensResponse>;
export type IncludeTypeRequestInput = z.infer<typeof IncludeTypeRequest>;
export type IncludeTypeUpdateInput = z.infer<typeof IncludeTypeUpdate>;
export type IncludeTypeResponseBody = z.infer<typeof IncludeTypeResponse>;
export type IncludeSearchIndexBody = z.infer<typeof IncludeSearchIndex>;
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
export type AgentConfigUpsertInput = z.infer<typeof AgentConfigUpsert>;
export type AgentConfigResponseBody = z.infer<typeof AgentConfigResponse>;
export type StepInput = z.infer<typeof StepSchema>;
export type SavedQueryParameterInput = z.infer<typeof SavedQueryParameterSchema>;
export type SavedQueryUpsertInput = z.infer<typeof SavedQueryUpsert>;
export type StepResponseBody = z.infer<typeof StepResponse>;
export type SavedQueryResponseBody = z.infer<typeof SavedQueryResponse>;
export type ExportPayloadInput = z.infer<typeof ExportPayload>;
export type SearchSettingsUpdateInput = z.infer<typeof SearchSettingsUpdate>;
export type SearchSettingsResponseBody = z.infer<typeof SearchSettingsResponse>;
export type SearchIndexResponseBody = z.infer<typeof SearchIndexResponse>;
export type IndexStatusResponseBody = z.infer<typeof IndexStatusResponse>;
export type SearchIndexPreviewResponseBody = z.infer<typeof SearchIndexPreviewResponse>;
export type ExportSearchIndicesInput = z.infer<typeof ExportSearchIndices>;
export type ExportEntityTypeInput = z.infer<typeof ExportEntityType>;
export type ExportPropertyInput = z.infer<typeof ExportProperty>;
export type ExportRelationTypeInput = z.infer<typeof ExportRelationType>;
export type ExportLensInput = z.infer<typeof ExportLens>;
export type ExportSavedQueryInput = z.infer<typeof ExportSavedQuery>;
export type ExportSavedQueryStepInput = z.infer<typeof ExportSavedQueryStep>;
