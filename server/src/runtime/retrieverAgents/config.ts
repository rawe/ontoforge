/**
 * A retriever agent's configuration checked against its lens. Every save
 * checks it (an invalid one is refused), every read reports it, and every
 * question checks it again before running: what the lens offers changes
 * underneath a stored agent — a schema change, a scope change, an index
 * deleted or switched off.
 *
 * The rules: the configuration version is the current one; every index
 * is in the lens's search catalog (`searchIndexCatalog` — switched-off
 * managed indices are not) and its `relations` name relation types of its
 * relation groups the lens shows; result types are the root types of the
 * chosen indices; each filter belongs to a result type, its path of up to
 * two hops runs through relation types the lens shows, and its field is
 * visible on the type the path reaches; every result type — and no other
 * type — has 1..12 visible answer fields.
 */

import {
  configIssues,
  RETRIEVER_AGENT_CONFIG_VERSION,
  RetrieverAgentConfig,
  type FilterHop,
} from "../../core/retrieverAgent.js";
import type { SchemaCacheValue } from "../schemaCache.js";
import type { SearchIndexCatalogEntry } from "../search/indexSearch.js";

/** What a configuration is checked against: the lens schema and the
 * indices the lens may search. */
export interface AgentLens {
  scoped: SchemaCacheValue;
  catalog: readonly SearchIndexCatalogEntry[];
}

export interface AgentCheck {
  /** The parsed configuration when it is valid, else null. */
  config: RetrieverAgentConfig | null;
  errors: string[];
}

/** The entity type a path reaches from `start`, or null when a hop is not
 * a relation type the schema shows leaving the current type. */
export function pathTarget(
  schema: Pick<SchemaCacheValue, "entityTypes" | "relationTypes">,
  start: string,
  path: readonly FilterHop[],
): string | null {
  let current = start;
  for (const hop of path) {
    const relation = schema.relationTypes[hop.relationTypeKey];
    if (relation === undefined) return null;
    const [from, to] =
      hop.direction === "outgoing"
        ? [relation.fromEntityTypeKey, relation.toEntityTypeKey]
        : [relation.toEntityTypeKey, relation.fromEntityTypeKey];
    if (from !== current || schema.entityTypes[to] === undefined) return null;
    current = to;
  }
  return current;
}

/** The relation types an index's relation groups cover in the lens. */
export function groupRelationTypes(entry: SearchIndexCatalogEntry): string[] {
  return [...new Set(entry.relations.map((group) => group.relationType))];
}

/** The result types of a configuration: the root types of its indices the
 * lens offers, in configuration order. */
export function resultTypes(
  config: Pick<RetrieverAgentConfig, "indices">,
  catalog: readonly SearchIndexCatalogEntry[],
): string[] {
  const types: string[] = [];
  for (const reference of config.indices) {
    const type = catalog.find((entry) => entry.key === reference.index)?.entityType;
    if (type !== undefined && !types.includes(type)) types.push(type);
  }
  return types;
}

/** Check a stored or submitted configuration against the lens. */
export function checkAgentConfig(version: unknown, raw: unknown, lens: AgentLens): AgentCheck {
  if (version !== RETRIEVER_AGENT_CONFIG_VERSION) {
    return {
      config: null,
      errors: [
        `Configuration version ${String(version)} is not supported; ` +
          `retriever agents run version ${RETRIEVER_AGENT_CONFIG_VERSION}`,
      ],
    };
  }
  const parsed = RetrieverAgentConfig.safeParse(raw);
  if (!parsed.success) return { config: null, errors: configIssues(parsed.error) };
  const config = parsed.data;
  const errors: string[] = [];
  const { scoped, catalog } = lens;

  const seenIndices = new Set<string>();
  for (const reference of config.indices) {
    if (seenIndices.has(reference.index)) errors.push(`Search index '${reference.index}' is chosen twice`);
    seenIndices.add(reference.index);
    const entry = catalog.find((candidate) => candidate.key === reference.index);
    if (entry === undefined) {
      errors.push(`Search index '${reference.index}' is not available in this lens`);
      continue;
    }
    const groups = groupRelationTypes(entry);
    for (const relation of reference.relations ?? []) {
      if (!groups.includes(relation)) {
        errors.push(`Search index '${reference.index}' has no relation group '${relation}' in this lens`);
      }
    }
  }

  const types = resultTypes(config, catalog);
  const filterIds = new Set<string>();
  for (const filter of config.filters) {
    if (filterIds.has(filter.id)) errors.push(`Filter id '${filter.id}' is used twice`);
    filterIds.add(filter.id);
    if (!types.includes(filter.entityType)) {
      errors.push(`Filter '${filter.id}': '${filter.entityType}' is not a result type of the chosen indices`);
      continue;
    }
    const target = pathTarget(scoped, filter.entityType, filter.path);
    if (target === null) {
      errors.push(`Filter '${filter.id}': its relation path is not visible in this lens`);
    } else if (scoped.entityTypes[target]!.properties[filter.field] === undefined) {
      errors.push(`Filter '${filter.id}': field '${filter.field}' is not visible on '${target}'`);
    }
  }

  for (const type of types) {
    const fields = config.answerFields[type];
    if (fields === undefined) {
      errors.push(`Result type '${type}' needs answer fields`);
      continue;
    }
    const visible = scoped.entityTypes[type]!.properties;
    for (const field of fields) {
      if (visible[field] === undefined) {
        errors.push(`Answer field '${field}' is not visible on '${type}'`);
      }
    }
  }
  // An index the lens lost hides its root type: no further noise then.
  const complete = config.indices.every((reference) => catalog.some((entry) => entry.key === reference.index));
  for (const type of complete ? Object.keys(config.answerFields) : []) {
    if (!types.includes(type)) {
      errors.push(`Answer fields for '${type}', which no chosen index finds`);
    }
  }
  return { config: errors.length === 0 ? config : null, errors };
}
