/**
 * Retriever configuration v2 against its lens: indices from the
 * catalog, relations within the index's relation groups, filters on
 * result types along visible paths, answer fields for exactly the
 * result types.
 */

import { describe, expect, it } from "vitest";

import { checkRetrieverConfig } from "../../../../src/runtime/assistants/retrievers/config.js";
import { CATALOG, CONFIG, LENS } from "./fixture.js";

const errorsOf = (config: unknown, version: unknown = 2) => checkRetrieverConfig(version, config, LENS).errors;

describe("retriever configuration v2", () => {
  it("accepts a valid configuration and returns it parsed", () => {
    const { config, errors } = checkRetrieverConfig(2, CONFIG, LENS);
    expect(errors).toEqual([]);
    expect(config).toEqual(CONFIG);
  });

  it("refuses other versions and malformed shapes", () => {
    expect(errorsOf(CONFIG, 1)).toEqual([
      "Configuration version 1 is not supported; retrievers run version 2",
    ]);
    expect(errorsOf({ ...CONFIG, indices: [] })).toEqual(["indices: Too small: expected array to have >=1 items"]);
    expect(errorsOf({ ...CONFIG, threshold: 2 })).toHaveLength(1);
  });

  it("needs every index in the lens's catalog, once", () => {
    expect(errorsOf({ ...CONFIG, indices: [...CONFIG.indices, { index: "ghost" }, { index: "person~default" }] })).toEqual([
      "Search index 'ghost' is not available in this lens",
      "Search index 'person~default' is chosen twice",
    ]);
    // A catalog without the index (switched off, deleted, not included).
    const without = { ...LENS, catalog: CATALOG.filter((entry) => entry.key !== "person_home") };
    expect(checkRetrieverConfig(2, CONFIG, without).errors).toEqual([
      "Search index 'person_home' is not available in this lens",
    ]);
  });

  it("allows relations only among the index's relation groups the lens shows", () => {
    const config = {
      ...CONFIG,
      indices: [{ index: "person_employment", relations: ["works_for", "lives_in"] }, { index: "person~default", relations: ["works_for"] }],
    };
    expect(errorsOf(config)).toEqual([
      "Search index 'person_employment' has no relation group 'lives_in' in this lens",
      "Search index 'person~default' has no relation group 'works_for' in this lens",
    ]);
    expect(errorsOf({ ...CONFIG, indices: [{ index: "person_employment", relations: [] }] })).toHaveLength(1);
  });

  it("checks filters: unique ids, result types, visible paths and fields", () => {
    const filters = [
      CONFIG.filters[0]!,
      { ...CONFIG.filters[0]!, field: "name" },
      { id: "firm", entityType: "company", path: [], field: "name" },
      { id: "far", entityType: "person", path: [{ relationTypeKey: "works_for", direction: "incoming" as const }], field: "name" },
      { id: "zip", entityType: "person", path: [{ relationTypeKey: "lives_in", direction: "outgoing" as const }], field: "zip" },
      {
        id: "two",
        entityType: "person",
        path: [
          { relationTypeKey: "works_for", direction: "outgoing" as const },
          { relationTypeKey: "works_for", direction: "incoming" as const },
        ],
        field: "email",
      },
    ];
    expect(errorsOf({ ...CONFIG, filters })).toEqual([
      "Filter id 'city' is used twice",
      "Filter 'firm': 'company' is not a result type of the chosen indices",
      "Filter 'far': its relation path is not visible in this lens",
      "Filter 'zip': field 'zip' is not visible on 'city'",
    ]);
  });

  it("needs visible answer fields for exactly the result types", () => {
    expect(errorsOf({ ...CONFIG, answerFields: { company: ["name"] } })).toEqual([
      "Result type 'person' needs answer fields",
      "Answer fields for 'company', which no chosen index finds",
    ]);
    expect(errorsOf({ ...CONFIG, answerFields: { person: ["name", "salary"] } })).toEqual([
      "Answer field 'salary' is not visible on 'person'",
    ]);
    expect(errorsOf({ ...CONFIG, answerFields: { person: [] } })).toHaveLength(1);
  });
});
