/**
 * The pure `prepare…` of the six stageable writes, without a store: the
 * coercion and collected field errors, the defaults from the FULL schema,
 * the document lengths, the parent relation's orientation and faults, the
 * no-op update, and the dropped relation endpoint keys. Each result is the
 * exact arguments of the store call plus its search change.
 */

import { describe, expect, it } from "vitest";

import { NotFoundError } from "../../src/core/exceptions.js";
import {
  prepareCreateEntity,
  prepareCreateRelation,
  prepareDeleteEntity,
  prepareDeleteRelation,
  prepareUpdateEntity,
  prepareUpdateRelation,
} from "../../src/runtime/prepare.js";
import { docLengthKey } from "../../src/runtime/readHelpers.js";
import { applyScopeFiltering, buildSchemaCacheFromRaw, type LoadedSchema } from "../../src/runtime/schemaCache.js";

type Row = Record<string, unknown>;

const IDS = { entityId: "ent-new", relationId: "rel-new" };

function prop(key: string, dataType: string, required = false, defaultValue: string | null = null): Row {
  return { key, displayName: key, dataType, required, defaultValue };
}

/**
 * project › note over `has_note` (the source is the parent), note ›
 * project over `filed_in` (the target is the parent), and the ordinary
 * `links`. The lens `ops` hides `note.secret` and `has_note.audit`; both
 * carry a default. `note.broken` has a default that fails coercion.
 */
function loaded(): LoadedSchema {
  const entityTypes = [
    {
      key: "project",
      displayName: "Project",
      nameProperty: "name",
      properties: [prop("name", "string", true)],
    },
    {
      key: "note",
      displayName: "Note",
      nameProperty: "name",
      properties: [
        prop("name", "string", true),
        prop("size", "integer"),
        prop("status", "string", false, "open"),
        prop("body", "document"),
        prop("secret", "string", false, "hidden-default"),
        prop("broken", "integer", false, "not-a-number"),
      ],
    },
  ];
  const relationTypes = [
    {
      key: "has_note",
      displayName: "Has note",
      sourceKey: "project",
      targetKey: "note",
      parent: "source",
      properties: [prop("phase", "string", true), prop("weight", "integer", false, "1"), prop("audit", "string", false, "x")],
    },
    {
      key: "filed_in",
      displayName: "Filed in",
      sourceKey: "note",
      targetKey: "project",
      parent: "target",
      properties: [],
    },
    {
      key: "links",
      displayName: "Links",
      sourceKey: "note",
      targetKey: "note",
      properties: [prop("label", "string"), prop("rank", "integer", false, "5")],
    },
  ];
  const full = buildSchemaCacheFromRaw({ lensId: "l1", key: "ops", name: "Ops" }, entityTypes, relationTypes);
  const scoped = applyScopeFiltering(
    full,
    [
      { key: "project", properties: null },
      { key: "note", properties: ["name", "size", "status", "body", "broken"] },
    ],
    [
      { key: "has_note", properties: ["phase", "weight"] },
      { key: "filed_in", properties: null },
      { key: "links", properties: null },
    ],
  );
  return { scoped, full, agentConfigs: {}, savedQueries: {}, searchIndexScope: { scoped: true, includedIndices: [] } };
}

const fullDefs = (schema: LoadedSchema, type: string) => schema.full.entityTypes[type]!.properties;

