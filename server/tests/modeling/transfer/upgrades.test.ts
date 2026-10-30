/**
 * The upgrade chain: the importable versions come from its table, a
 * payload is upgraded from its own version up to the current one, and
 * any other version is refused naming the importable ones.
 */

import { describe, expect, it } from "vitest";

import { ValidationError } from "../../../src/core/exceptions.js";
import { IMPORTABLE_FORMAT_VERSIONS, upgradeToCurrent } from "../../../src/modeling/transfer/upgrades.js";

const LENS_5 = { key: "all", name: "All", aiAgents: [], retrievers: [] };

describe("upgrade chain", () => {
  it("imports the current version and the table's, newest first", () => {
    expect(IMPORTABLE_FORMAT_VERSIONS).toEqual(["8.0", "7.0", "6.0", "5.0"]);
  });

  it("leaves a current payload, or one without a version, as it is", () => {
    const payload = { formatVersion: "8.0", lenses: [{ key: "all", assistants: { agents: [] } }] };
    expect(upgradeToCurrent(payload).payload).toEqual(payload);
    const { formatVersion: _, ...unversioned } = payload;
    expect(upgradeToCurrent(unversioned).payload).toEqual(unversioned);
  });

  it("applies every upgrader from the payload's version on", () => {
    const { payload } = upgradeToCurrent({ formatVersion: "5.0", textSearchLanguage: "english", lenses: [LENS_5] });
    expect(payload).toEqual({
      formatVersion: "8.0",
      keywordLanguages: ["english"],
      entityTypes: [],
      lenses: [{ key: "all", name: "All", assistants: { agents: [], retrievers: [] } }],
    });
  });

  it("refuses any other version with a field error naming the importable ones", () => {
    for (const formatVersion of ["4.0", "9.0", "unknown"]) {
      expect(() => upgradeToCurrent({ formatVersion, lenses: [] })).toThrow(
        expect.objectContaining({
          message: `Unsupported transfer format version '${formatVersion}'`,
          details: { fields: { formatVersion: "Expected one of 8.0, 7.0, 6.0, 5.0" } },
        }),
      );
    }
  });

  it("carries the saved queries an upgrader left out to the current version", () => {
    const steps = [
      { name: "found", type: "search", entityTypeKey: "paper", query: "graph" },
      { name: "more", type: "oql", oql: "MATCH (p) WHERE p.title IN $t RETURN p", bindings: { t: "{{found.title}}" } },
    ];
    const lens = { ...LENS_5, savedQueries: [{ key: "by-title", name: "By title", description: "", steps }] };
    const upgraded = upgradeToCurrent({ formatVersion: "5.0", textSearchLanguage: "english", lenses: [lens] });
    expect(upgraded.leftOutSavedQueries).toEqual([{ lens: "all", key: "by-title" }]);
    expect((upgraded.payload.lenses as { savedQueries: unknown[] }[])[0]!.savedQueries).toEqual([]);
  });

  it("refuses a body that is no object or whose version is no string", () => {
    for (const body of [[], "payload", { formatVersion: 7 }]) {
      expect(() => upgradeToCurrent(body)).toThrow(ValidationError);
    }
  });
});
