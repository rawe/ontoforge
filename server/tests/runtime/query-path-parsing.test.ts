/**
 * Query paths in the shared filter parser — a filter key that crosses
 * exactly one relation type and names a property of the related entity.
 * Resolution runs above the port against the lens-scoped schema: the
 * direction is derived from the relation type's endpoints or named by a
 * `:out`/`:in` marker on the relation segment — required on a
 * self-relation, checked against the derived direction elsewhere — the
 * value is coerced by the final property's data type, and every fault is
 * collected under its own filter key alongside the plain-property faults.
 */

import { describe, expect, it } from "vitest";

import { ValidationError } from "../../src/core/exceptions.js";
import { parseFilterConditions, validateSortField } from "../../src/runtime/service.js";
import type { SchemaCacheValue } from "../../src/runtime/schemaCache.js";
import { prop } from "../propertyDefs.js";

/** person -(works_for)-> company, department -(belongs_to)-> company. */
function scopedSchema(): SchemaCacheValue {
  return {
    lensId: "lens-1",
    lensKey: "full_lens",
    lensName: "Full Lens",
    lensDescription: null,
    entityTypes: {
      person: {
        key: "person",
        displayName: "Person",
        description: null,
        properties: { name: prop("name", "string"), age: prop("age", "integer") },
      },
      company: {
        key: "company",
        displayName: "Company",
        description: null,
        properties: {
          name: prop("name", "string"),
          founded: prop("founded", "date"),
          profile: prop("profile", "document"),
        },
      },
      department: {
        key: "department",
        displayName: "Department",
        description: null,
        properties: { name: prop("name", "string") },
      },
    },
    relationTypes: {
      works_for: {
        key: "works_for",
        displayName: "Works For",
        description: null,
        fromEntityTypeKey: "person",
        toEntityTypeKey: "company",
        properties: { role: prop("role", "string") },
      },
      belongs_to: {
        key: "belongs_to",
        displayName: "Belongs To",
        description: null,
        fromEntityTypeKey: "department",
        toEntityTypeKey: "company",
        properties: {},
      },
    },
  };
}

describe("a query path resolves to the port's path condition", () => {
  it("the listed type as the relation's source derives the outgoing direction", () => {
    const scoped = scopedSchema();
    const conditions = parseFilterConditions(
      { "works_for.name": "Acme" },
      scoped.entityTypes.person!.properties,
      "person",
      { pathSchema: scoped },
    );
    expect(conditions).toEqual([
      {
        kind: "path",
        relationTypeKey: "works_for",
        direction: "outgoing",
        propertySource: "relatedEntity",
        propertyKey: "name",
        dataType: "string",
        op: "eq",
        value: "Acme",
      },
    ]);
  });

  it("the listed type as the relation's target derives the incoming direction, the value coerced by the final property", () => {
    const scoped = scopedSchema();
    const conditions = parseFilterConditions(
      { "works_for.age__gt": "30" },
      scoped.entityTypes.company!.properties,
      "company",
      { pathSchema: scoped },
    );
    expect(conditions).toEqual([
      {
        kind: "path",
        relationTypeKey: "works_for",
        direction: "incoming",
        propertySource: "relatedEntity",
        propertyKey: "age",
        dataType: "integer",
        op: "gt",
        value: 30,
      },
    ]);
  });
});

describe("the relation-property form reads a property stored on the relation itself", () => {
  it("outgoing: persons by the role on their employment", () => {
    const scoped = scopedSchema();
    const conditions = parseFilterConditions(
      { "works_for@role": "CTO" },
      scoped.entityTypes.person!.properties,
      "person",
      { pathSchema: scoped },
    );
    expect(conditions).toEqual([
      {
        kind: "path",
        relationTypeKey: "works_for",
        direction: "outgoing",
        propertySource: "relation",
        propertyKey: "role",
        dataType: "string",
        op: "eq",
        value: "CTO",
      },
    ]);
  });

  it("incoming: companies by the start of an employment, the value coerced by the relation property", () => {
    const scoped = scopedSchema();
    scoped.relationTypes.works_for!.properties.since = prop("since", "date");
    const conditions = parseFilterConditions(
      { "works_for@since__lt": "2025-01-01" },
      scoped.entityTypes.company!.properties,
      "company",
      { pathSchema: scoped },
    );
    expect(conditions).toEqual([
      {
        kind: "path",
        relationTypeKey: "works_for",
        direction: "incoming",
        propertySource: "relation",
        propertyKey: "since",
        dataType: "date",
        op: "lt",
        value: "2025-01-01",
      },
    ]);
  });
});