describe("prepareCreateEntity", () => {
  it("coerces, applies defaults from the full schema, and skips a default that fails coercion", () => {
    const schema = loaded();
    const { errors, write } = prepareCreateEntity(schema, "note", { name: 7, size: "42" }, null, IDS);

    expect(errors).toEqual({});
    expect(write.parent).toBeNull();
    expect(write.entity).toEqual({
      entityTypeKey: "note",
      entityId: "ent-new",
      // `secret` is hidden by the lens but has a default; `broken` is skipped.
      properties: { name: "7", size: 42, status: "open", secret: "hidden-default" },
      propertyDefs: fullDefs(schema, "note"),
      change: { kind: "entityCreated", entityType: "note", entityId: "ent-new" },
    });
  });

  it("stores the code-point length of a document value beside it", () => {
    const { write } = prepareCreateEntity(loaded(), "note", { name: "n", body: "héllo 😀" }, null, IDS);

    expect(write.entity.properties.body).toBe("héllo 😀");
    expect(write.entity.properties[docLengthKey("body")]).toBe(7);
  });

  it("collects every field error, a hidden property being unknown", () => {
    const { errors } = prepareCreateEntity(loaded(), "note", { size: "many", secret: "s" }, null, IDS);

    expect(errors).toEqual({
      secret: "Unknown property: not defined in type 'note'",
      name: "Required property missing",
      size: "Expected integer for 'size', got 'many'",
    });
  });

  it("orients a parent relation whose source is the parent, with its own defaults", () => {
    const schema = loaded();
    const { errors, write } = prepareCreateEntity(
      schema,
      "note",
      { name: "n" },
      { type: "has_note", parentId: "p1", properties: { phase: "build" } },
      IDS,
    );

    expect(errors).toEqual({});
    expect(write.parent).toEqual({
      relation: {
        relationTypeKey: "has_note",
        relationId: "rel-new",
        fromEntityId: "p1",
        toEntityId: "ent-new",
        // `audit` is hidden by the lens, its default applied.
        properties: { phase: "build", weight: 1, audit: "x" },
        propertyDefs: schema.full.relationTypes.has_note!.properties,
        change: { kind: "relationCreated", relationType: "has_note", relationId: "rel-new" },
      },
      parentId: "p1",
      parentType: "project",
    });
  });

  it("orients a parent relation whose target is the parent", () => {
    const { write } = prepareCreateEntity(loaded(), "note", { name: "n" }, { type: "filed_in", parentId: "p1" }, IDS);

    expect(write.parent?.relation.fromEntityId).toBe("ent-new");
    expect(write.parent?.relation.toEntityId).toBe("p1");
    expect(write.parent?.parentType).toBe("project");
  });

  it("reports the parent relation's faults under parentRelation.*, after the entity's", () => {
    const schema = loaded();
    const cases: [Row, Row][] = [
      [{ type: "nope", parentId: "p1" }, { "parentRelation.type": "Relation type 'nope' not found" }],
      [{ type: "links", parentId: "p1" }, { "parentRelation.type": "Relation type 'links' is not a parent relation" }],
    ];
    for (const [input, expected] of cases) {
      const { errors, write } = prepareCreateEntity(
        schema,
        "note",
        { name: "n" },
        input as { type: string; parentId: string },
        IDS,
      );
      expect(errors).toEqual(expected);
      expect(write.parent).toBeNull();
    }

    const wrongChild = prepareCreateEntity(schema, "project", { name: "p" }, { type: "has_note", parentId: "p1" }, IDS);
    expect(wrongChild.errors).toEqual({
      "parentRelation.properties.phase": "Required property missing",
      "parentRelation.type": "Relation type 'has_note' places 'note' under a parent, not 'project'",
    });
    expect(wrongChild.write.parent).toBeNull();

    // A property fault keeps the relation, so the caller still checks the parent end.
    const { errors, write } = prepareCreateEntity(
      schema,
      "note",
      { size: "x" },
      { type: "has_note", parentId: "p1", properties: { audit: "a" } },
      IDS,
    );
    expect(Object.keys(errors)).toEqual([
      "name",
      "size",
      "parentRelation.properties.audit",
      "parentRelation.properties.phase",
    ]);
    expect(write.parent?.parentId).toBe("p1");
  });

  it("refuses an entity type the lens does not show", () => {
    const schema = loaded();
    delete schema.scoped.entityTypes.project;
    expect(() => prepareCreateEntity(schema, "project", {}, null, IDS)).toThrow(
      new NotFoundError("Entity type 'project' not found"),
    );
  });
});

describe("prepareUpdateEntity", () => {
  it("splits set and remove, re-applies no default, and names the changed keys", () => {
    const schema = loaded();
    const { errors, write } = prepareUpdateEntity(schema, "note", "n1", { size: "3", status: null });

    expect(errors).toEqual({});
    expect(write).toEqual({
      entityTypeKey: "note",
      entityId: "n1",
      setProperties: { size: 3 },
      removeProperties: ["status"],
      propertyDefs: fullDefs(schema, "note"),
      change: { kind: "entityUpdated", entityType: "note", entityId: "n1", changedKeys: ["size", "status"] },
    });
  });

  it("sets the length of a changed document value and removes it with the value", () => {
    const set = prepareUpdateEntity(loaded(), "note", "n1", { body: "abc" });
    expect(set.write?.setProperties).toEqual({ body: "abc", [docLengthKey("body")]: 3 });
    expect(set.write?.removeProperties).toEqual([]);

    const removed = prepareUpdateEntity(loaded(), "note", "n1", { body: null });
    expect(removed.write?.setProperties).toEqual({});
    expect(removed.write?.removeProperties).toEqual(["body", docLengthKey("body")]);
  });

  it("is a no-op when the payload changes nothing", () => {
    expect(prepareUpdateEntity(loaded(), "note", "n1", {})).toEqual({ errors: {}, write: null });
  });

  it("collects the field errors, refusing null on a required property", () => {
    const { errors, write } = prepareUpdateEntity(loaded(), "note", "n1", { name: null, secret: "s" });
    expect(errors).toEqual({
      secret: "Unknown property: not defined in type 'note'",
      name: "Cannot set required property to null",
    });
    expect(write).toBeNull();
  });
});

