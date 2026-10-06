/**
 * The conversion of version-1 retriever configurations — the 5.x
 * retrievers with result buckets, search fields and hard or soft
 * conditions — into retriever-agent configurations of version 2. It exists
 * for 5.x data only: the storage upgrade, the 5.0 transfer import and the
 * import of a version-1 portable export call it, nothing else — remove it
 * with them.
 *
 * Each bucket searches its type's default index (`<type>~default`) when it
 * searched a string field, and the passage index of every document field
 * it searched (`<type>~<document>`). Hard conditions become filters. Soft
 * conditions have no counterpart — their content belongs in a custom
 * index with a relation group — so they are dropped and named in a
 * warning. Answer fields, threshold and characters stay.
 */

import { z } from "zod";

import type { RetrieverAgentConfig } from "./retrieverAgent.js";
import { DEFAULT_INDEX_SUFFIX, MANAGED_KEY_SEPARATOR } from "./searchIndex.js";

/** The version this module converts from. */
export const LEGACY_RETRIEVER_CONFIG_VERSION = 1;

const Hop = z.object({
  relationTypeKey: z.string(),
  direction: z.enum(["outgoing", "incoming"]),
});

/** The version-1 shape, read leniently: only what the conversion uses. */
const LegacyConfig = z.object({
  buckets: z.array(
    z.object({
      entityTypeKey: z.string(),
      searchFields: z.array(z.string()),
      answerFields: z.array(z.string()),
      conditions: z
        .array(
          z.object({
            id: z.string(),
            mode: z.enum(["hard", "soft"]),
            path: z.array(Hop),
            targetField: z.string(),
          }),
        )
        .default([]),
    }),
  ),
  threshold: z.number().default(0.35),
  answerFieldCharacters: z.number().default(800),
});

export interface ConvertedRetrieverConfig {
  config: RetrieverAgentConfig;
  warnings: string[];
}

/**
 * Convert a version-1 configuration. `dataTypeOf` answers a property's data
 * type on an entity type (undefined: unknown), which tells string fields
 * from document fields. Null when the configuration is not a readable
 * version-1 shape.
 */
export function convertLegacyRetrieverConfig(
  raw: unknown,
  dataTypeOf: (entityType: string, field: string) => string | undefined,
): ConvertedRetrieverConfig | null {
  const parsed = LegacyConfig.safeParse(raw);
  if (!parsed.success) return null;
  const legacy = parsed.data;
  const indices: RetrieverAgentConfig["indices"] = [];
  const filters: RetrieverAgentConfig["filters"] = [];
  const answerFields: RetrieverAgentConfig["answerFields"] = {};
  const warnings: string[] = [];
  const add = (index: string) => {
    if (!indices.some((ref) => ref.index === index)) indices.push({ index });
  };
  const filterIds = new Set<string>();
  for (const bucket of legacy.buckets) {
    const type = bucket.entityTypeKey;
    for (const field of bucket.searchFields) {
      add(
        dataTypeOf(type, field) === "document"
          ? `${type}${MANAGED_KEY_SEPARATOR}${field}`
          : `${type}${MANAGED_KEY_SEPARATOR}${DEFAULT_INDEX_SUFFIX}`,
      );
    }
    answerFields[type] = bucket.answerFields;
    for (const condition of bucket.conditions) {
      if (condition.mode === "soft") {
        const path = condition.path
          .map((hop) => `${hop.relationTypeKey} (${hop.direction})`)
          .join(" → ");
        warnings.push(
          `Soft condition '${condition.id}' of ${type} was dropped: it needs a custom index ` +
            `with relation group ${path || "(own fields)"}.`,
        );
        continue;
      }
      // Version 1 scoped condition ids per bucket; filter ids are one list.
      let id = filterIds.has(condition.id) ? `${type}_${condition.id}` : condition.id;
      for (let n = 2; filterIds.has(id); n++) id = `${type}_${condition.id}_${n}`;
      filterIds.add(id);
      filters.push({ id, entityType: type, path: condition.path, field: condition.targetField });
    }
  }
  return {
    config: {
      indices,
      filters,
      answerFields,
      threshold: legacy.threshold,
      answerFieldCharacters: legacy.answerFieldCharacters,
    },
    warnings,
  };
}
