/**
 * Search index definitions: wire-format parsing, validation against the
 * schema, the header default, the managed definitions and the definition
 * hash, and the cascade a schema removal applies to custom indices.
 */

import { describe, expect, it } from "vitest";

import {
  cascadeIndexKeys,
  definitionHash,
  deriveManagedIndices,
  effectiveHeader,
  isManagedIndexKey,
  managedIndexDescription,
  managedIndexKey,
  planSearchIndexCascade,
  SearchIndexDefinition,
  type SearchIndexSchema,
  validateSearchIndex,
} from "../../src/core/searchIndex.js";
import { KEY_PATTERN } from "../../src/core/schemas.js";

type Props = Record<string, { key: string; displayName: string; dataType: string }>;

function props(...specs: [string, string][]): Props {
  const out: Props = {};
  for (const [key, dataType] of specs) {
    out[key] = { key, displayName: key[0]!.toUpperCase() + key.slice(1), dataType };
  }
  return out;
}

const schema: SearchIndexSchema = {
  entityTypes: {
    person: {
      key: "person",
      displayName: "Person",
      nameProperty: "name",
      properties: props(
        ["name", "string"],
        ["email", "string"],
        ["age", "integer"],
        ["born", "date"],
        ["bio", "document"],
        ["notes", "document"],
      ),
    },
    company: {
      key: "company",
      displayName: "Company",
      nameProperty: "name",
      properties: props(["name", "string"], ["founded", "integer"], ["profile", "document"]),
    },
    city: {
      key: "city",
      displayName: "City",
      nameProperty: "name",
      properties: props(["name", "string"]),
    },
  },
  relationTypes: {
    works_for: {
      key: "works_for",
      displayName: "Works for",
      fromEntityTypeKey: "person",
      toEntityTypeKey: "company",
      properties: props(["role", "string"], ["since", "integer"], ["contract", "document"]),
    },
    knows: {
      key: "knows",
      displayName: "Knows",
      fromEntityTypeKey: "person",
      toEntityTypeKey: "person",
      properties: props(["since", "integer"]),
    },
    located_in: {
      key: "located_in",
      displayName: "Located in",
      fromEntityTypeKey: "company",
      toEntityTypeKey: "city",
      properties: {},
    },
  },
};

function define(overrides: Record<string, unknown> = {}): SearchIndexDefinition {
  return SearchIndexDefinition.parse({
    key: "person_employment",
    name: "People by employment",
    description: "People with their roles at companies.",
    entityType: "person",
    fields: ["name", "email"],
    ...overrides,
  });
}

const group = (overrides: Record<string, unknown> = {}) => ({
  relationType: "works_for",
  direction: "outgoing",
  fields: ["role"],
  target: { company: ["name"] },
  ...overrides,
});

const paths = (definition: SearchIndexDefinition) =>
  validateSearchIndex(definition, schema).map((i) => i.path);

