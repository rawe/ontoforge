/**
 * What a navigator reads of its lens, as one small port: ranked search,
 * substring listing, one entity, and an entity's neighbours. The lens
 * implementation calls the runtime service, so everything it returns is
 * already scoped to the lens; tests substitute their own.
 */

import { NotFoundError, ValidationError } from "../../../../core/exceptions.js";
import type { Row, RuntimeStore } from "../../../../core/ports.js";
import { search, type SearchRequest } from "../../../search/entry.js";
import { getEntity, getNeighbors, listEntities } from "../../../service.js";

export interface SearchHitRow {
  entity: Row;
  relativeScore: number;
}

export interface Neighbor {
  relation: Row;
  entity: Row;
}

export interface GraphReader {
  /** Ranked search over the lens, best first; empty when no strategy is available. */
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
      const request: SearchRequest = { query, type, in: documents ? ["properties", "document"] : ["properties"], limit };
      try {
        const response = await search(lensKey, request, store);
        return response.hits.map((hit) => ({ entity: hit.entity, relativeScore: hit.relativeScore }));
      } catch (error) {
        // No search strategy, or a type without a searchable index: the
        // caller falls back to listing.
        if (error instanceof ValidationError) return [];
        throw error;
      }
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
