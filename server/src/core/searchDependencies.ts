/**
 * The dependency map: which search work an entity or relation write
 * causes, derived from an ontology's index definitions and its schema.
 *
 * Pure — no storage, no I/O. The runtime caches the map with the schema
 * (`runtime/schemaCache.ts`) and turns every write into a
 * `SearchWritePlan` the adapter applies in the write's transaction:
 *
 * | Change | Work, for each index that reads it |
 * |---|---|
 * | entity of the root type created | all its parts (`entity`) |
 * | own field changed | `self`; a header field: all its parts |
 * | document changed | its passages (re-chunked) |
 * | relation of a grouped type created | that relation's part, on the owning end |
 * | relation field in a group changed | that relation's part |
 * | relation deleted | its entries deleted, no recompose |
 * | target entity field in a group changed | the parts of every relation of the type pointing to it |
 * | entity deleted | its entries and queued work deleted |
 *
 * A property no index reads causes nothing. "Header" covers what every
 * relation and passage part renders of the entity: the effective header,
 * and the own fields a relation template names.
 */

import type { SearchQueuePartKind, SearchWritePlan } from "./ports.js";
import {
  documentField,
  groupTargetFields,
  groupTargetType,
  headerFields,
  ownTextFields,
  templatePlaceholders,
} from "./searchComposition.js";
import type { SearchIndexDefinition, SearchIndexSchema } from "./searchIndex.js";

/** What one relation group of one index reads. */
export interface GroupDependency {
  groupNo: number;
  relationType: string;
  /** Which end of the relation owns the entry: the root's end. */
  owner: "from" | "to";
  relationFields: ReadonlySet<string>;
  /** The entity type on the other end. */
  targetType: string;
  targetFields: ReadonlySet<string>;
}

/** What one index reads. */
export interface IndexDependency {
  searchIndexId: string;
  key: string;
  entityType: string;
  /** Own fields the `self` part reads. */
  selfFields: ReadonlySet<string>;
  /** Own fields every part reads (the header, relation-template names). */
  headerFields: ReadonlySet<string>;
  documentField: string | null;
  groups: GroupDependency[];
}

export interface SearchDependencies {
  indices: IndexDependency[];
}

/** The input of the map: each stored index's id and definition. */
export interface IndexedDefinition {
  searchIndexId: string;
  definition: SearchIndexDefinition;
}

/** Derive the map from every index of an ontology and its full schema.
 * An index whose root type is gone reads nothing. */
export function deriveSearchDependencies(
  indices: IndexedDefinition[],
  schema: SearchIndexSchema,
): SearchDependencies {
  const derived: IndexDependency[] = [];
  for (const { searchIndexId, definition } of indices) {
    const root = schema.entityTypes[definition.entityType];
    if (root === undefined) continue;
    const own = new Set([...ownTextFields(definition, schema), ...headerFields(definition, schema)]);
    const fields = ownTextFields(definition, schema);
    const selfFields = new Set(fields);
    for (const { field, target } of templatePlaceholders(definition.semantic.template)) {
      if (!target && own.has(field)) selfFields.add(field);
    }
    const header = new Set(headerFields(definition, schema));
    const groups: GroupDependency[] = [];
    definition.relations.forEach((group, groupNo) => {
      const targetType = groupTargetType(definition, groupNo, schema);
      if (targetType === null) return;
      const relationFields = new Set(group.fields);
      for (const { field, target } of templatePlaceholders(group.template)) {
        if (!target && !relationFields.has(field) && own.has(field)) header.add(field);
      }
      groups.push({
        groupNo,
        relationType: group.relationType,
        owner: group.direction === "outgoing" ? "from" : "to",
        relationFields,
        targetType,
        targetFields: new Set(groupTargetFields(definition, groupNo, schema)),
      });
    });
    derived.push({
      searchIndexId,
      key: definition.key,
      entityType: definition.entityType,
      selfFields,
      headerFields: header,
      documentField: documentField(definition, schema),
      groups,
    });
  }
  return { indices: derived };
}

/** One write, as the dependency map sees it. Changed keys are the
 * properties the write set or removed. */
export type SearchChange =
  | { kind: "entityCreated"; entityType: string; entityId: string }
  | { kind: "entityUpdated"; entityType: string; entityId: string; changedKeys: string[] }
  | { kind: "entityDeleted"; entityType: string; entityId: string }
  | { kind: "relationCreated"; relationType: string; relationId: string }
  | { kind: "relationUpdated"; relationType: string; relationId: string; changedKeys: string[] }
  | { kind: "relationDeleted"; relationType: string; relationId: string };

/** The work one write causes; null when it causes none. */
export function planSearchWrite(
  dependencies: SearchDependencies,
  change: SearchChange,
): SearchWritePlan | null {
  const plan: SearchWritePlan = {
    entityParts: [],
    relationParts: [],
    fanOut: [],
    deleteEntity: null,
    deleteRelation: null,
  };
  const entityPart = (index: IndexDependency, entityId: string, partKind: SearchQueuePartKind) =>
    plan.entityParts.push({ searchIndexId: index.searchIndexId, entityId, partKind, groupNo: 0, partId: "" });

  for (const index of dependencies.indices) {
    switch (change.kind) {
      case "entityCreated":
        if (index.entityType === change.entityType) entityPart(index, change.entityId, "entity");
        break;

      case "entityUpdated": {
        const changed = new Set(change.changedKeys);
        const touches = (fields: ReadonlySet<string>) => [...fields].some((key) => changed.has(key));
        if (index.entityType === change.entityType) {
          if (touches(index.headerFields)) {
            entityPart(index, change.entityId, "entity");
          } else {
            if (touches(index.selfFields)) entityPart(index, change.entityId, "self");
            if (index.documentField !== null && changed.has(index.documentField)) {
              entityPart(index, change.entityId, "passage");
            }
          }
        }
        for (const group of index.groups) {
          if (group.targetType === change.entityType && touches(group.targetFields)) {
            plan.fanOut.push({
              searchIndexId: index.searchIndexId,
              groupNo: group.groupNo,
              relationType: group.relationType,
              owner: group.owner,
              targetEntityId: change.entityId,
            });
          }
        }
        break;
      }

      case "entityDeleted":
        if (
          index.entityType === change.entityType ||
          index.groups.some((group) => group.targetType === change.entityType)
        ) {
          plan.deleteEntity = change.entityId;
        }
        break;

      case "relationCreated":
      case "relationUpdated":
        for (const group of index.groups) {
          if (group.relationType !== change.relationType) continue;
          if (
            change.kind === "relationUpdated" &&
            !change.changedKeys.some((key) => group.relationFields.has(key))
          ) {
            continue;
          }
          plan.relationParts.push({
            searchIndexId: index.searchIndexId,
            groupNo: group.groupNo,
            relationId: change.relationId,
            owner: group.owner,
          });
        }
        break;

      case "relationDeleted":
        if (index.groups.some((group) => group.relationType === change.relationType)) {
          plan.deleteRelation = change.relationId;
        }
        break;
    }
  }

  const empty =
    plan.entityParts.length === 0 &&
    plan.relationParts.length === 0 &&
    plan.fanOut.length === 0 &&
    plan.deleteEntity === null &&
    plan.deleteRelation === null;
  return empty ? null : plan;
}
