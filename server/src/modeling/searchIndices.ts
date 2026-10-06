/**
 * Search indices in modeling: the custom-index CRUD, the draft preview
 * with its cost estimate, status and rebuild, the cascade a schema
 * removal applies to custom indices, and the indices' part of the
 * transfer format. REST and MCP call these same functions.
 *
 * Managed indices (default, passage) are listed beside the custom ones
 * but never written here — they follow the schema
 * (`runtime/indexing/managed.ts`) and are only switched (search
 * settings). Every write reconciles the generations, so a new or changed
 * definition gets new generations that the worker builds.
 *
 * Definitions are parsed here, not by the routes: a malformed draft
 * reports its issues by dotted path (`relations.0.fields.1`) exactly like
 * an issue of the definition against the schema.
 */

import { randomUUID } from "node:crypto";

import { settings } from "../config.js";
import { getEmbeddingProvider } from "../core/embedding.js";
import {
  CascadeRequiredError,
  ConflictError,
  NotFoundError,
  ValidationError,
} from "../core/exceptions.js";
import type {
  ModelingStore,
  SearchIndexRecord,
  SearchIndexStore,
  SearchQueueError,
} from "../core/ports.js";
import { documentField, ownTextFields } from "../core/searchComposition.js";
import {
  cascadeIndexKeys,
  deriveManagedIndices,
  isManagedIndexKey,
  planSearchIndexCascade,
  SearchIndexDefinition,
  validateSearchIndex,
  type SchemaRemoval,
  type SearchIndexCascade,
  type SearchIndexIssue,
  type SearchIndexSchema,
  type SearchRepresentation,
} from "../core/searchIndex.js";
import {
  disabledDefaultsOf,
  disabledIndexKeys,
  estimateBuildCost,
  type CostEstimate,
  type SearchIndexStatus,
} from "../core/searchPipeline.js";
import { lensIndexFindings } from "../core/searchQuery.js";
import { rebuildSearchIndex as rebuildGenerations, reconcileSearchGenerations } from "../runtime/indexing/generations.js";
import { getSearchIndexStatus, listSearchIndexStatuses } from "../runtime/indexing/status.js";
import { searchEntryRates } from "../runtime/indexing/worker.js";
import { invalidateLoadedSchemaCache, loadSearchContextUncached } from "../runtime/schemaCache.js";
import type {
  ExportSearchIndicesInput,
  IncludeSearchIndexBody,
  IndexStatusResponseBody,
  SearchIndexPreviewResponseBody,
  SearchIndexResponseBody,
} from "./schemas.js";

/** The key a draft without one is validated under. */
const DRAFT_KEY = "draft";

/** The search-index store of the ontology; an adapter without search
 * indices answers `FEATURE_DISABLED`. */
export function requireSearchIndices(store: ModelingStore): SearchIndexStore {
  const indices = store.searchIndices?.();
  if (indices === undefined) {
    throw new ValidationError("Search indices are not supported by this storage adapter", {
      code: "FEATURE_DISABLED",
    });
  }
  return indices;
}

// ---------------------------------------------------------------------------
// Response shapes
// ---------------------------------------------------------------------------

function toStatusBody(status: SearchIndexStatus): IndexStatusResponseBody {
  return {
    state: status.state,
    representations: status.representations
      .filter((r) => r.state !== "disabled")
      .map((r) => ({
        representation: r.representation,
        state: r.state as Exclude<typeof r.state, "disabled">,
        done: r.done,
        total: r.total,
        pending: r.pending,
        failed: r.failed,
      })),
    lastErrors: status.lastErrors.map((error: SearchQueueError) => ({
      entityId: error.entityId,
      partKind: error.partKind,
      message: error.message,
      at: error.at.toISOString(),
    })),
  };
}

function toRecordBody(
  index: SearchIndexRecord,
  schema: SearchIndexSchema,
  status: SearchIndexStatus,
  disabled: ReadonlySet<string>,
): SearchIndexResponseBody {
  return {
    key: index.key,
    kind: index.kind,
    enabled: index.kind === "custom" || !disabled.has(index.key),
    definition: { ...index.definition, key: index.key },
    documentProperty: documentField(index.definition, schema),
    status: toStatusBody(status),
    createdAt: index.createdAt.toISOString(),
    updatedAt: index.updatedAt.toISOString(),
  };
}