/** The scoped schema plus the self-relation person -(manages)-> person,
 * carrying a `since` date. */
function selfRelationSchema(): SchemaCacheValue {
  const scoped = scopedSchema();
  scoped.relationTypes.manages = {
    key: "manages",
    displayName: "Manages",
    description: null,
    fromEntityTypeKey: "person",
    toEntityTypeKey: "person",
    properties: { since: prop("since", "date") },
  };
  return scoped;
}

/** Parse one filter on the listed type, expecting exactly one path condition. */
function resolveOne(
  filters: Record<string, string>,
  listedTypeKey: string,
  scoped: SchemaCacheValue,
): unknown {
  const conditions = parseFilterConditions(
    filters,
    scoped.entityTypes[listedTypeKey]!.properties,
    listedTypeKey,
    { pathSchema: scoped },
  );
  expect(conditions).toHaveLength(1);
  return conditions[0];
}

describe("a direction marker on the relation segment", () => {
  it("':out' on a self-relation follows it outgoing: persons who manage a Bob", () => {
    expect(resolveOne({ "manages:out.name": "Bob" }, "person", selfRelationSchema())).toEqual({
      kind: "path",
      relationTypeKey: "manages",
      direction: "outgoing",
      propertySource: "relatedEntity",
      propertyKey: "name",
      dataType: "string",
      op: "eq",
      value: "Bob",
    });
  });

  it("':in' on a self-relation follows it incoming, for the relation-property form too: persons managed since before 2020", () => {
    expect(
      resolveOne({ "manages:in@since__lt": "2020-01-01" }, "person", selfRelationSchema()),
    ).toEqual({
      kind: "path",
      relationTypeKey: "manages",
      direction: "incoming",
      propertySource: "relation",
      propertyKey: "since",
      dataType: "date",
      op: "lt",
      value: "2020-01-01",
    });
  });

  it("a marker that agrees with the derived direction is accepted on a non-self relation, in both forms", () => {
    expect(resolveOne({ "works_for:out.name": "Acme" }, "person", scopedSchema())).toMatchObject({
      relationTypeKey: "works_for",
      direction: "outgoing",
      propertySource: "relatedEntity",
    });
    expect(resolveOne({ "works_for:in@role": "CTO" }, "company", scopedSchema())).toMatchObject({
      relationTypeKey: "works_for",
      direction: "incoming",
      propertySource: "relation",
    });
  });
});

describe("existence on a query path resolves like a comparison path, minus the value", () => {
  it("the related-entity form: at least one related entity carrying — or lacking — the property", () => {
    const scoped = scopedSchema();
    expect(
      parseFilterConditions(
        { "works_for.founded__exists": "true", "works_for.founded__missing": "true" },
        scoped.entityTypes.person!.properties,
        "person",
        { pathSchema: scoped },
      ),
    ).toEqual([
      {
        kind: "path-existence",
        relationTypeKey: "works_for",
        direction: "outgoing",
        propertySource: "relatedEntity",
        propertyKey: "founded",
        exists: true,
      },
      {
        kind: "path-existence",
        relationTypeKey: "works_for",
        direction: "outgoing",
        propertySource: "relatedEntity",
        propertyKey: "founded",
        exists: false,
      },
    ]);
  });

  it("the relation-property form, incoming, with a marker", () => {
    const scoped = scopedSchema();
    expect(
      parseFilterConditions(
        { "works_for:in@role__missing": "true" },
        scoped.entityTypes.company!.properties,
        "company",
        { pathSchema: scoped },
      ),
    ).toEqual([
      {
        kind: "path-existence",
        relationTypeKey: "works_for",
        direction: "incoming",
        propertySource: "relation",
        propertyKey: "role",
        exists: false,
      },
    ]);
  });

  it("a path fault is reported before the flag is read", () => {
    const { message, fields } = reject({ "works_for.profile__exists": "maybe" }, "person");
    expect(message).toBe("Query path 'works_for.profile' ends in a document property");
    expect(Object.keys(fields)).toEqual(["works_for.profile__exists"]);
  });
});

