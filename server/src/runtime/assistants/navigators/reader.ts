/**
 * What a navigator reads of its lens, as one small port: ranked search,
 * substring listing, one entity, and an entity's neighbours. The lens
 * implementation calls the runtime service, so everything it returns is
 * already scoped to the lens; tests substitute their own.
 */

import { NotFoundError } from "../../../core/exceptions.js";
import type { Row, RuntimeStore } from "../../../core/ports.js";
import { loadSchema } from "../../schemaCache.js";
import { rankEntities } from "../../search/entitySearch.js";
import { indexStoreOf, searchableIndices } from "../../search/indexSearch.js";
import { getEntity, getNeighbors, listEntities } from "../../service.js";

export interface SearchHitRow {
  entity: Row;
  /** The engine's score; comparable only within one search. */
  score: number;
}

export interface Neighbor {
  relation: Row;
  entity: Row;
}

export interface GraphReader {
  /** Ranked search over the lens — the entities' own fields, with
   * `documents` their documents' passages too — best first; empty when
   * nothing can run. */
  search(query: string, type: string | null, documents: boolean, limit: number): Promise<SearchHitRow[]>;
  /** Entities of one type whose string properties contain the term. */
  list(type: string, term: string, limit: number): Promise<Row[]>;
  /** The entity, or null when it is gone or the lens no longer shows it. */
  entity(type: string, id: string): Promise<Row | null>;
  /** The entity's relations both ways, with the entity at the other end. */
  neighbors(type: string, id: string, limit: number): Promise<Neighbor[]>;
}

export function lensReader(lensKey: string, store: RuntimeStore): GraphReader {
  return {
    async search(query, type, documents, limit) {
      const loaded = await loadSchema(lensKey, store);
      // The managed indices of the type, or of every type: own fields, and
      // with documents the passages.
      const indices = (await searchableIndices(loaded, indexStoreOf(store)))
        .filter((index) => index.kind === "default" || (documents && index.kind === "passage"))
        .filter((index) => type === null || index.definition.entityType === type)
        .map((index) => index.key);
      if (indices.length === 0) return [];
      // What cannot run is a limitation, not an error: then nothing is
      // found, and the caller falls back to listing.
      const { hits, entities } = await rankEntities(loaded, { query, indices, limit }, store);
      return hits.map((hit) => ({ entity: entities.get(hit.entityId)!, score: hit.score }));
    },
    async list(type, term, limit) {
      const page = await listEntities(lensKey, type, limit, 0, "_createdAt", "asc", term, {}, store);
      return page.items.map((item) => ({ ...item, _entityTypeKey: type }));
    },
    async entity(type, id) {
      try {
        return { ...(await getEntity(lensKey, type, id, store)), _entityTypeKey: type };
      } catch (error) {
        if (error instanceof NotFoundError) return null;
        throw error;
      }
    },
    async neighbors(type, id, limit) {
      try {
        const { neighbors } = await getNeighbors(lensKey, type, id, "both", null, limit, store);
        return neighbors as unknown as Neighbor[];
      } catch (error) {
        if (error instanceof NotFoundError) return [];
        throw error;
      }
    },
  };
}
