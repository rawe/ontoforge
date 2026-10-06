import type { OwnSearchRuntimeStore } from "../../core/ownSearch.js";
import type { Row, SearchedType } from "../../core/ports.js";
import { semanticRow } from "./fusion.js";
export { buildTextRepr, MAX_TEXT_CHARS } from "./propertyText.js";
/** The entity ranking of an adapter's own search storage. It ranks by
 * vector only: keyword ranking is the search indices' (no adapter keeps
 * its own and declares it). */
export function propertyKind(
  store: OwnSearchRuntimeStore,
  types: SearchedType[],
  embedding: number[],
  limit: number,
) {
  const key = (r: Row) => String((r.entity as Row)._id);
  return {
    semantic: async () =>
      types.length
        ? (await store.propertySearchSemantic(types, embedding, limit)).map((r) =>
            semanticRow(key(r), r.entity as Row, r.score),
          )
        : [],
    keyword: () => Promise.reject(new Error("Keyword ranking needs search indices")),
  };
}
