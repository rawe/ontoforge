import type { Row, RuntimeStore, SearchedType } from "../../core/ports.js";
import type { Ranked } from "./fusion.js";
export { buildTextRepr, MAX_TEXT_CHARS } from "./propertyText.js";
export function propertyKind(
  store: RuntimeStore,
  types: SearchedType[],
  embedding: number[],
  limit: number,
  query: string,
) {
  const rows = (hits: Row[]): Ranked<Row>[] =>
    hits.map((r) => ({
      key: String((r.entity as Row)._id),
      score: r.score as number,
      value: r.entity as Row,
    }));
  return {
    semantic: async () =>
      types.length ? rows(await store.propertySearchSemantic(types, embedding, limit)) : [],
    keyword: async () =>
      types.length ? rows(await store.propertySearchKeyword(types, query, limit)) : [],
  };
}
