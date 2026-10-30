/**
 * Availability: whether a search method can run, and why not — the one
 * place that decides it.
 *
 * - The deployment: keyword when the store ranks by keyword, semantic when
 *   an embedding provider is installed. Each instance answers for itself.
 * - An index × method: a search node runs on the index's ready generation
 *   of the method — semantic only one of the installed model, keyword one
 *   in its own language set, which its queries are parsed in. Else it does
 *   not, because the index definition switches the method off, no
 *   embedding provider is installed, or no such generation is ready: one
 *   is building, or there is none yet (stale).
 *
 * The generations come from the ontology's database — read by the caller
 * once per search tree, never kept across requests: any instance's worker
 * may have built them, so every instance answers alike.
 */

import { getEmbeddingProvider } from "../../core/embedding.js";
import type { SearchGenerationRecord, SearchIndexRecord } from "../../core/ports.js";
import type { SearchRepresentation } from "../../core/searchIndex.js";

export interface SearchCapabilities {
  supportsKeywordRanking(): boolean;
}

/** Why a search node of a method cannot run on an index. */
export type Unavailable =
  | { reason: "switched-off" | "no-provider" }
  | { reason: "not-ready"; status: "building" | "stale" };

/** Whether a search node of a method runs on an index: on which
 * generation, or why not. */
export type MethodAvailability = { runs: true; generation: SearchGenerationRecord } | ({ runs: false } & Unavailable);

/** The methods this instance can run at all, keyword first. */
export function deploymentMethods(store: SearchCapabilities): SearchRepresentation[] {
  return [
    ...(store.supportsKeywordRanking() ? (["keyword"] as const) : []),
    ...(getEmbeddingProvider() === null ? [] : (["semantic"] as const)),
  ];
}

/** The methods the index enables that this instance can run once they
 * are built, semantic first. */
export function offeredMethods(index: SearchIndexRecord): SearchRepresentation[] {
  return (["semantic", "keyword"] as const).filter((method) => unbuildable(index, method) === null);
}

/** Whether a search node of `method` runs on `index`, given the
 * ontology's generations. */
export function indexAvailability(
  index: SearchIndexRecord,
  method: SearchRepresentation,
  generations: readonly SearchGenerationRecord[],
): MethodAvailability {
  const reason = unbuildable(index, method);
  if (reason !== null) return { runs: false, reason };
  const model = getEmbeddingProvider()?.modelId;
  const own = generations.filter(
    (g) =>
      g.searchIndexId === index.searchIndexId &&
      g.representation === method &&
      (method === "keyword" || g.modelId === model),
  );
  const ready = own.find((g) => g.state === "ready");
  if (ready !== undefined) return { runs: true, generation: ready };
  return { runs: false, reason: "not-ready", status: own.some((g) => g.state === "building") ? "building" : "stale" };
}

/** Why the index cannot run `method` whatever is built; null: it can. */
function unbuildable(index: SearchIndexRecord, method: SearchRepresentation): "switched-off" | "no-provider" | null {
  if (!index.definition[method].enabled) return "switched-off";
  if (method === "semantic" && getEmbeddingProvider() === null) return "no-provider";
  return null;
}
