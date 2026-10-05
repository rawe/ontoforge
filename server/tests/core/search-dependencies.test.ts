/**
 * The dependency map: every row of the change table (spec §3.5) — entity
 * created, own field, header field, document, relation created / changed
 * / deleted, target field (fan-out), entity deleted — and that a property
 * no index reads causes nothing.
 */

import { describe, expect, it } from "vitest";

import type { SearchWritePlan } from "../../src/core/ports.js";
import {
  deriveSearchDependencies,
  planSearchWrite,
  type SearchDependencies,
} from "../../src/core/searchDependencies.js";
import { SearchIndexDefinition } from "../../src/core/searchIndex.js";
import { schema } from "./searchSchema.js";

const PEOPLE = "00000000-0000-4000-8000-000000000001";
const CITIES = "00000000-0000-4000-8000-000000000002";

function definition(key: string, parts: Record<string, unknown>): SearchIndexDefinition {
  return SearchIndexDefinition.parse({ key, name: key, description: key, entityType: "person", ...parts });
}

const dependencies: SearchDependencies = deriveSearchDependencies(
  [
    {
      searchIndexId: PEOPLE,
      definition: definition("people", {
        fields: ["email", "bio"],
        relations: [
          {
            relationType: "works_for",
            direction: "outgoing",
            fields: ["role"],
            target: { company: ["name"] },
          },
          {
            relationType: "knows",
            direction: "incoming",
            fields: [],
            target: { person: ["email"] },
            template: "{name} is known since {since} by {target.email}",
          },
        ],
      }),
    },
    {
      searchIndexId: CITIES,
      definition: SearchIndexDefinition.parse({
        key: "cities",
        name: "cities",
        description: "cities",
        entityType: "city",
        fields: ["name"],
      }),
    },
  ],
  schema,
);

function plan(change: Parameters<typeof planSearchWrite>[1]): SearchWritePlan | null {
  return planSearchWrite(dependencies, change);
}

const empty: SearchWritePlan = {
  entityParts: [],
  relationParts: [],
  fanOut: [],
  deleteEntity: null,
  deleteRelation: null,
};

describe("deriveSearchDependencies", () => {
  it("collects what each part reads", () => {
    const people = dependencies.indices.find((i) => i.key === "people")!;
    expect([...people.selfFields]).toEqual(["email"]);
    expect([...people.headerFields].sort()).toEqual(["name"]);
    expect(people.documentField).toBe("bio");
    expect(people.groups).toEqual([
      {
        groupNo: 0,
        relationType: "works_for",
        owner: "from",
        relationFields: new Set(["role"]),
        targetType: "company",
        targetFields: new Set(["name"]),
      },
      {
        groupNo: 1,
        relationType: "knows",
        owner: "to",
        relationFields: new Set(),
        targetType: "person",
        targetFields: new Set(["email"]),
      },
    ]);
  });

  it("skips an index whose root type is gone", () => {
    const derived = deriveSearchDependencies(
      [{ searchIndexId: PEOPLE, definition: definition("x", { entityType: "robot", fields: ["name"] }) }],
      schema,
    );
    expect(derived.indices).toEqual([]);
  });
});