describe("SearchIndexDefinition (wire format)", () => {
  it("parses the spec example unchanged", () => {
    const example = {
      key: "person_employment",
      name: "People by employment",
      description: "People with their roles at companies and since when.",
      entityType: "person",
      fields: ["name", "email", "bio"],
      header: ["name"],
      relations: [
        {
          relationType: "works_for",
          direction: "outgoing",
          fields: ["role", "since"],
          target: { company: ["name", "founded"] },
          label: "Employment",
          template: null,
        },
      ],
      semantic: { enabled: true, template: null },
      keyword: { enabled: true },
    };
    expect(SearchIndexDefinition.parse(example)).toEqual(example);
  });

  it("applies defaults: no header (name property), both representations, empty lists", () => {
    const parsed = SearchIndexDefinition.parse({
      key: "people",
      name: "People",
      description: "All people.",
      entityType: "person",
      relations: [{ relationType: "works_for", direction: "incoming" }],
    });
    expect(parsed).toEqual({
      key: "people",
      name: "People",
      description: "All people.",
      entityType: "person",
      fields: [],
      header: null,
      relations: [
        {
          relationType: "works_for",
          direction: "incoming",
          fields: [],
          target: {},
          label: null,
          template: null,
        },
      ],
      semantic: { enabled: true, template: null },
      keyword: { enabled: true },
    });
  });

  it("requires a description that is not blank, saying why", () => {
    const base = { key: "people", name: "People", entityType: "person" };
    expect(SearchIndexDefinition.safeParse(base).success).toBe(false);
    for (const description of ["", "   \n\t"]) {
      const parsed = SearchIndexDefinition.safeParse({ ...base, description });
      expect(parsed.success).toBe(false);
      expect(parsed.error!.issues).toEqual([
        expect.objectContaining({
          path: ["description"],
          message: "Describe what the index finds — agents choose indices by it.",
        }),
      ]);
    }
    expect(SearchIndexDefinition.safeParse({ ...base, description: "x" }).success).toBe(true);
  });

  it("requires a name that is not blank", () => {
    const base = { key: "people", description: "People by name", entityType: "person" };
    for (const name of ["", "  \t"]) {
      const parsed = SearchIndexDefinition.safeParse({ ...base, name });
      expect(parsed.success).toBe(false);
      expect(parsed.error!.issues).toEqual([
        expect.objectContaining({ path: ["name"], message: "Name the index." }),
      ]);
    }
    expect(SearchIndexDefinition.safeParse({ ...base, name: "P" }).success).toBe(true);
  });

  it("rejects keys outside the shared key rules, managed keys included", () => {
    const base = { name: "People", description: "x", entityType: "person" };
    for (const key of ["person~default", "Person", "1st", "a-b", "x".repeat(65)]) {
      expect(SearchIndexDefinition.safeParse({ ...base, key }).success).toBe(false);
    }
    expect(SearchIndexDefinition.safeParse({ ...base, key: "x".repeat(64) }).success).toBe(true);
  });

  it("rejects an unknown direction", () => {
    const result = SearchIndexDefinition.safeParse({
      key: "people",
      name: "People",
      description: "x",
      entityType: "person",
      relations: [{ relationType: "works_for", direction: "both" }],
    });
    expect(result.success).toBe(false);
  });
});

