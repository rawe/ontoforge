/**
 * A navigator's configuration (version 1) and its check against a lens.
 * The built-in default is every relation and entity type the lens shows,
 * two hops, forty evidence entities.
 */

import { z } from "zod";

import type { SchemaCacheValue } from "../../../schemaCache.js";

export const NAVIGATOR_CONFIG_VERSION = 1;

const TypeKeys = z.array(z.string()).min(1).max(100).nullable().default(null);

export const NavigatorConfig = z
  .object({
    /** How far a walk goes from an anchor. */
    hops: z.number().int().min(1).max(3).default(2),
    /** Relation types a walk may follow; null: every one the lens shows. */
    relationTypes: TypeKeys,
    /** Entity types a mention may resolve to; null: every one the lens shows. */
    anchorTypes: TypeKeys,
    /** Evidence entities the answer model receives at most. */
    maxEntities: z.number().int().min(10).max(80).default(40),
    /** Extra guidance for the answer: tone, focus, format. */
    instructions: z.string().max(4000).nullable().default(null),
  })
  .strict();
export type NavigatorConfig = z.infer<typeof NavigatorConfig>;

function duplicates(keys: string[]): string[] {
  return [...new Set(keys.filter((key, i) => keys.indexOf(key) !== i))];
}

export function checkNavigator(config: NavigatorConfig, lens: SchemaCacheValue): string[] {
  const errors: string[] = [];
  for (const key of config.relationTypes ?? []) {
    if (!(key in lens.relationTypes)) errors.push(`relationTypes: the lens shows no relation type '${key}'`);
  }
  for (const key of duplicates(config.relationTypes ?? [])) {
    errors.push(`relationTypes: '${key}' is listed more than once`);
  }
  for (const key of config.anchorTypes ?? []) {
    if (!(key in lens.entityTypes)) errors.push(`anchorTypes: the lens shows no entity type '${key}'`);
  }
  for (const key of duplicates(config.anchorTypes ?? [])) {
    errors.push(`anchorTypes: '${key}' is listed more than once`);
  }
  return errors;
}

export function deriveNavigator(): NavigatorConfig {
  return NavigatorConfig.parse({});
}

/** The relation types a walk may follow in this lens. */
export function allowedRelations(config: NavigatorConfig, lens: SchemaCacheValue): Set<string> {
  return new Set(config.relationTypes ?? Object.keys(lens.relationTypes));
}

/** The entity types a mention may resolve to in this lens. */
export function allowedAnchors(config: NavigatorConfig, lens: SchemaCacheValue): Set<string> {
  return new Set(config.anchorTypes ?? Object.keys(lens.entityTypes));
}