describe("a bare relation type under an existence operator resolves to the relation existence condition", () => {
  it("the direction derives from the endpoints: outgoing from the source type", () => {
    const scoped = scopedSchema();
    expect(
      parseFilterConditions(
        { works_for__exists: "true", works_for__missing: "true" },
        scoped.entityTypes.person!.properties,
        "person",
        { pathSchema: scoped },
      ),
    ).toEqual([
      { kind: "relation-existence", relationTypeKey: "works_for", direction: "outgoing", exists: true },
      { kind: "relation-existence", relationTypeKey: "works_for", direction: "outgoing", exists: false },
    ]);
  });

  it("incoming from the target type, with or without an agreeing marker", () => {
    const scoped = scopedSchema();
    expect(
      parseFilterConditions(
        { works_for__missing: "true", "works_for:in__exists": "false" },
        scoped.entityTypes.company!.properties,
        "company",
        { pathSchema: scoped },
      ),
    ).toEqual([
      { kind: "relation-existence", relationTypeKey: "works_for", direction: "incoming", exists: false },
      { kind: "relation-existence", relationTypeKey: "works_for", direction: "incoming", exists: false },
    ]);
  });

  it("a property of the listed type wins over a relation type of the same key", () => {
    const scoped = scopedSchema();
    scoped.entityTypes.person!.properties.works_for = prop("works_for", "string");
    expect(
      parseFilterConditions(
        { works_for__exists: "true", "works_for:out__exists": "true" },
        scoped.entityTypes.person!.properties,
        "person",
        { pathSchema: scoped },
      ),
    ).toEqual([
      { kind: "property-existence", propertyKey: "works_for", exists: true },
      { kind: "relation-existence", relationTypeKey: "works_for", direction: "outgoing", exists: true },
    ]);
  });

  it("a self-relation needs the marker, naming both forms", () => {
    const scoped = scopedSchema();
    scoped.relationTypes.manages = {
      key: "manages",
      displayName: "Manages",
      description: null,
      fromEntityTypeKey: "person",
      toEntityTypeKey: "person",
      properties: {},
    };
    const { message, fields } = reject({ manages__missing: "true" }, "person", scoped);
    expect(message).toBe("Relation filter 'manages' needs a direction marker");
    expect(fields).toEqual({
      manages__missing:
        "'manages' connects 'person' to 'person', so the direction cannot be derived; " +
        "write 'manages:out' or 'manages:in'",
    });
    expect(
      parseFilterConditions(
        { "manages:in__missing": "true" },
        scoped.entityTypes.person!.properties,
        "person",
        { pathSchema: scoped },
      ),
    ).toEqual([
      { kind: "relation-existence", relationTypeKey: "manages", direction: "incoming", exists: false },
    ]);
  });

  it("a marker contradicting the derivable direction is rejected, naming the derived form", () => {
    const { message, fields } = reject({ "works_for:in__exists": "true" }, "person");
    expect(message).toBe("Relation filter 'works_for:in' contradicts the derivable direction");
    expect(fields["works_for:in__exists"]).toBe(
      "'works_for' connects 'person' to 'company', so from 'person' it is followed outgoing: " +
        "write 'works_for:out' or omit the marker",
    );
  });

  it("a relation type not touching the listed type, and one the lens hides, fail as on a path", () => {
    const { message } = reject({ belongs_to__exists: "true" }, "person");
    expect(message).toBe("Relation type 'belongs_to' does not touch entity type 'person'");
    const scoped = scopedSchema();
    delete scoped.entityTypes.company;
    const hidden = reject({ works_for__missing: "true" }, "person", scoped);
    expect(hidden.message).toBe("Unknown filter property or relation type: 'works_for'");
    expect(hidden.fields.works_for__missing).toBe(
      "Not defined in type 'person'. Property keys: age, name. " +
        "Relation types touching 'person': none",
    );
  });

  it("a subject that is neither a property nor a relation type is unknown, listing both", () => {
    const { message, fields } = reject({ ghost__exists: "true" }, "person");
    expect(message).toBe("Unknown filter property or relation type: 'ghost'");
    expect(fields.ghost__exists).toBe(
      "Not defined in type 'person'. Property keys: age, name. " +
        "Relation types touching 'person': works_for",
    );
  });

  it("a relation type under a comparison operator is rejected, naming what it takes", () => {
    const { message, fields } = reject({ works_for: "x", "works_for:out__ne": "y" }, "person");
    expect(message).toBe(
      "Relation type 'works_for' takes only an existence operator; " +
        "Relation type 'works_for:out' takes only an existence operator",
    );
    expect(fields.works_for).toBe(
      "'works_for' names a relation type; write 'works_for__exists' or 'works_for__missing' " +
        "with true or false, or a query path to one of its properties",
    );
  });

  it("the flag is read after the subject resolves", () => {
    const { message, fields } = reject({ works_for__exists: "sometimes" }, "person");
    expect(message).toBe("Invalid filter value for 'works_for'");
    expect(fields.works_for__exists).toBe("Expected boolean for 'works_for', got 'sometimes'");
  });
});

