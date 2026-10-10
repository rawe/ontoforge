/**
 * The default retriever's derived configuration: every managed index
 * the lens's catalog lists (custom ones and passage indices of a hidden
 * document left out), a name filter per result type with a visible name
 * and one per relation to a type with a visible name (both directions for
 * a self-relation), name-first answer fields, the default settings, and
 * determinism.
 */

import { describe, expect, it } from "vitest";

import { DEFAULT_ANSWER_FIELD_CHARACTERS, DEFAULT_THRESHOLD } from "../../../../src/core/retriever.js";
import type { RetrieverLens } from "../../../../src/runtime/assistants/retrievers/config.js";
import { defaultRetrieverConfig } from "../../../../src/runtime/assistants/retrievers/defaultRetriever.js";
import type { SchemaCacheValue } from "../../../../src/runtime/schemaCache.js";
import { CATALOG, SCHEMA } from "./fixture.js";

const withSchema = (patch: (schema: SchemaCacheValue) => void): SchemaCacheValue => {
  const schema = structuredClone(SCHEMA);
  patch(schema);
  return schema;
};

describe("default retriever", () => {
  it("searches every managed index of the catalog and no custom one", () => {
    const config = defaultRetrieverConfig({ scoped: SCHEMA, catalog: CATALOG });
    expect(config.indices).toEqual([{ index: "company~default" }, { index: "person~bio" }, { index: "person~default" }]);
    expect(config.threshold).toBe(DEFAULT_THRESHOLD);
    expect(config.answerFieldCharacters).toBe(DEFAULT_ANSWER_FIELD_CHARACTERS);
  });

  it("follows the catalog: a switched-off or excluded index is absent, a hidden document's passages too", () => {
    const catalog = CATALOG.filter((entry) => entry.key !== "company~default").map((entry) =>
      entry.key === "person~bio" ? { ...entry, documentProperty: null } : entry,
    );
    expect(defaultRetrieverConfig({ scoped: SCHEMA, catalog }).indices).toEqual([{ index: "person~default" }]);
    expect(defaultRetrieverConfig({ scoped: SCHEMA, catalog: [] }).indices).toEqual([]);
  });

  it("derives a name filter per result type and one per relation hop to a named type", () => {
    const config = defaultRetrieverConfig({ scoped: SCHEMA, catalog: CATALOG });
    expect(config.filters).toEqual([
      { id: "company", entityType: "company", path: [], field: "name" },
      {
        id: "company.works_for.incoming",
        entityType: "company",
        path: [{ relationTypeKey: "works_for", direction: "incoming" }],
        field: "name",
      },
      { id: "person", entityType: "person", path: [], field: "name" },
      {
        id: "person.lives_in.outgoing",
        entityType: "person",
        path: [{ relationTypeKey: "lives_in", direction: "outgoing" }],
        field: "name",
      },
      {
        id: "person.works_for.outgoing",
        entityType: "person",
        path: [{ relationTypeKey: "works_for", direction: "outgoing" }],
        field: "name",
      },
    ]);
  });

  it("filters a self-relation in both directions", () => {
    const scoped = withSchema((schema) => {
      schema.relationTypes = {
        manages: { ...schema.relationTypes.works_for!, key: "manages", fromEntityTypeKey: "person", toEntityTypeKey: "person" },
      };
    });
    const ids = defaultRetrieverConfig({ scoped, catalog: CATALOG }).filters.map((filter) => filter.id);
    expect(ids).toEqual(["company", "person", "person.manages.outgoing", "person.manages.incoming"]);
  });

  it("skips a type whose name the lens hides, as result type and as hop target", () => {
    const scoped = withSchema((schema) => {
      schema.entityTypes.city!.nameProperty = null;
      delete schema.entityTypes.city!.properties.name;
      schema.entityTypes.company!.nameProperty = null;
      delete schema.entityTypes.company!.properties.name;
    });
    const config = defaultRetrieverConfig({ scoped, catalog: CATALOG });
    expect(config.filters.map((filter) => filter.id)).toEqual(["person"]);
    // No visible string property: no answer fields, and still runnable.
    expect(config.answerFields.company).toEqual([]);
  });

  it("gives each result type its name, then its further visible string properties", () => {
    const config = defaultRetrieverConfig({ scoped: SCHEMA, catalog: CATALOG });
    expect(config.answerFields).toEqual({ company: ["name"], person: ["name", "email"] });
  });

  it("is deterministic and holds more than the stored limits", () => {
    const many = Array.from({ length: 14 }, (_, i) => ({ ...CATALOG[0]!, key: `t${i}~default`, entityType: "person" }));
    const lens: RetrieverLens = { scoped: SCHEMA, catalog: many };
    expect(defaultRetrieverConfig(lens).indices).toHaveLength(14);
    expect(JSON.stringify(defaultRetrieverConfig(lens))).toBe(JSON.stringify(defaultRetrieverConfig(structuredClone(lens))));
  });
});
