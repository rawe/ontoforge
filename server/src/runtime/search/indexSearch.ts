/**
 * Search over search indices: what the entity search, the passage search
 * and the retriever share around the search tree.
 *
 * - The indices the lens may search (`searchableIndices`), and its catalog
 *   of them (`searchIndexCatalog`), projected through it, for clients and
 *   agents to choose from.
 * - A search tree (`core/searchTree.ts`), checked against the lens and run
 *   by the executor (`runSearchTree`, `executor.ts`).
 * - The found entities, read through the lens (`readHitEntities`), and
 *   what matched each (`describeMatches`).
 */

import { getEmbeddingProvider } from "../../core/embedding.js";
import type {
  RankedSearchEntry,
  Row,
  RuntimeStore,
  SearchIndexRecord,
  SearchIndexStore,
} from "../../core/ports.js";
import { documentField } from "../../core/searchComposition.js";
import { managedIndexDescription, type SearchRepresentation } from "../../core/searchIndex.js";
import { disabledIndexKeys, type SearchIndexState } from "../../core/searchPipeline.js";
import { availableIndices, readsHiddenProperties, snippet } from "../../core/searchQuery.js";
import { validateSearchTree, type TreeNode } from "../../core/searchTree.js";
import {
  applyFieldProjection,
  ENTITY_NEIGHBOR_ALWAYS_FIELDS,
  filterEntityProperties,
} from "../readHelpers.js";
import { listSearchIndexStatuses } from "../indexing/status.js";
import { loadSchema, type LoadedSchema } from "../schemaCache.js";
import { deploymentMethods, offeredMethods, type SearchCapabilities } from "./availability.js";
import { executeSearchTree, type TreeResult } from "./executor.js";

/** The retriever's search modes. */
export type SearchMode = "semantic" | "keyword" | "hybrid";

/** What matched an entity: its best entry. */
export interface Matched {
  index: string;
  partKind: "self" | "relation" | "passage";
  relationType: string | null;
  relationId: string | null;
  /** The entity on the other end of a relation entry; its label is its
   * name property's value (null when empty or hidden by the lens), its
   * identity its `_identity` (null when it has none or the lens does not
   * show the type's whole identity). */
  target: { id: string; type: string; label: string | null; identity: string | null } | null;
  /** At most 200 characters of the entry's text; empty when the index
   * reads properties the lens hides. */
  snippet: string;
  /** A passage's place in its document. */
  charOffset: number | null;
  charLength: number | null;
}

/** One index's part in an entity's hit: the entry that represents it and
 * the measurements of that entry. */
export interface IndexMatch {
  index: SearchIndexRecord;
  entry: RankedSearchEntry;
  /** `(1 + cosine) / 2` of this entry, when the semantic ranking fetched
   * it; else null (unmeasured). */
  semanticSimilarity: number | null;
  /** The keyword score of this entry — distinct query words matched plus
   * the full-text rank as a fraction below one — when the keyword ranking
   * fetched it; else null. */
  keywordScore: number | null;
}

/** Per method that found one entry — the same part in the same index —
 * that method's own score of it, semantic first. Scores of different
 * methods are not comparable. */
export type MethodScores = Partial<Record<SearchRepresentation, number>>;

/** One entity of an engine ranking. */
export interface EngineHit {
  entityId: string;
  entityType: string;
  score: number;
  /** The entity's best entry in the mode it ranks best in, with the score
   * of every method that found this very entry. */
  matched: { index: SearchIndexRecord; entry: RankedSearchEntry; scores: MethodScores };
  /** Per index that found the entity, the matched mode's order first. */
  indices: IndexMatch[];
}

// ---------------------------------------------------------------------------
// Availability
// ---------------------------------------------------------------------------

/** The indices the lens may search, in key order. */
export async function searchableIndices(
  loaded: LoadedSchema,
  indexStore: SearchIndexStore,
): Promise<SearchIndexRecord[]> {
  const [indices, settings] = await Promise.all([
    indexStore.listIndices(),
    indexStore.getSearchSettings(),
  ]);
  return availableIndices(
    indices,
    {
      scoped: loaded.searchIndexScope.scoped,
      exposedEntityTypes: new Set(Object.keys(loaded.scoped.entityTypes)),
      includedIndices: new Set(loaded.searchIndexScope.includedIndices),
    },
    disabledIndexKeys(settings),
  );
}