describe("validateSearchIndex", () => {
  it("accepts a valid index with a document, header and relation groups", () => {
    const definition = define({
      fields: ["name", "age", "born", "bio"],
      header: ["name", "age"],
      relations: [group(), group({ relationType: "knows", fields: ["since"], target: { person: ["name"] } })],
    });
    expect(validateSearchIndex(definition, schema)).toEqual([]);
  });

  it("reports issues as dotted paths with messages", () => {
    expect(validateSearchIndex(define({ fields: ["nope"] }), schema)).toEqual([
      { path: "fields.0", message: "Property 'nope' does not exist on entity type 'person'" },
    ]);
  });

  describe("rule 1 — types exist and connect the root", () => {
    it("rejects an unknown root entity type", () => {
      expect(paths(define({ entityType: "robot" }))).toEqual(["entityType"]);
    });

    it("rejects an unknown relation type", () => {
      expect(paths(define({ relations: [group({ relationType: "owns" })] }))).toEqual([
        "relations.0.relationType",
      ]);
    });

    it("rejects a relation type that does not connect the root in the given direction", () => {
      expect(paths(define({ relations: [group({ direction: "incoming" })] }))).toEqual([
        "relations.0.direction",
      ]);
      expect(
        paths(define({ relations: [group({ relationType: "located_in", target: { city: ["name"] } })] })),
      ).toEqual(["relations.0.direction"]);
    });

    it("accepts an incoming group from the target side", () => {
      const definition = define({
        entityType: "company",
        fields: ["name"],
        relations: [group({ direction: "incoming", target: { person: ["name", "email"] } })],
      });
      expect(validateSearchIndex(definition, schema)).toEqual([]);
    });

    it("rejects a target key that is not the other end's entity type", () => {
      expect(
        paths(define({ relations: [group({ target: { city: ["name"], robot: ["name"] } })] })),
      ).toEqual(["relations.0.target.city", "relations.0.target.robot"]);
    });
  });

  describe("rule 2 — fields exist on their owner", () => {
    it("checks own, relation and target fields", () => {
      const definition = define({
        fields: ["name", "x"],
        relations: [group({ fields: ["role", "y"], target: { company: ["name", "z"] } })],
      });
      expect(paths(definition)).toEqual([
        "fields.1",
        "relations.0.fields.1",
        "relations.0.target.company.1",
      ]);
    });

    it("rejects duplicate fields in every list", () => {
      const definition = define({
        fields: ["name", "name"],
        header: ["email", "email"],
        relations: [group({ fields: ["role", "role"], target: { company: ["name", "name"] } })],
      });
      expect(paths(definition)).toEqual([
        "fields.1",
        "header.1",
        "relations.0.fields.1",
        "relations.0.target.company.1",
      ]);
    });

    it("requires header fields to be own fields of the root", () => {
      expect(paths(define({ header: ["role"] }))).toEqual(["header.0"]);
    });

    it("needs at least one field or relation group", () => {
      expect(paths(define({ fields: [] }))).toEqual(["fields"]);
      expect(paths(define({ fields: [], relations: [group()] }))).toEqual([]);
    });

    it("needs a relation or target field in every group", () => {
      expect(paths(define({ relations: [group({ fields: [], target: {} })] }))).toEqual([
        "relations.0",
      ]);
      expect(paths(define({ relations: [group({ fields: [], target: { company: [] } })] }))).toEqual([
        "relations.0",
      ]);
      expect(paths(define({ relations: [group({ fields: [] })] }))).toEqual([]);
    });
  });

  describe("rule 3 — data types", () => {
    it("allows string and every scalar type, in fields and header", () => {
      const definition = define({ fields: ["name", "age", "born"], header: ["age", "born"] });
      expect(validateSearchIndex(definition, schema)).toEqual([]);
    });

    it("allows one document among the root's own fields only", () => {
      expect(paths(define({ fields: ["bio"] }))).toEqual([]);
      expect(paths(define({ fields: ["bio", "name", "notes"] }))).toEqual(["fields.2"]);
    });

    it("rejects a document in the header, a relation group or a target", () => {
      expect(paths(define({ header: ["bio"] }))).toEqual(["header.0"]);
      expect(paths(define({ relations: [group({ fields: ["contract"] })] }))).toEqual([
        "relations.0.fields.0",
      ]);
      expect(paths(define({ relations: [group({ target: { company: ["profile"] } })] }))).toEqual([
        "relations.0.target.company.0",
      ]);
    });
  });

  describe("rule 4 — limits", () => {
    it("allows 12 fields counted across own, relation and target fields", () => {
      const definition = define({
        fields: ["name", "email", "age", "born"],
        relations: [
          group({ fields: ["role", "since"], target: { company: ["name", "founded"] } }),
          group({ relationType: "knows", fields: ["since"], target: { person: ["name", "email", "age"] } }),
        ],
      });
      expect(validateSearchIndex(definition, schema)).toEqual([]);
    });

    it("rejects the 13th field", () => {
      const definition = define({
        fields: ["name", "email", "age", "born", "bio"],
        relations: [
          group({ fields: ["role", "since"], target: { company: ["name", "founded"] } }),
          group({ relationType: "knows", fields: ["since"], target: { person: ["name", "email", "age"] } }),
        ],
      });
      const issues = validateSearchIndex(definition, schema);
      expect(issues).toEqual([
        {
          path: "fields",
          message:
            "An index reads at most 12 fields (own, relation and target fields together); this one reads 13",
        },
      ]);
    });

    it("rejects a fifth relation group", () => {
      const relations = [
        group({ fields: ["role"] }),
        group({ relationType: "knows", fields: ["since"], target: {} }),
        group({ relationType: "knows", direction: "incoming", fields: ["since"], target: {} }),
        group({ fields: ["since"], target: {} }),
        group({ fields: ["since"], target: {} }),
      ];
      expect(paths(define({ fields: [], relations }))).toEqual([
        "relations",
        "relations.3",
        "relations.4",
      ]);
    });
  });

  describe("rule 6 — one group per relation type and direction", () => {
    it("allows the same relation type in both directions", () => {
      const relations = [
        group({ relationType: "knows", fields: ["since"], target: { person: ["name"] } }),
        group({ relationType: "knows", direction: "incoming", fields: ["since"], target: { person: ["name"] } }),
      ];
      expect(validateSearchIndex(define({ relations }), schema)).toEqual([]);
    });

    it("rejects the same relation type twice in one direction", () => {
      expect(paths(define({ relations: [group(), group({ fields: ["since"] })] }))).toEqual([
        "relations.1",
      ]);
    });
  });

  it("requires at least one enabled representation", () => {
    const definition = define({ semantic: { enabled: false }, keyword: { enabled: false } });
    expect(paths(definition)).toEqual(["semantic.enabled"]);
    expect(paths(define({ keyword: { enabled: false } }))).toEqual([]);
    expect(paths(define({ semantic: { enabled: false } }))).toEqual([]);
  });
});