describe("planSearchWrite", () => {
  it("entity of the root type created: all its parts", () => {
    expect(plan({ kind: "entityCreated", entityType: "person", entityId: "p1" })).toEqual({
      ...empty,
      entityParts: [{ searchIndexId: PEOPLE, entityId: "p1", partKind: "entity", groupNo: 0, partId: "" }],
    });
    expect(plan({ kind: "entityCreated", entityType: "company", entityId: "c1" })).toBeNull();
  });

  it("own field changed: the self part", () => {
    expect(
      plan({ kind: "entityUpdated", entityType: "person", entityId: "p1", changedKeys: ["email"] })?.entityParts,
    ).toEqual([{ searchIndexId: PEOPLE, entityId: "p1", partKind: "self", groupNo: 0, partId: "" }]);
  });

  it("header field changed: all its parts", () => {
    expect(
      plan({ kind: "entityUpdated", entityType: "person", entityId: "p1", changedKeys: ["name", "email"] })
        ?.entityParts,
    ).toEqual([{ searchIndexId: PEOPLE, entityId: "p1", partKind: "entity", groupNo: 0, partId: "" }]);
  });

  it("document changed: its passages", () => {
    expect(
      plan({ kind: "entityUpdated", entityType: "person", entityId: "p1", changedKeys: ["bio"] })?.entityParts,
    ).toEqual([{ searchIndexId: PEOPLE, entityId: "p1", partKind: "passage", groupNo: 0, partId: "" }]);
  });

  it("unlisted property changed: nothing", () => {
    expect(plan({ kind: "entityUpdated", entityType: "person", entityId: "p1", changedKeys: ["age"] })).toBeNull();
    expect(
      plan({ kind: "entityUpdated", entityType: "company", entityId: "c1", changedKeys: ["founded"] }),
    ).toBeNull();
  });

  it("relation of a grouped type created: its part on the owning end", () => {
    expect(plan({ kind: "relationCreated", relationType: "works_for", relationId: "r1" })).toEqual({
      ...empty,
      relationParts: [{ searchIndexId: PEOPLE, groupNo: 0, relationId: "r1", owner: "from" }],
    });
    // An incoming group: the relation's target owns the entry.
    expect(plan({ kind: "relationCreated", relationType: "knows", relationId: "r2" })?.relationParts).toEqual([
      { searchIndexId: PEOPLE, groupNo: 1, relationId: "r2", owner: "to" },
    ]);
    expect(plan({ kind: "relationCreated", relationType: "lives_in", relationId: "r3" })).toBeNull();
  });

  it("relation field in a group changed: that part; any other field: nothing", () => {
    expect(
      plan({ kind: "relationUpdated", relationType: "works_for", relationId: "r1", changedKeys: ["role"] })
        ?.relationParts,
    ).toEqual([{ searchIndexId: PEOPLE, groupNo: 0, relationId: "r1", owner: "from" }]);
    expect(
      plan({ kind: "relationUpdated", relationType: "works_for", relationId: "r1", changedKeys: ["since"] }),
    ).toBeNull();
  });

  it("relation deleted: its entries deleted directly", () => {
    expect(plan({ kind: "relationDeleted", relationType: "works_for", relationId: "r1" })).toEqual({
      ...empty,
      deleteRelation: "r1",
    });
    expect(plan({ kind: "relationDeleted", relationType: "lives_in", relationId: "r3" })).toBeNull();
  });

  it("target entity field in a group changed: fan-out over the relations pointing to it", () => {
    expect(
      plan({ kind: "entityUpdated", entityType: "company", entityId: "c1", changedKeys: ["name"] }),
    ).toEqual({
      ...empty,
      fanOut: [
        { searchIndexId: PEOPLE, groupNo: 0, relationType: "works_for", owner: "from", targetEntityId: "c1" },
      ],
    });
  });

  it("a person both root and target: self part plus fan-out of the incoming group", () => {
    const result = plan({ kind: "entityUpdated", entityType: "person", entityId: "p1", changedKeys: ["email"] });
    expect(result?.fanOut).toEqual([
      { searchIndexId: PEOPLE, groupNo: 1, relationType: "knows", owner: "to", targetEntityId: "p1" },
    ]);
  });

  it("a relation template naming an own field makes that field a header field", () => {
    const derived = deriveSearchDependencies(
      [
        {
          searchIndexId: PEOPLE,
          definition: definition("x", {
            fields: ["email", "age"],
            relations: [
              {
                relationType: "works_for",
                direction: "outgoing",
                fields: ["role"],
                template: "{name} ({age}) is {role}",
              },
            ],
          }),
        },
      ],
      schema,
    );
    expect(
      planSearchWrite(derived, { kind: "entityUpdated", entityType: "person", entityId: "p1", changedKeys: ["age"] })
        ?.entityParts.map((p) => p.partKind),
    ).toEqual(["entity"]);
  });

  it("entity deleted: its entries, when a root or target type", () => {
    expect(plan({ kind: "entityDeleted", entityType: "person", entityId: "p1" })).toEqual({
      ...empty,
      deleteEntity: "p1",
    });
    expect(plan({ kind: "entityDeleted", entityType: "company", entityId: "c1" })?.deleteEntity).toBe("c1");
    const none = deriveSearchDependencies([], schema);
    expect(planSearchWrite(none, { kind: "entityDeleted", entityType: "person", entityId: "p1" })).toBeNull();
  });
});