describe("prepareDeleteEntity", () => {
  it("names the store call and its search change", () => {
    expect(prepareDeleteEntity(loaded(), "note", "n1")).toEqual({
      entityTypeKey: "note",
      entityId: "n1",
      change: { kind: "entityDeleted", entityType: "note", entityId: "n1" },
    });
  });

  it("refuses an unknown entity type", () => {
    expect(() => prepareDeleteEntity(loaded(), "nope", "n1")).toThrow(new NotFoundError("Entity type 'nope' not found"));
  });
});

describe("prepareCreateRelation", () => {
  it("coerces, applies defaults from the full schema, and keeps the ends as given", () => {
    const schema = loaded();
    const { errors, write } = prepareCreateRelation(schema, "has_note", "p1", "n1", { phase: 5 }, "rel-new");

    expect(errors).toEqual({});
    expect(write).toEqual({
      relationTypeKey: "has_note",
      relationId: "rel-new",
      fromEntityId: "p1",
      toEntityId: "n1",
      properties: { phase: "5", weight: 1, audit: "x" },
      propertyDefs: schema.full.relationTypes.has_note!.properties,
      change: { kind: "relationCreated", relationType: "has_note", relationId: "rel-new" },
    });
  });

  it("collects the property errors", () => {
    const { errors } = prepareCreateRelation(loaded(), "has_note", "p1", "n1", { weight: "w", audit: "a" }, "r");
    expect(errors).toEqual({
      audit: "Unknown property: not defined in type 'has_note'",
      phase: "Required property missing",
      weight: "Expected integer for 'weight', got 'w'",
    });
  });

  it("refuses a relation type the lens does not show", () => {
    expect(() => prepareCreateRelation(loaded(), "nope", "a", "b", {}, "r")).toThrow(
      new NotFoundError("Relation type 'nope' not found"),
    );
  });
});

describe("prepareUpdateRelation", () => {
  it("drops the endpoint keys silently and applies the rest", () => {
    const schema = loaded();
    const { errors, write } = prepareUpdateRelation(schema, "links", "r1", {
      fromEntityId: "x",
      toEntityId: "y",
      label: "see also",
      rank: null,
    });

    expect(errors).toEqual({});
    expect(write).toEqual({
      relationTypeKey: "links",
      relationId: "r1",
      setProperties: { label: "see also" },
      removeProperties: ["rank"],
      propertyDefs: schema.full.relationTypes.links!.properties,
      change: { kind: "relationUpdated", relationType: "links", relationId: "r1", changedKeys: ["label", "rank"] },
    });
  });

  it("is a no-op when only endpoint keys are sent", () => {
    expect(prepareUpdateRelation(loaded(), "links", "r1", { fromEntityId: "x", toEntityId: "y" })).toEqual({
      errors: {},
      write: null,
    });
  });

  it("collects the property errors", () => {
    const { errors } = prepareUpdateRelation(loaded(), "has_note", "r1", { phase: null, audit: "a" });
    expect(errors).toEqual({
      audit: "Unknown property: not defined in type 'has_note'",
      phase: "Cannot set required property to null",
    });
  });
});

describe("prepareDeleteRelation", () => {
  it("names the store call and its search change", () => {
    expect(prepareDeleteRelation(loaded(), "links", "r1")).toEqual({
      relationTypeKey: "links",
      relationId: "r1",
      change: { kind: "relationDeleted", relationType: "links", relationId: "r1" },
    });
  });

  it("refuses an unknown relation type", () => {
    expect(() => prepareDeleteRelation(loaded(), "nope", "r1")).toThrow(new NotFoundError("Relation type 'nope' not found"));
  });
});
