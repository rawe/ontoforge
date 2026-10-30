/**
 * The 7.0 → 8.0 upgrader alone: each search step's `entityTypeKey`
 * becomes `types`, every other field stays, and a saved query binding a
 * field a search step no longer yields is left out and named.
 */

import { describe, expect, it } from "vitest";

import { ValidationError } from "../../../src/core/exceptions.js";
import { upgrade7to8 } from "../../../src/modeling/transfer/upgrade7to8.js";

/** A saved query as 7.0 exports it: every step field, absent ones null. */
const query = (key: string, field: string) => ({
  key,
  name: key,
  description: "Skills, then their holders",
  steps: [
    { name: "skills", type: "search", oql: null, entityTypeKey: "skill", query: "$q", limit: 5, bindings: null },
    {
      name: "people",
      type: "oql",
      oql: "MATCH (p:person) WHERE p._id IN $ids RETURN p",
      entityTypeKey: null,
      query: null,
      limit: null,
      bindings: { ids: `{{skills.${field}}}` },
    },
  ],
  parameters: [{ name: "q", description: "Skill", dataType: "string" }],
});

const PAYLOAD_7 = {
  formatVersion: "7.0",
  keywordLanguages: ["english"],
  entityTypes: [],
  relationTypes: [],
  lenses: [
    { key: "all", name: "All", assistants: { agents: [] }, savedQueries: [query("by-id", "_id"), query("by-title", "title")] },
    // A lens without saved queries keeps none.
    { key: "bare", name: "Bare" },
  ],
};

describe("upgrade 7.0 → 8.0", () => {
  it("converts each search step, keeping every other field", () => {
    const { payload, leftOutSavedQueries } = upgrade7to8(PAYLOAD_7);
    const [all, bare] = payload.lenses as { savedQueries?: { key: string; steps: unknown[] }[] }[];
    expect(payload.formatVersion).toBe("8.0");
    expect(all!.savedQueries!.map((q) => q.key)).toEqual(["by-id"]);
    expect(all!.savedQueries![0]!.steps).toEqual([
      { name: "skills", type: "search", oql: null, query: "$q", limit: 5, bindings: null, types: ["skill"] },
      {
        name: "people",
        type: "oql",
        oql: "MATCH (p:person) WHERE p._id IN $ids RETURN p",
        query: null,
        limit: null,
        bindings: { ids: "{{skills._id}}" },
      },
    ]);
    expect(bare).toEqual({ key: "bare", name: "Bare" });
    expect(leftOutSavedQueries).toEqual([{ lens: "all", key: "by-title" }]);
  });

  it("leaves a payload without search steps as it is", () => {
    const lenses = [{ key: "all", name: "All", savedQueries: [{ key: "q", steps: [{ name: "main", type: "oql", oql: "MATCH (p) RETURN p" }] }] }];
    const { payload, leftOutSavedQueries } = upgrade7to8({ ...PAYLOAD_7, lenses });
    expect(payload).toEqual({ ...PAYLOAD_7, formatVersion: "8.0", lenses });
    expect(leftOutSavedQueries).toEqual([]);
  });

  it("reports malformed 7.0 fields at their 7.0 paths", () => {
    expect(() => upgrade7to8({ lenses: [{ key: "all", savedQueries: [{ key: "q", steps: "nope" }] }] })).toThrow(
      expect.objectContaining({
        details: { errors: [expect.objectContaining({ path: "/lenses/0/savedQueries/0/steps" })] },
      }),
    );
    expect(() => upgrade7to8({ lenses: "nope" })).toThrow(ValidationError);
  });
});