describe("a surface whose adapter cannot evaluate relation conditions rejects them after resolution", () => {
  const rejection = (key: string) => ({
    message: `Not here: '${key}'`,
    detail: "not here",
  });

  it("a resolved path, a path existence test and a relation existence test each raise the surface's fault", () => {
    const scoped = scopedSchema();
    try {
      parseFilterConditions(
        {
          "works_for.name": "Acme",
          "works_for@role__missing": "true",
          works_for__exists: "true",
          age: "3",
        },
        scoped.entityTypes.person!.properties,
        "person",
        { pathSchema: scoped, rejectRelationConditions: rejection },
      );
      expect.unreachable();
    } catch (error) {
      expect(error).toBeInstanceOf(ValidationError);
      expect((error as ValidationError).details).toEqual({
        fields: {
          "works_for.name": "not here",
          "works_for@role__missing": "not here",
          works_for__exists: "not here",
        },
      });
    }
  });

  it("a malformed key is still reported as malformed, and a property condition still crosses", () => {
    const scoped = scopedSchema();
    try {
      parseFilterConditions(
        { "ghost.name": "x" },
        scoped.entityTypes.person!.properties,
        "person",
        { pathSchema: scoped, rejectRelationConditions: rejection },
      );
      expect.unreachable();
    } catch (error) {
      expect((error as ValidationError).message).toBe(
        "Unknown filter property or relation type: 'ghost'",
      );
    }
    expect(
      parseFilterConditions({ age__missing: "true" }, scoped.entityTypes.person!.properties, "person", {
        pathSchema: scoped,
        rejectRelationConditions: rejection,
      }),
    ).toEqual([{ kind: "property-existence", propertyKey: "age", exists: false }]);
  });
});

/** Parse, expecting one collected rejection; returns its message and fields. */
function reject(
  filters: Record<string, string>,
  listedTypeKey: string,
  scoped: SchemaCacheValue = scopedSchema(),
): { message: string; fields: Record<string, string> } {
  try {
    parseFilterConditions(filters, scoped.entityTypes[listedTypeKey]!.properties, listedTypeKey, {
      pathSchema: scoped,
    });
  } catch (error) {
    expect(error).toBeInstanceOf(ValidationError);
    const { message, details } = error as ValidationError;
    return { message, fields: (details as { fields: Record<string, string> }).fields };
  }
  return expect.unreachable("expected a rejection");
}