/** The search modes the deployment can run (`availability.ts`), in
 * preference order — the first is the default. */
export function availableModes(store: SearchCapabilities): SearchMode[] {
  const methods = deploymentMethods(store);
  return (["hybrid", "keyword", "semantic"] as const).filter((mode) =>
    mode === "hybrid" ? methods.length === 2 : methods.includes(mode),
  );
}

// ---------------------------------------------------------------------------
// Catalog
// ---------------------------------------------------------------------------

/** One index of a lens's search catalog. */
export interface SearchIndexCatalogEntry {
  key: string;
  kind: SearchIndexRecord["kind"];
  name: string;
  /** A managed index's names only the fields the lens shows. */
  description: string;
  entityType: string;
  /** The root's fields the lens shows. */
  fields: string[];
  /** The relation groups the lens shows — a group whose relation type, or
   * the entity type on its other end, the lens hides is skipped at query
   * time and not listed. `label`: the group's, else the relation type's
   * display name. */
  relations: { relationType: string; direction: "outgoing" | "incoming"; label: string }[];
  /** The document an index reads passages of — null when it reads none,
   * or the lens hides it. */
  documentProperty: string | null;
  /** The representations the index has enabled that can rank once built
   * (`offeredMethods`): semantic only with an embedding provider. */
  modes: SearchRepresentation[];
  status: SearchIndexState;
}

/**
 * The indices the lens may search (`searchableIndices`: switched-off
 * managed ones never), each projected through the lens, with its build
 * state.
 */
export async function searchIndexCatalog(
  lensKey: string,
  store: RuntimeStore,
): Promise<SearchIndexCatalogEntry[]> {
  const indexStore = indexStoreOf(store);
  const loaded = await loadSchema(lensKey, store);
  const [indices, statuses] = await Promise.all([
    searchableIndices(loaded, indexStore),
    listSearchIndexStatuses(indexStore.ontologyKey),
  ]);
  const stateOf = new Map(statuses.map((status) => [status.key, status.state] as const));
  return indices.map((index) => {
    const { definition } = index;
    const root = loaded.scoped.entityTypes[definition.entityType]!;
    const relations = definition.relations.flatMap((group) => {
      const relationType = loaded.scoped.relationTypes[group.relationType];
      if (relationType === undefined) return [];
      const otherEnd =
        group.direction === "outgoing" ? relationType.toEntityTypeKey : relationType.fromEntityTypeKey;
      if (loaded.scoped.entityTypes[otherEnd] === undefined) return [];
      return [
        {
          relationType: group.relationType,
          direction: group.direction,
          label: group.label ?? relationType.displayName,
        },
      ];
    });
    const document = documentField(definition, loaded.full);
    const fields = definition.fields.filter((key) => key in root.properties);
    return {
      key: index.key,
      kind: index.kind,
      name: definition.name,
      // A managed description names the fields it reads: regenerated from
      // the ones the lens shows. A custom one is the designer's own text.
      description:
        index.kind === "custom"
          ? definition.description
          : managedIndexDescription(
              index.kind,
              root.displayName,
              fields.map((key) => root.properties[key]!.displayName),
            ),
      entityType: definition.entityType,
      fields,
      relations,
      documentProperty: document !== null && document in root.properties ? document : null,
      modes: offeredMethods(index),
      status: stateOf.get(index.key) ?? "stale",
    };
  });
}

// ---------------------------------------------------------------------------
// The engine
// ---------------------------------------------------------------------------

/** Run a search tree over `indices` — the ones the caller resolved
 * through the lens — once its rules hold. */
export async function runSearchTree(
  loaded: LoadedSchema,
  indexStore: SearchIndexStore,
  indices: readonly SearchIndexRecord[],
  tree: TreeNode,
): Promise<TreeResult> {
  const violations = validateSearchTree(tree, {
    indices: new Set(indices.map((index) => index.key)),
    entityTypes: new Set(Object.keys(loaded.scoped.entityTypes)),
    model: getEmbeddingProvider()?.modelId ?? null,
  });
  if (violations.length > 0) {
    throw new Error(
      `Invalid search tree: ${violations.map((v) => `${v.rule} at '${v.path}': ${v.message}`).join("; ")}`,
    );
  }
  return executeSearchTree(loaded, indexStore, new Map(indices.map((index) => [index.key, index] as const)), tree);
}