describe("effectiveHeader", () => {
  it("defaults to the root type's name property", () => {
    expect(effectiveHeader(define(), schema.entityTypes.person!)).toEqual(["name"]);
  });

  it("keeps a declared header, an empty one included", () => {
    expect(effectiveHeader(define({ header: ["email", "age"] }), schema.entityTypes.person!)).toEqual([
      "email",
      "age",
    ]);
    expect(effectiveHeader(define({ header: [] }), schema.entityTypes.person!)).toEqual([]);
  });

  it("falls back to the first string field when no name property is known", () => {
    const root = { ...schema.entityTypes.person!, nameProperty: null };
    expect(effectiveHeader(define({ fields: ["age", "email", "name"] }), root)).toEqual(["email"]);
    expect(effectiveHeader(define({ fields: ["age"] }), root)).toEqual([]);
  });
});

describe("managed indices", () => {
  it("derives a default index per type and a passage index per document property", () => {
    const managed = deriveManagedIndices(schema);
    expect(managed.map((m) => [m.kind, m.definition.key])).toEqual([
      ["default", "person~default"],
      ["passage", "person~bio"],
      ["passage", "person~notes"],
      ["default", "company~default"],
      ["passage", "company~profile"],
      ["default", "city~default"],
    ]);
  });

  it("builds the default index over own string properties in declaration order", () => {
    const person = deriveManagedIndices(schema)[0]!;
    expect(person.definition).toEqual({
      key: "person~default",
      name: "Person — default",
      description: "Finds Person entities by their own text properties: Name, Email.",
      entityType: "person",
      fields: ["name", "email"],
      header: [],
      relations: [],
      semantic: { enabled: true, template: null },
      keyword: { enabled: true },
    });
  });

  it("builds a passage index with one document field, headed by the name property", () => {
    const passage = deriveManagedIndices(schema)[1]!;
    expect(passage.definition).toMatchObject({
      key: "person~bio",
      name: "Person — Bio passages",
      entityType: "person",
      fields: ["bio"],
      header: null,
      relations: [],
      semantic: { enabled: true, template: null },
      keyword: { enabled: true },
    });
    expect(passage.definition.description).toContain("passages of their Bio document");
    expect(effectiveHeader(passage.definition, schema.entityTypes.person!)).toEqual(["name"]);
  });

  it("describes a managed index by the fields it is given, or by none", () => {
    expect(managedIndexDescription("default", "Person", ["Name"])).toBe(
      "Finds Person entities by their own text properties: Name.",
    );
    expect(managedIndexDescription("default", "Person", [])).toBe("Finds Person entities by their own text properties.");
    expect(managedIndexDescription("passage", "Person", ["Bio"])).toBe(
      "Finds Person entities by passages of their Bio document; each passage starts with the entity's name.",
    );
    expect(managedIndexDescription("passage", "Person", [])).toBe(
      "Finds Person entities by passages of their document; each passage starts with the entity's name.",
    );
  });

  it("creates no default index for a type without string properties (A2)", () => {
    const bare: SearchIndexSchema = {
      entityTypes: {
        reading: {
          key: "reading",
          displayName: "Reading",
          nameProperty: null,
          properties: props(["value", "float"], ["log", "document"]),
        },
      },
      relationTypes: {},
    };
    expect(deriveManagedIndices(bare).map((m) => m.definition.key)).toEqual(["reading~log"]);
  });

  it("gives a document property keyed `default` no passage index", () => {
    const clash: SearchIndexSchema = {
      entityTypes: {
        note: {
          key: "note",
          displayName: "Note",
          nameProperty: "name",
          properties: props(["name", "string"], ["default", "document"]),
        },
      },
      relationTypes: {},
    };
    expect(deriveManagedIndices(clash).map((m) => [m.kind, m.definition.key])).toEqual([
      ["default", "note~default"],
    ]);
  });

  it("marks managed keys and keeps user keys apart", () => {
    expect(managedIndexKey("person", "bio")).toBe("person~bio");
    expect(isManagedIndexKey("person~default")).toBe(true);
    expect(isManagedIndexKey("person_default")).toBe(false);
    expect(KEY_PATTERN.test("person~default")).toBe(false);
  });
});