// ---------------------------------------------------------------------------
// Reads
// ---------------------------------------------------------------------------

/** Every index, managed and custom, in key order — switched-off managed
 * ones included (`enabled: false`) — each with its status. */
export async function listSearchIndices(store: ModelingStore): Promise<SearchIndexResponseBody[]> {
  const indices = requireSearchIndices(store);
  const [{ schema, indices: records }, statuses, searchSettings] = await Promise.all([
    loadSearchContextUncached(indices),
    listSearchIndexStatuses(indices.ontologyKey),
    indices.getSearchSettings(),
  ]);
  const disabled = disabledIndexKeys(searchSettings);
  const statusOf = new Map(statuses.map((status) => [status.key, status] as const));
  return records
    .filter((index) => statusOf.has(index.key))
    .map((index) => toRecordBody(index, schema, statusOf.get(index.key)!, disabled));
}

/** One index with its status. Unknown key -> not found. */
export async function getSearchIndex(
  key: string,
  store: ModelingStore,
): Promise<SearchIndexResponseBody> {
  const indices = requireSearchIndices(store);
  const index = await indices.getIndex(key);
  if (index === null) {
    throw new NotFoundError(`Search index '${key}' not found`);
  }
  const [{ schema }, status, searchSettings] = await Promise.all([
    loadSearchContextUncached(indices),
    getSearchIndexStatus(indices.ontologyKey, key),
    indices.getSearchSettings(),
  ]);
  return toRecordBody(index, schema, status, disabledIndexKeys(searchSettings));
}

/** The build status of one index. Unknown key -> not found. */
export async function getSearchIndexStatusBody(
  key: string,
  store: ModelingStore,
): Promise<IndexStatusResponseBody> {
  const indices = requireSearchIndices(store);
  return toStatusBody(await getSearchIndexStatus(indices.ontologyKey, key));
}

// ---------------------------------------------------------------------------
// Parsing and validation
// ---------------------------------------------------------------------------

type ParsedDraft =
  | { ok: true; definition: SearchIndexDefinition }
  | { ok: false; issues: SearchIndexIssue[] };

/** Parse a definition; a key with `~` is reserved for managed indices. */
function parseDefinition(body: unknown): ParsedDraft {
  const key = (body as { key?: unknown } | null)?.key;
  if (typeof key === "string" && isManagedIndexKey(key)) {
    return {
      ok: false,
      issues: [{ path: "key", message: "Keys with '~' are reserved for managed search indices" }],
    };
  }
  const parsed = SearchIndexDefinition.safeParse(body);
  if (parsed.success) return { ok: true, definition: parsed.data };
  return {
    ok: false,
    issues: parsed.error.issues.map((issue) => ({
      path: issue.path.map(String).join(".") || "definition",
      message: issue.message,
    })),
  };
}

/** Issues keyed by path, the `details.fields` of a 422. */
function invalid(issues: SearchIndexIssue[]): ValidationError {
  const fields: Record<string, string> = {};
  for (const { path, message } of issues) {
    fields[path] = fields[path] === undefined ? message : `${fields[path]}; ${message}`;
  }
  return new ValidationError("Invalid search index definition", { fields });
}

/** A parsed, schema-valid definition — or the 422 naming every issue. */
async function validDefinition(
  indices: SearchIndexStore,
  body: unknown,
): Promise<{ definition: SearchIndexDefinition; schema: SearchIndexSchema }> {
  const parsed = parseDefinition(body);
  if (!parsed.ok) throw invalid(parsed.issues);
  const { schema } = await loadSearchContextUncached(indices);
  const issues = validateSearchIndex(parsed.definition, schema);
  if (issues.length > 0) throw invalid(issues);
  return { definition: parsed.definition, schema };
}

// ---------------------------------------------------------------------------
// Preview
// ---------------------------------------------------------------------------

/**
 * Validate a draft and estimate a full build of it — never a 422 for an
 * invalid draft: its issues come back with no estimate. A draft may come
 * without a key (a new index). The estimate is always the cost of a full
 * build: a changed definition gets a new generation that rebuilds
 * everything.
 */