// ---------------------------------------------------------------------------
// Entities and matches
// ---------------------------------------------------------------------------

/** The hits' entities, read and projected through the lens, by id. An
 * entity gone since the ranking is missing. */
export async function readHitEntities(
  loaded: LoadedSchema,
  store: RuntimeStore,
  hits: EngineHit[],
  fields: string[] | null | undefined,
): Promise<Map<string, Row>> {
  const byType = new Map<string, string[]>();
  for (const hit of hits) byType.set(hit.entityType, [...(byType.get(hit.entityType) ?? []), hit.entityId]);
  const entities = new Map<string, Row>();
  for (const [type, ids] of byType) {
    const scopedType = loaded.scoped.entityTypes[type];
    const fullType = loaded.full.entityTypes[type];
    if (scopedType === undefined || fullType === undefined) continue;
    const rows = await store.getEntitiesByIds(ids, fullType.properties);
    for (const [id, row] of Object.entries(rows)) {
      const entity = filterEntityProperties({ ...row, _entityTypeKey: type }, scopedType, fields);
      entities.set(id, applyFieldProjection(entity, fields, ENTITY_NEIGHBOR_ALWAYS_FIELDS));
    }
  }
  return entities;
}

/** Describe what matched each hit (`Matched`), by entity id. */
export async function describeMatches(
  loaded: LoadedSchema,
  store: RuntimeStore,
  hits: EngineHit[],
): Promise<Map<string, Matched>> {
  const targets = await targetsOf(
    loaded,
    store,
    hits.map((hit) => hit.matched.entry),
  );
  const withheld = new Map<string, boolean>();
  const hidesText = (index: SearchIndexRecord) => {
    if (!withheld.has(index.key)) {
      withheld.set(index.key, readsHiddenProperties(index.definition, loaded.full, loaded.scoped));
    }
    return withheld.get(index.key)!;
  };
  const described = new Map<string, Matched>();
  for (const hit of hits) {
    const { index, entry } = hit.matched;
    described.set(hit.entityId, {
      index: index.key,
      partKind: entry.partKind,
      relationType: entry.relationType,
      relationId: entry.partKind === "relation" ? entry.partId : null,
      target:
        entry.targetId === null || entry.targetType === null
          ? null
          : {
              id: entry.targetId,
              type: entry.targetType,
              label: targets.get(entry.targetId)?.label ?? null,
              identity: targets.get(entry.targetId)?.identity ?? null,
            },
      snippet: hidesText(index) ? "" : snippet(entry.text),
      charOffset: entry.partKind === "passage" ? entry.startChar : null,
      charLength: entry.partKind === "passage" ? entry.charLength : null,
    });
  }
  return described;
}

/** The name-property values and the identities of the target entities,
 * by id — through the lens: a hidden name property gives no label, an
 * identity the lens does not show whole no identity. */
async function targetsOf(
  loaded: LoadedSchema,
  store: RuntimeStore,
  entries: RankedSearchEntry[],
): Promise<Map<string, { label: string | null; identity: string | null }>> {
  const byType = new Map<string, Set<string>>();
  for (const entry of entries) {
    if (entry.targetId === null || entry.targetType === null) continue;
    byType.set(entry.targetType, (byType.get(entry.targetType) ?? new Set()).add(entry.targetId));
  }
  const targets = new Map<string, { label: string | null; identity: string | null }>();
  for (const [type, ids] of byType) {
    const nameProperty = loaded.scoped.entityTypes[type]?.nameProperty ?? null;
    const identityShown = (loaded.scoped.entityTypes[type]?.identityProperties ?? null) !== null;
    const fullType = loaded.full.entityTypes[type];
    if ((nameProperty === null && !identityShown) || fullType === undefined) continue;
    const rows = await store.getEntitiesByIds([...ids], fullType.properties);
    for (const [id, row] of Object.entries(rows)) {
      const value = nameProperty === null ? null : row[nameProperty];
      const identity = identityShown && typeof row._identity === "string" ? row._identity : null;
      targets.set(id, { label: typeof value === "string" && value !== "" ? value : null, identity });
    }
  }
  return targets;
}

/** The search-index store behind a runtime store. */
export function indexStoreOf(store: RuntimeStore): SearchIndexStore {
  return store.searchIndices();
}