describe("definitionHash", () => {
  const base = define({
    header: ["name"],
    relations: [group({ label: "Employment", target: { company: ["name", "founded"] } })],
  });

  it("is a SHA-256 hex digest, stable across calls", () => {
    const hash = definitionHash(base, "semantic");
    expect(hash).toMatch(/^[0-9a-f]{64}$/);
    expect(definitionHash(define({ header: ["name"], relations: base.relations }), "semantic")).toBe(hash);
  });

  it("ignores object key order", () => {
    const shuffled: SearchIndexDefinition = {
      keyword: base.keyword,
      semantic: { template: base.semantic.template, enabled: base.semantic.enabled },
      relations: base.relations.map((g) => ({
        template: g.template,
        target: { ...g.target },
        label: g.label,
        fields: g.fields,
        direction: g.direction,
        relationType: g.relationType,
      })),
      header: base.header,
      fields: base.fields,
      entityType: base.entityType,
      description: base.description,
      name: base.name,
      key: base.key,
    };
    expect(definitionHash(shuffled, "semantic")).toBe(definitionHash(base, "semantic"));
    expect(definitionHash(shuffled, "keyword")).toBe(definitionHash(base, "keyword"));
  });

  it("differs per representation", () => {
    expect(definitionHash(base, "semantic")).not.toBe(definitionHash(base, "keyword"));
  });

  it("changes when content changes", () => {
    const semantic = definitionHash(base, "semantic");
    const changed = [
      { ...base, fields: ["email", "name"] },
      { ...base, header: null },
      { ...base, entityType: "company" },
      { ...base, relations: [{ ...base.relations[0]!, label: "Job" }] },
      { ...base, relations: [{ ...base.relations[0]!, template: "{role} at {target.name}" }] },
      { ...base, relations: [{ ...base.relations[0]!, target: { company: ["name"] } }] },
      { ...base, relations: [{ ...base.relations[0]!, direction: "incoming" as const }] },
      { ...base, semantic: { enabled: true, template: "{name}" } },
    ];
    for (const definition of changed) {
      expect(definitionHash(definition, "semantic")).not.toBe(semantic);
    }
  });

  it("ignores key, name, description and the enabled switches", () => {
    const relabelled = {
      ...base,
      key: "other",
      name: "Other",
      description: "Other text.",
      semantic: { ...base.semantic, enabled: false },
      keyword: { enabled: false },
    };
    expect(definitionHash(relabelled, "semantic")).toBe(definitionHash(base, "semantic"));
    expect(definitionHash(relabelled, "keyword")).toBe(definitionHash(base, "keyword"));
  });

  it("leaves the keyword hash alone when only templates or group labels change", () => {
    const keyword = definitionHash(base, "keyword");
    for (const definition of [
      { ...base, semantic: { enabled: true, template: "{name}" } },
      { ...base, relations: [{ ...base.relations[0]!, template: "{role} at {target.name}" }] },
      { ...base, relations: [{ ...base.relations[0]!, label: "Job" }] },
    ]) {
      expect(definitionHash(definition, "keyword")).toBe(keyword);
    }
    expect(definitionHash({ ...base, fields: ["email", "name"] }, "keyword")).not.toBe(keyword);
  });
});