export async function previewSearchIndex(
  body: Record<string, unknown>,
  store: ModelingStore,
): Promise<SearchIndexPreviewResponseBody> {
  const indices = requireSearchIndices(store);
  const parsed = parseDefinition(body.key === undefined ? { ...body, key: DRAFT_KEY } : body);
  if (!parsed.ok) return { valid: false, issues: parsed.issues, estimate: null };
  const { schema } = await loadSearchContextUncached(indices);
  const issues = validateSearchIndex(parsed.definition, schema);
  if (issues.length > 0) return { valid: false, issues, estimate: null };
  return { valid: true, issues: [], estimate: await estimateCost(indices, parsed.definition, schema) };
}

/** The cost of a full build of a valid definition, at the worker's
 * measured throughput (or the default rates). Semantic entries count
 * only with an embedding provider — without one they are never built. */
async function estimateCost(
  indices: SearchIndexStore,
  definition: SearchIndexDefinition,
  schema: SearchIndexSchema,
): Promise<CostEstimate> {
  const documentProperty = documentField(definition, schema);
  const size = await indices.measureIndexContent({
    entityType: definition.entityType,
    selfEntries: ownTextFields(definition, schema).length > 0,
    passages:
      documentProperty === null
        ? null
        : {
            property: documentProperty,
            chunkSize: settings.DOCUMENT_CHUNK_SIZE,
            chunkOverlap: settings.DOCUMENT_CHUNK_OVERLAP,
          },
    groups: definition.relations.map((group) => ({
      relationType: group.relationType,
      owner: group.direction === "outgoing" ? "from" : "to",
      targetTypes: Object.keys(group.target).length > 0 ? Object.keys(group.target) : null,
    })),
  });
  const representations = (["keyword", "semantic"] as const).filter(
    (rep: SearchRepresentation) =>
      definition[rep].enabled && (rep === "keyword" || getEmbeddingProvider() !== null),
  );
  const rates = searchEntryRates();
  return estimateBuildCost(size, representations, {
    keyword: rates.keyword,
    semantic: rates.semantic,
  });
}

// ---------------------------------------------------------------------------
// Writes
// ---------------------------------------------------------------------------

/** After a change of the definitions: forget the cached schema views and
 * bring the generations in step (a new or changed definition builds). */
async function afterIndexChange(indices: SearchIndexStore): Promise<void> {
  invalidateLoadedSchemaCache();
  await reconcileSearchGenerations(indices.ontologyKey);
}

/**
 * Create a custom index. Invalid -> 422 with `details.fields` by dotted
 * path (a `~` key included: managed keys are reserved); a taken key ->
 * conflict. Its generations start building at once.
 */
export async function createSearchIndex(
  body: Record<string, unknown>,
  store: ModelingStore,
): Promise<SearchIndexResponseBody> {
  const indices = requireSearchIndices(store);
  const { definition } = await validDefinition(indices, body);
  if ((await indices.getIndex(definition.key)) !== null) {
    throw new ConflictError(`Search index with key '${definition.key}' already exists`);
  }
  await indices.createIndex(randomUUID(), "custom", definition);
  await afterIndexChange(indices);
  return getSearchIndex(definition.key, store);
}

/** The custom index under a key: not found, or a conflict for a managed
 * index — those follow the schema and are only switched. */
async function customIndex(indices: SearchIndexStore, key: string): Promise<SearchIndexRecord> {
  const index = await indices.getIndex(key);
  if (index === null) {
    throw new NotFoundError(`Search index '${key}' not found`);
  }
  if (index.kind !== "custom") {
    throw new ConflictError(
      `Search index '${key}' is managed: managed indices can only be switched (search settings)`,
    );
  }
  return index;
}

/**
 * Replace a custom index's definition. The body's key must be the path's
 * (absent: taken from the path). A changed definition gets new
 * generations; the current ones serve until those are built.
 */
export async function updateSearchIndex(
  key: string,
  body: Record<string, unknown>,
  store: ModelingStore,
): Promise<SearchIndexResponseBody> {
  const indices = requireSearchIndices(store);
  await customIndex(indices, key);
  if (body.key !== undefined && body.key !== key) {
    throw invalid([{ path: "key", message: `Must be the index's key '${key}'` }]);
  }
  const { definition } = await validDefinition(indices, { ...body, key });
  await indices.updateIndexDefinition(key, definition);
  await afterIndexChange(indices);
  return getSearchIndex(key, store);
}

