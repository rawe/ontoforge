import type { Row, RuntimeStore, SearchedProperty } from "../../core/ports.js";
import { emptyEvidence, type Ranked } from "./fusion.js";
import type { SearchMatch } from "./entry.js";
export { chunkDocument } from "./chunking.js";
export function documentKind(
  store: RuntimeStore,
  properties: SearchedProperty[],
  embedding: number[],
  limit: number,
  query: string,
) {
  const rows = (hits: Row[], source: "semantic" | "keyword"): Ranked<Row>[] =>
    hits.map((r) => ({
      key: String((r.chunk as Row)._id),
      score: r.score as number,
      value: r.chunk as Row,
      evidence: {
        semanticSimilarity: source === "semantic" ? (r.score as number) : null,
        keywordMatch: source === "keyword" ? true : null,
      },
    }));
  return {
    semantic: async () =>
      properties.length
        ? rows(await store.documentSearchSemantic(properties, embedding, limit), "semantic")
        : [],
    keyword: async () =>
      properties.length
        ? rows(await store.documentSearchKeyword(properties, query, limit), "keyword")
        : [],
  };
}
export function collapsePassages(
  ranking: Ranked<Row>[],
): Ranked<{ type: string; matches: SearchMatch[] }>[] {
  const entities = new Map<string, Ranked<{ type: string; matches: SearchMatch[] }>>();
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