describe("planSearchIndexCascade", () => {
  const employment = SearchIndexDefinition.parse({
    key: "employment",
    name: "Employment",
    description: "People by employment",
    entityType: "person",
    fields: ["name", "email"],
    header: ["name", "email"],
    relations: [
      { relationType: "works_for", direction: "outgoing", fields: ["role"], target: { company: ["name", "founded"] } },
      { relationType: "lives_in", direction: "outgoing", fields: [], target: { city: ["name"] } },
    ],
  });
  const companies = SearchIndexDefinition.parse({
    key: "companies",
    name: "Companies",
    description: "Companies by staff",
    entityType: "company",
    fields: [],
    relations: [{ relationType: "works_for", direction: "incoming", fields: ["role"], target: { person: ["email"] } }],
  });
  const all = [employment, companies];

  it("deletes the indices rooted on a deleted entity type and removes target entries naming it", () => {
    const cascade = planSearchIndexCascade(all, { kind: "entityType", key: "city" });
    expect(cascade.deleted).toEqual([]);
    expect(cascade.updated).toHaveLength(1);
    // The group's only field was a city field: the group goes with it.
    expect(cascade.updated[0]!.relations.map((g) => g.relationType)).toEqual(["works_for"]);

    const rooted = planSearchIndexCascade(all, { kind: "entityType", key: "company" });
    expect(rooted.deleted).toEqual(["companies"]);
    // The works_for group keeps its relation field without the company target.
    expect(rooted.updated[0]!.relations[0]).toMatchObject({ fields: ["role"], target: {} });
    expect(cascadeIndexKeys(rooted)).toEqual(["companies", "employment"]);
  });

  it("removes the groups on a deleted relation type; an index left empty goes", () => {
    const cascade = planSearchIndexCascade(all, { kind: "relationType", key: "works_for" });
    expect(cascade.deleted).toEqual(["companies"]);
    expect(cascade.updated[0]!.relations.map((g) => g.relationType)).toEqual(["lives_in"]);
    expect(cascade.updated[0]!.fields).toEqual(["name", "email"]);
  });

  it("removes a deleted own property from fields and header", () => {
    const cascade = planSearchIndexCascade(all, {
      kind: "property",
      owner: "entityType",
      ownerKey: "person",
      key: "email",
    });
    const updated = Object.fromEntries(cascade.updated.map((d) => [d.key, d]));
    expect(updated.employment).toMatchObject({ fields: ["name"], header: ["name"] });
    // The incoming group keeps its relation field; the emptied target entry goes.
    expect(cascade.deleted).toEqual([]);
    expect(updated.companies!.relations[0]).toMatchObject({ fields: ["role"], target: {} });
  });

  it("removes a deleted target property and a deleted relation property", () => {
    const target = planSearchIndexCascade(all, {
      kind: "property",
      owner: "entityType",
      ownerKey: "company",
      key: "founded",
    });
    expect(target.updated.map((d) => d.key)).toEqual(["employment"]);
    expect(target.updated[0]!.relations[0]!.target).toEqual({ company: ["name"] });

    const relation = planSearchIndexCascade(all, {
      kind: "property",
      owner: "relationType",
      ownerKey: "works_for",
      key: "role",
    });
    expect(relation.updated.map((d) => d.key).sort()).toEqual(["companies", "employment"]);
    expect(relation.deleted).toEqual([]);
    expect(relation.updated.find((d) => d.key === "companies")!.relations[0]).toMatchObject({
      fields: [],
      target: { person: ["email"] },
    });
  });

  it("leaves untouched indices alone and keeps a null header null", () => {
    const nullHeader = { ...employment, header: null };
    expect(
      planSearchIndexCascade([nullHeader], { kind: "property", owner: "entityType", ownerKey: "city", key: "name" })
        .updated[0]!.header,
    ).toBeNull();
    expect(planSearchIndexCascade(all, { kind: "relationType", key: "unrelated" })).toEqual({
      updated: [],
      deleted: [],
    });
    expect(
      planSearchIndexCascade(all, { kind: "property", owner: "entityType", ownerKey: "person", key: "born" }),
    ).toEqual({ updated: [], deleted: [] });
  });
});