/**
 * Delete a custom index with its generations and entries. Included by a
 * lens and no cascade -> `CASCADE_REQUIRED` naming the lenses; with
 * cascade the inclusions go with it.
 */
export async function deleteSearchIndex(
  key: string,
  cascade: boolean,
  store: ModelingStore,
): Promise<void> {
  const indices = requireSearchIndices(store);
  await customIndex(indices, key);
  const lenses = await indices.findLensesIncludingIndex(key);
  if (lenses.length > 0 && !cascade) {
    throw new CascadeRequiredError(
      `Search index is included by ${lenses.length} lens(es).`,
      lenses,
      [],
    );
  }
  await indices.deleteIndex(key);
  await afterIndexChange(indices);
}

/** Force new generations of an index and answer its status (the build
 * runs in the background). A switched-off managed index -> conflict. */
export async function rebuildSearchIndex(
  key: string,
  store: ModelingStore,
): Promise<IndexStatusResponseBody> {
  const indices = requireSearchIndices(store);
  await rebuildGenerations(indices.ontologyKey, key);
  return getSearchIndexStatusBody(key, store);
}

// ---------------------------------------------------------------------------
// Lens inclusions
// ---------------------------------------------------------------------------

/** The lens under an id; unknown -> not found. */
async function existingLens(store: ModelingStore, lensId: string): Promise<void> {
  if ((await store.getLens(lensId)) === null) {
    throw new NotFoundError(`Lens '${lensId}' not found`);
  }
}

/** The indices a lens includes, by key in key order. */
export async function listLensIndexInclusions(
  lensId: string,
  store: ModelingStore,
): Promise<IncludeSearchIndexBody[]> {
  const indices = requireSearchIndices(store);
  await existingLens(store, lensId);
  return (await indices.listLensIndexInclusions(lensId)).map((key) => ({ key }));
}

/**
 * Include an index in a lens. A scoped lens must expose the index's root
 * type — include it, or, with relation inclusions only, expose every
 * type — else 422. An unscoped lens searches every index anyway; the
 * inclusion is kept and counts once the lens is scoped. Index inclusions
 * never make a lens scoped. Unknown index -> not found; already
 * included -> conflict.
 */
export async function includeIndexInLens(
  lensId: string,
  body: IncludeSearchIndexBody,
  store: ModelingStore,
): Promise<IncludeSearchIndexBody> {
  const indices = requireSearchIndices(store);
  await existingLens(store, lensId);
  const index = await indices.getIndex(body.key);
  if (index === null) {
    throw new NotFoundError(`Search index '${body.key}' not found`);
  }
  const root = index.definition.entityType;
  const entityInclusions = await store.listIncludesTypes(lensId, "EntityType");
  if (entityInclusions.length > 0 && !entityInclusions.some((inc) => inc.key === root)) {
    throw new ValidationError(
      `Root entity type '${root}' of search index '${body.key}' is not included in this lens`,
      { fields: { key: `Include entity type '${root}' first` } },
    );
  }
  if ((await indices.listLensIndexInclusions(lensId)).includes(body.key)) {
    throw new ConflictError("Search index is already included in this lens");
  }
  if (!(await indices.includeIndexInLens(lensId, body.key))) {
    throw new NotFoundError(`Search index '${body.key}' not found`);
  }
  invalidateLoadedSchemaCache();
  return { key: body.key };
}

/** Remove an index inclusion; not included -> not found. */
export async function excludeIndexFromLens(
  lensId: string,
  key: string,
  store: ModelingStore,
): Promise<void> {
  const indices = requireSearchIndices(store);
  await existingLens(store, lensId);
  if (!(await indices.excludeIndexFromLens(lensId, key))) {
    throw new NotFoundError(`Search index '${key}' is not included in this lens`);
  }
  invalidateLoadedSchemaCache();
}

