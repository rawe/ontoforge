import type { KeywordMatching, Row, RuntimeStore, SearchedType } from "../../core/ports.js";
import { keywordRow, semanticRow } from "./fusion.js";
export { buildTextRepr, MAX_TEXT_CHARS } from "./propertyText.js";
export function propertyKind(
  store: RuntimeStore,
  types: SearchedType[],
  embedding: number[],
  limit: number,
  query: string,
) {
  const key = (r: Row) => String((r.entity as Row)._id);
  return {
    semantic: async () =>
      types.length
        ? (await store.propertySearchSemantic(types, embedding, limit)).map((r) =>
            semanticRow(key(r), r.entity as Row, r.score, null),
          )
        : [],
    keyword: async (matching: KeywordMatching) =>
      types.length
        ? (await store.propertySearchKeyword(types, query, limit, matching)).map((r) =>
            keywordRow(
              key(r), r.entity as Row, r.score, (r.keywordPropertyKeys as string[] | null) ?? null,
            ),
          )
        : [],
  };
}