describe("every path fault is collected under the filter key as sent", () => {
  it("an unknown first segment lists the listed type's property keys and the relation types touching it", () => {
    const { message, fields } = reject({ "ghost.name": "x" }, "person");
    expect(message).toBe("Unknown filter property or relation type: 'ghost'");
    expect(fields).toEqual({
      "ghost.name":
        "Not defined in type 'person'. Property keys: age, name. " +
        "Relation types touching 'person': works_for",
    });
  });

  it("a relation type whose related endpoint type the lens hides fails exactly as an unknown first segment", () => {
    // A lens may include a relation type without its endpoint types; the
    // hidden related type makes the path unresolvable and the relation
    // type absent from the candidates, byte for byte as if it did not exist.
    const scoped = scopedSchema();
    delete scoped.entityTypes.company;
    const { message, fields } = reject({ "works_for.name": "Acme" }, "person", scoped);
    expect(message).toBe("Unknown filter property or relation type: 'works_for'");
    expect(fields).toEqual({
      "works_for.name":
        "Not defined in type 'person'. Property keys: age, name. " +
        "Relation types touching 'person': none",
    });
  });

  it("a relation type that does not touch the listed type names both of its endpoints", () => {
    const { message, fields } = reject({ "belongs_to.name": "x" }, "person");
    expect(message).toBe("Relation type 'belongs_to' does not touch entity type 'person'");
    expect(fields).toEqual({
      "belongs_to.name":
        "'belongs_to' connects 'department' to 'company'. " +
        "Relation types touching 'person': works_for",
    });
  });

  it("a path through a self-relation without a marker names both marker forms", () => {
    const { message, fields } = reject({ "manages.name": "Bob" }, "person", selfRelationSchema());
    expect(message).toBe("Query path 'manages.name' needs a direction marker");
    expect(fields).toEqual({
      "manages.name":
        "'manages' connects 'person' to 'person', so the direction cannot be derived; " +
        "write 'manages:out.name' or 'manages:in.name'",
    });
  });

  it("an unknown property on the related entity type lists that type's property keys", () => {
    const { message, fields } = reject({ "works_for.ghost__gt": "1" }, "person");
    expect(message).toBe("Unknown filter property: 'ghost' on related entity type 'company'");
    expect(fields).toEqual({
      "works_for.ghost__gt": "Not defined in type 'company'. Property keys: founded, name, profile",
    });
  });

  it("an unknown property on the relation type lists that relation type's property keys", () => {
    const { message, fields } = reject({ "works_for@ghost": "x" }, "person");
    expect(message).toBe("Unknown filter property: 'ghost' on relation type 'works_for'");
    expect(fields).toEqual({
      "works_for@ghost": "Not defined in type 'works_for'. Property keys: role",
    });
  });

  it("more than one relation segment is rejected before anything is resolved, whichever separators it uses", () => {
    const { message, fields } = reject(
      { "works_for.belongs_to.name": "x", "works_for@role@x": "y", "works_for.name@role": "z" },
      "person",
    );
    expect(message).toBe(
      "Query path 'works_for.belongs_to.name' crosses more than one relation; " +
        "Query path 'works_for@role@x' crosses more than one relation; " +
        "Query path 'works_for.name@role' crosses more than one relation",
    );
    const hint =
      "A filter key may cross exactly one relation type: " +
      "<relationTypeKey>.<propertyKey> or <relationTypeKey>@<propertyKey>";
    expect(fields).toEqual({
      "works_for.belongs_to.name": hint,
      "works_for@role@x": hint,
      "works_for.name@role": hint,
    });
  });

  it("a relation-property path through a self-relation without a marker names both forms with '@'", () => {
    const { message, fields } = reject(
      { "manages@since__lt": "2020-01-01" },
      "person",
      selfRelationSchema(),
    );
    expect(message).toBe("Query path 'manages@since' needs a direction marker");
    expect(fields).toEqual({
      "manages@since__lt":
        "'manages' connects 'person' to 'person', so the direction cannot be derived; " +
        "write 'manages:out@since' or 'manages:in@since'",
    });
  });

  it("a marker that contradicts the derivable direction names the direction the schema allows", () => {
    const outgoing = reject({ "works_for:in.name": "Acme" }, "person");
    expect(outgoing.message).toBe("Query path 'works_for:in.name' contradicts the derivable direction");
    expect(outgoing.fields).toEqual({
      "works_for:in.name":
        "'works_for' connects 'person' to 'company', so from 'person' it is followed outgoing: " +
        "write 'works_for:out.name' or omit the marker",
    });

    const incoming = reject({ "works_for:out@role__contains": "c" }, "company");
    expect(incoming.message).toBe("Query path 'works_for:out@role' contradicts the derivable direction");
    expect(incoming.fields).toEqual({
      "works_for:out@role__contains":
        "'works_for' connects 'person' to 'company', so from 'company' it is followed incoming: " +
        "write 'works_for:in@role' or omit the marker",
    });
  });

  it("unknown marker text after the colon is part of an unknown first segment", () => {
    const { message, fields } = reject({ "manages:sideways.name": "x" }, "person", selfRelationSchema());
    expect(message).toBe("Unknown filter property or relation type: 'manages:sideways'");
    expect(fields).toEqual({
      "manages:sideways.name":
        "Not defined in type 'person'. Property keys: age, name. " +
        "Relation types touching 'person': manages, works_for",
    });
  });

  it("a recognised marker on an unknown relation type names the relation type key alone", () => {
    const { message } = reject({ "ghost:out.name": "x" }, "person");
    expect(message).toBe("Unknown filter property or relation type: 'ghost'");
  });

  it("a marker on a relation type that does not touch the listed type is the non-touching fault", () => {
    const { message } = reject({ "belongs_to:out.name": "x" }, "person");
    expect(message).toBe("Relation type 'belongs_to' does not touch entity type 'person'");
  });

  it("a value fault on a marked path names the path as sent", () => {
    const { message, fields } = reject({ "manages:out.age": "abc" }, "person", selfRelationSchema());
    expect(message).toBe("Invalid filter value for 'manages:out.age'");
    expect(Object.keys(fields)).toEqual(["manages:out.age"]);
  });

  it("a document-typed final property is rejected", () => {
    const { message, fields } = reject({ "works_for.profile__contains": "x" }, "person");
    expect(message).toBe("Query path 'works_for.profile' ends in a document property");
    expect(fields).toEqual({
      "works_for.profile__contains":
        "'profile' on 'company' is a document property; a query path cannot end in one",
    });
  });

  it("an uncoercible value and an unknown operator on a path read like the plain faults, naming the path", () => {
    const value = reject({ "works_for.founded": "not-a-date" }, "person");
    expect(value.message).toBe("Invalid filter value for 'works_for.founded'");
    expect(value.fields["works_for.founded"]).toContain("date");

    const op = reject({ "works_for.name__between": "x" }, "person");
    expect(op.message).toBe("Unknown filter operator: 'between'");
    expect(op.fields).toEqual({ "works_for.name__between": "Unsupported operator 'between'" });
  });

  it("path faults and plain faults are collected into one rejection", () => {
    const { message, fields } = reject(
      { "ghost.name": "x", age: "abc", "works_for.name": "Acme", name: "Alice" },
      "person",
    );
    expect(message).toBe(
      "Unknown filter property or relation type: 'ghost'; Invalid filter value for 'age'",
    );
    expect(Object.keys(fields)).toEqual(["ghost.name", "age"]);
  });
});