/**
 * The warnings lens validation reports for the indices a lens includes
 * (D3): an index whose root type the lens does not expose (it is not
 * searchable there — removing a type inclusion keeps the index
 * inclusions) and properties an index reads that the lens hides
 * (`lensIndexFindings`). Relation groups the lens skips are no warning. `full` and
 * `scoped` are the schema before and after the lens's scope; an
 * unscoped lens gets none. Paths: `lenses.<lens>.includes.searchIndices.
 * <index>.<definition path>`. Nothing on an adapter without search
 * indices.
 */
export async function lensIndexWarnings(
  store: ModelingStore,
  lens: { lensId: string; key: string },
  full: SearchIndexSchema,
  scoped: SearchIndexSchema,
): Promise<SearchIndexIssue[]> {
  const indices = store.searchIndices?.();
  if (indices === undefined) return [];
  const included = new Set(await indices.listLensIndexInclusions(lens.lensId));
  if (included.size === 0) return [];
  const warnings: SearchIndexIssue[] = [];
  for (const index of await indices.listIndices()) {
    if (!included.has(index.key)) continue;
    const definition = { ...index.definition, key: index.key };
    for (const finding of lensIndexFindings(definition, full, scoped)) {
      warnings.push({
        path: `lenses.${lens.key}.includes.searchIndices.${index.key}.${finding.path}`,
        message: finding.message,
      });
    }
  }
  return warnings;
}

// ---------------------------------------------------------------------------
// The cascade of schema removals
// ---------------------------------------------------------------------------

/** What a schema removal does to the custom indices, and the lenses that
 * include an index it deletes. Nothing on an adapter without search
 * indices. */
export interface IndexCascadePlan extends SearchIndexCascade {
  /** Sorted keys of the indices it changes or deletes. */
  affectedIndices: string[];
  /** Sorted keys of the lenses including an index it deletes. */
  affectedLenses: string[];
}

const NO_CASCADE: IndexCascadePlan = { updated: [], deleted: [], affectedIndices: [], affectedLenses: [] };

/** Plan the custom-index side of a schema removal (`planSearchIndexCascade`). */
export async function planIndexCascade(
  store: ModelingStore,
  removal: SchemaRemoval,
): Promise<IndexCascadePlan> {
  const indices = store.searchIndices?.();
  if (indices === undefined) return NO_CASCADE;
  const custom = (await indices.listIndices()).filter((index) => index.kind === "custom");
  const cascade = planSearchIndexCascade(
    custom.map((index) => ({ ...index.definition, key: index.key })),
    removal,
  );
  const lenses = new Set<string>();
  for (const key of cascade.deleted) {
    for (const lens of await indices.findLensesIncludingIndex(key)) lenses.add(lens);
  }
  return { ...cascade, affectedIndices: cascadeIndexKeys(cascade), affectedLenses: [...lenses].sort() };
}

/** Apply a planned cascade: delete the indices it deletes (their lens
 * inclusions go with them), store the changed definitions. The caller
 * reconciles afterwards (the schema sync does). */
export async function applyIndexCascade(store: ModelingStore, plan: IndexCascadePlan): Promise<void> {
  const indices = store.searchIndices?.();
  if (indices === undefined) return;
  for (const key of plan.deleted) await indices.deleteIndex(key);
  for (const definition of plan.updated) await indices.updateIndexDefinition(definition.key, definition);
}

/** The cascade message part naming the indices, empty when none. */
export function indexCascadeText(plan: IndexCascadePlan): string {
  return plan.affectedIndices.length === 0
    ? ""
    : ` and read by ${plan.affectedIndices.length} custom search index(es) ` +
        `(${plan.affectedIndices.join(", ")})`;
}

// ---------------------------------------------------------------------------
// Transfer
// ---------------------------------------------------------------------------

/** The indices' part of an export: the custom definitions in key order
 * and the managed indices switched off. (An adapter without search
 * indices exports no such part.) */
export async function exportSearchIndices(indices: SearchIndexStore): Promise<ExportSearchIndicesInput> {
  const [records, searchSettings] = await Promise.all([
    indices.listIndices(),
    indices.getSearchSettings(),
  ]);
  return {
    custom: records
      .filter((index) => index.kind === "custom")
      .map((index) => ({ ...index.definition, key: index.key })),
    disabled: [...disabledIndexKeys(searchSettings)].sort(),
  };
}

