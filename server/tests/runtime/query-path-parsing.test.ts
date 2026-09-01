/**
 * Query paths in the shared filter parser — a filter key that crosses
 * exactly one relation type and names a property of the related entity.
 * Resolution runs above the port against the lens-scoped schema: the
 * direction is derived from the relation type's endpoints, the value is
 * coerced by the final property's data type, and every fault is collected
 * under its own filter key alongside the plain-property faults.
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

  it("a path through a self-relation is ambiguous", () => {
    const scoped = scopedSchema();
    scoped.relationTypes.manages = {
      key: "manages",
      displayName: "Manages",
      description: null,
      fromEntityTypeKey: "person",
      toEntityTypeKey: "person",
      properties: {},
    };
    const { message, fields } = reject({ "manages.name": "Bob" }, "person", scoped);
    expect(message).toBe("Query path 'manages.name' is ambiguous");
    expect(fields).toEqual({
      "manages.name":
        "'manages' connects 'person' to 'person', so the direction cannot be derived",
    });
  });

  it("an unknown property on the related entity type lists that type's property keys", () => {
    const { message, fields } = reject({ "works_for.ghost__gt": "1" }, "person");
    expect(message).toBe("Unknown filter property: 'ghost' on related entity type 'company'");
    expect(fields).toEqual({
      "works_for.ghost__gt": "Not defined in type 'company'. Property keys: founded, name, profile",
    });
  });

  it("more than one relation segment is rejected before anything is resolved", () => {
    const { message, fields } = reject({ "works_for.belongs_to.name": "x" }, "person");
    expect(message).toBe("Query path 'works_for.belongs_to.name' crosses more than one relation");
    expect(fields).toEqual({
      "works_for.belongs_to.name":
        "A filter key may cross exactly one relation type: <relationTypeKey>.<propertyKey>",
    });
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
  it("a sort key that is a query path is rejected", () => {
    const scoped = scopedSchema();
    try {
      validateSortField("works_for.name", scoped.entityTypes.person!.properties);
      expect.unreachable();
    } catch (error) {
      expect(error).toBeInstanceOf(ValidationError);
      expect((error as ValidationError).message).toBe("Sorting by query paths is not supported");
      expect((error as ValidationError).details).toEqual({
        fields: { sort: "'works_for.name' is a query path; sorting by query paths is not supported" },
      });
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
