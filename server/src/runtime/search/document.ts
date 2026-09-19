import type { KeywordMatching, Row, RuntimeStore, SearchedProperty } from "../../core/ports.js";
import {
  emptyEvidence, keywordRow, semanticRow, type Ranked, type RankingScore,
} from "./fusion.js";
import type { SearchMatch } from "./entry.js";
export { chunkDocument } from "./chunking.js";
export function documentKind(
  store: RuntimeStore,
  properties: SearchedProperty[],
  embedding: number[],
  limit: number,
  query: string,
) {
  const key = (r: Row) => String((r.chunk as Row)._id);
  return {
    semantic: async () =>
      properties.length
        ? (await store.documentSearchSemantic(properties, embedding, limit)).map((r) =>
            semanticRow(key(r), r.chunk as Row, r.score),
          )
        : [],
    keyword: async (matching: KeywordMatching) =>
      properties.length
        ? (await store.documentSearchKeyword(properties, query, limit, matching)).map((r) =>
            keywordRow(key(r), r.chunk as Row, r.score),
          )
        : [],
  };
}
/** Keeps the passage ranking's score kind: the best passage's score becomes the entity's. */
export function collapsePassages<Kind extends RankingScore>(
  ranking: Ranked<Row, Kind>[],
): Ranked<{ type: string; matches: SearchMatch[] }, Kind>[] {
  const entities = new Map<string, Ranked<{ type: string; matches: SearchMatch[] }, Kind>>();
  for (const row of ranking) {
    const chunk = row.value;
    const id = String(chunk._entityId);
    let entity = entities.get(id);
    if (!entity) {
      entity = {
        key: id,
        score: row.score,
        value: { type: String(chunk._entityTypeKey), matches: [] },
      };
      entities.set(id, entity);
    }
    if (
      !entity.value.matches.some(
        (m) => m.kind === "document" && m.propertyKey === chunk._propertyKey,
      )
    )
      entity.value.matches.push({
        kind: "document",
        propertyKey: String(chunk._propertyKey),
        charOffset: Number(chunk.startChar),
        charLength: Number(chunk.charLength),
        evidence: row.evidence ?? emptyEvidence(),
      });
  }
  return [...entities.values()];
}