describe("surfaces that take no query paths", () => {
  it.each(["works_for.name", "works_for@role", "manages:out.name"])("a sort key that is a query path is rejected: %s", (sort) => {
    const scoped = scopedSchema();
    try {
      validateSortField(sort, scoped.entityTypes.person!.properties);
      expect.unreachable();
    } catch (error) {
      expect(error).toBeInstanceOf(ValidationError);
      expect((error as ValidationError).message).toBe("Sorting by query paths is not supported");
      expect((error as ValidationError).details).toEqual({
        fields: { sort: `'${sort}' is a query path; sorting by query paths is not supported` },
      });
    }
  });

  it("without a path schema a relation-property key is rejected as an entity-list-only feature", () => {
    const scoped = scopedSchema();
    try {
      parseFilterConditions(
        { "works_for@role": "CTO" },
        scoped.relationTypes.works_for!.properties,
        "works_for",
      );
      expect.unreachable();
    } catch (error) {
      expect(error).toBeInstanceOf(ValidationError);
      expect((error as ValidationError).message).toBe(
        "Query paths apply to entity lists only: 'works_for@role'",
      );
    }
  });

  it("without a path schema a path key is rejected as an entity-list-only feature", () => {
    const scoped = scopedSchema();
    try {
      parseFilterConditions(
        { "works_for.name": "Acme", role: "CTO" },
        scoped.relationTypes.works_for!.properties,
        "works_for",
      );
      expect.unreachable();
    } catch (error) {
      expect(error).toBeInstanceOf(ValidationError);
      expect((error as ValidationError).message).toBe(
        "Query paths apply to entity lists only: 'works_for.name'",
      );
      expect((error as ValidationError).details).toEqual({
        fields: {
          "works_for.name":
            "'works_for.name' is a query path; only a property key of 'works_for' can be filtered here",
        },
      });
    }
  });
});
