/**
 * The default retriever agent: every lens's implicit agent, keyed
 * `_default` (no configurable key may begin with an underscore, so it can
 * never be shadowed). It is never stored; its configuration is derived
 * per question from the lens, deterministically — the same lens and
 * schema give the same configuration, so a follow-up token stays bound
 * to it and expires on a schema change.
 *
 * Derived: every managed index of the lens's search catalog (switched-on
 * ones only, as the catalog lists them), and per result type whose name
 * property is visible a filter on that name (0 hops) and one per relation
 * the lens shows to a type with a visible name property (1 hop, each
 * direction). The stored limits of 12 indices and 12 filters do not
 * apply; the planner input cap does.
 */

import {
  DEFAULT_ANSWER_FIELD_CHARACTERS,
  DEFAULT_THRESHOLD,
  MAX_ANSWER_FIELDS,
  type RetrieverAgentConfig,
  type RetrieverAgentFilter,
} from "../../core/retrieverAgent.js";
import { resultTypes, type AgentLens } from "./config.js";

export const DEFAULT_RETRIEVER_AGENT_KEY = "_default";
/** The name the runtime list gives it, the same as the default agent's. */
export const DEFAULT_RETRIEVER_AGENT_NAME = "Default";

/** The default agent's configuration in a lens. */
export function defaultAgentConfig(lens: AgentLens): RetrieverAgentConfig {
  const { scoped, catalog } = lens;
  // A passage index whose document the lens hides searches nothing visible.
  const indices = catalog
    .filter((entry) => entry.kind === "default" || (entry.kind === "passage" && entry.documentProperty !== null))
    .map((entry) => ({ index: entry.key }));
  const types = resultTypes({ indices }, catalog);
  const relationKeys = Object.keys(scoped.relationTypes).sort();

  const filters: RetrieverAgentFilter[] = [];
  for (const type of types) {
    const name = scoped.entityTypes[type]?.nameProperty ?? null;
    if (name === null) continue;
    filters.push({ id: type, entityType: type, path: [], field: name });
    for (const key of relationKeys) {
      const relation = scoped.relationTypes[key]!;
      const ends = [
        { direction: "outgoing" as const, from: relation.fromEntityTypeKey, to: relation.toEntityTypeKey },
        { direction: "incoming" as const, from: relation.toEntityTypeKey, to: relation.fromEntityTypeKey },
      ];
      for (const { direction, from, to } of ends) {
        const target = from === type ? (scoped.entityTypes[to]?.nameProperty ?? null) : null;
        if (target === null) continue;
        filters.push({
          id: `${type}.${key}.${direction}`,
          entityType: type,
          path: [{ relationTypeKey: key, direction }],
          field: target,
        });
      }
    }
  }

  const answerFields: Record<string, string[]> = {};
  for (const type of types) {
    const definition = scoped.entityTypes[type]!;
    const name = definition.nameProperty;
    const strings = Object.values(definition.properties)
      .filter((property) => property.dataType === "string" && property.key !== name)
      .map((property) => property.key);
    answerFields[type] = [...(name === null ? [] : [name]), ...strings].slice(0, MAX_ANSWER_FIELDS);
  }

  return {
    indices,
    filters,
    answerFields,
    threshold: DEFAULT_THRESHOLD,
    answerFieldCharacters: DEFAULT_ANSWER_FIELD_CHARACTERS,
  };
}