/**
 * The import errors of a payload's indices against the payload's own
 * schema: each custom definition must be valid there, each switched-off
 * key must name a managed index that schema derives. Messages follow the
 * import's `Import error: …` form.
 */
export function importedIndexErrors(
  payloadIndices: ExportSearchIndicesInput,
  schema: SearchIndexSchema,
): string[] {
  const errors: string[] = [];
  for (const definition of payloadIndices.custom) {
    for (const issue of validateSearchIndex(definition, schema)) {
      errors.push(
        `Import error: search index '${definition.key}' is invalid at ${issue.path}: ${issue.message}`,
      );
    }
  }
  const managed = new Set(deriveManagedIndices(schema).map((m) => m.definition.key));
  for (const key of payloadIndices.disabled) {
    if (!managed.has(key)) {
      errors.push(`Import error: switched-off search index '${key}' is not a managed index of the payload`);
    }
  }
  return errors;
}

/**
 * The import errors of the lenses' index inclusions (6.0): each key must
 * name a custom index of the payload or a managed index the payload's
 * schema derives, once per lens. The root-type rule is not checked: like
 * type inclusions, index inclusions are written as they come — a lens
 * may keep an index whose root type it no longer includes — and lens
 * validation reports what limits them.
 */
export function importedInclusionErrors(
  lenses: readonly { key: string; indexInclusions?: string[] | undefined }[],
  payloadIndices: ExportSearchIndicesInput | undefined,
  schema: SearchIndexSchema,
): string[] {
  const known = new Set([
    ...(payloadIndices?.custom ?? []).map((definition) => definition.key),
    ...deriveManagedIndices(schema).map((managed) => managed.definition.key),
  ]);
  const errors: string[] = [];
  for (const lens of lenses) {
    const seen = new Set<string>();
    for (const key of lens.indexInclusions ?? []) {
      if (seen.has(key)) {
        errors.push(`Import error: lens '${lens.key}' includes search index '${key}' twice`);
      } else if (!known.has(key)) {
        errors.push(`Import error: lens '${lens.key}' includes unknown search index '${key}'`);
      }
      seen.add(key);
    }
  }
  return errors;
}

/** Key conflicts of a payload's custom indices: duplicates within it and
 * keys the target already holds. */
export async function importedIndexConflicts(
  store: ModelingStore,
  payloadIndices: ExportSearchIndicesInput,
): Promise<string[]> {
  const indices = store.searchIndices?.();
  const conflicts: string[] = [];
  const seen = new Set<string>();
  for (const { key } of payloadIndices.custom) {
    if (seen.has(key) || (indices !== undefined && (await indices.getIndex(key)) !== null)) {
      conflicts.push(`Search index with key '${key}' already exists`);
    }
    seen.add(key);
  }
  return conflicts;
}

/**
 * Write a payload's indices once its types exist: the custom definitions,
 * and its switches added to the target's. No vectors are provisioned —
 * the schema sync that follows reconciles, and the worker builds. An
 * adapter without search indices keeps nothing.
 */
export async function importSearchIndices(
  store: ModelingStore,
  payloadIndices: ExportSearchIndicesInput,
): Promise<void> {
  const indices = store.searchIndices?.();
  if (indices === undefined) return;
  if (payloadIndices.disabled.length > 0) {
    const current = await indices.getSearchSettings();
    await indices.setSearchSettings({
      ...current,
      disabledDefaults: disabledDefaultsOf([...disabledIndexKeys(current), ...payloadIndices.disabled]),
    });
  }
  for (const definition of payloadIndices.custom) {
    await indices.createIndex(randomUUID(), "custom", definition);
  }
}

/**
 * Make a lens's index inclusions exactly `keys`, once the indices exist —
 * replacing the managed indices the schema sync included on its own.
 * Nothing on an adapter without search indices.
 */
export async function importLensIndexInclusions(
  store: ModelingStore,
  lensId: string,
  keys: readonly string[],
): Promise<void> {
  const indices = store.searchIndices?.();
  if (indices === undefined) return;
  const current = await indices.listLensIndexInclusions(lensId);
  for (const key of current) {
    if (!keys.includes(key)) await indices.excludeIndexFromLens(lensId, key);
  }
  for (const key of keys) {
    if (!current.includes(key)) await indices.includeIndexInLens(lensId, key);
  }
}
