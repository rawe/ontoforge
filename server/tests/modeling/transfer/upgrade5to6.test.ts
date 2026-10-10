/**
 * The 5.0 → 6.0 upgrader alone: a 5.0 payload in, a 6.0 payload out —
 * the one language becomes the set, search indices are dropped unread,
 * name properties are derived, retrievers become `retrieverAgents` with
 * their conversion warnings beside the payload — and malformed 5.0
 * fields reported at their 5.0 paths.
 */

import { describe, expect, it } from "vitest";

import { ValidationError } from "../../../src/core/exceptions.js";
import { upgrade5to6 } from "../../../src/modeling/transfer/upgrade5to6.js";
import { retrieverWarningKey } from "../../../src/modeling/transfer/upgrader.js";

const LEGACY = {
  buckets: [
    {
      entityTypeKey: "person",
      searchFields: ["name", "bio"],
      answerFields: ["name"],
      conditions: [{ id: "c", mode: "soft", path: [{ relationTypeKey: "lives_in", direction: "outgoing" }], targetField: "name" }],
    },
  ],
};

const PAYLOAD_5 = {
  formatVersion: "5.0",
  textSearchLanguage: "german",
  keywordLanguages: ["french"],
  searchIndices: { custom: "ignored" },
  entityTypes: [
    {
      key: "person",
      displayName: "Person",
      properties: [
        { key: "name", displayName: "Name", dataType: "string", required: true },
        { key: "bio", displayName: "Bio", dataType: "document", required: false },
      ],
    },
    {
      key: "reading",
      displayName: "Reading",
      properties: [{ key: "name", displayName: "Name", dataType: "integer", required: false }],
    },
  ],
  relationTypes: [],
  lenses: [
    {
      key: "all",
      name: "All",
      indexInclusions: "ignored",
      retrieverAgents: "ignored",
      aiAgents: [{ key: "helper", name: "Helper" }],
      retrievers: [
        { key: "fair-search", name: "Fair", description: null, configVersion: 1, config: LEGACY },
        { key: "plain", name: "Plain", description: "p", configVersion: 1, config: LEGACY },
      ],
    },
  ],
};

function failure(payload: Record<string, unknown>): ValidationError {
  try {
    upgrade5to6(payload);
  } catch (error) {
    if (error instanceof ValidationError) return error;
    throw error;
  }
  throw new Error("expected a validation error");
}

describe("upgrade 5.0 → 6.0", () => {
  it("turns a 5.0 payload into a 6.0 one", () => {
    const { payload, retrieverWarnings } = upgrade5to6(PAYLOAD_5);
    const converted = {
      indices: [{ index: "person~default" }, { index: "person~bio" }],
      filters: [],
      answerFields: { person: ["name"] },
      threshold: 0.35,
      answerFieldCharacters: 800,
    };
    expect(payload).toEqual({
      formatVersion: "6.0",
      keywordLanguages: ["german"],
      entityTypes: [
        { ...PAYLOAD_5.entityTypes[0], nameProperty: "name" },
        {
          ...PAYLOAD_5.entityTypes[1],
          nameProperty: "name_2",
          properties: [
            ...PAYLOAD_5.entityTypes[1]!.properties,
            { key: "name_2", displayName: "name_2", description: null, dataType: "string", required: false, defaultValue: null },
          ],
        },
      ],
      relationTypes: [],
      lenses: [
        {
          key: "all",
          name: "All",
          aiAgents: [{ key: "helper", name: "Helper" }],
          retrieverAgents: [
            { key: "fair_search", name: "Fair", description: null, configVersion: 2, config: converted },
            { key: "plain", name: "Plain", description: "p", configVersion: 2, config: converted },
          ],
        },
      ],
    });
    const dropped =
      "Soft condition 'c' of person was dropped: it needs a custom index with relation group lives_in (outgoing).";
    expect(retrieverWarnings).toEqual(
      new Map([
        [retrieverWarningKey("all", "fair_search"), [dropped, "Key renamed from 'fair-search' to 'fair_search'."]],
        [retrieverWarningKey("all", "plain"), [dropped]],
      ]),
    );
  });

  it("requires the text-search language as a field", () => {
    const { textSearchLanguage: _, ...payload } = PAYLOAD_5;
    expect(failure(payload).details).toEqual({ fields: { textSearchLanguage: "Required" } });
  });

  it("reports malformed 5.0 fields at their 5.0 paths, every one together", () => {
    const error = failure({
      ...PAYLOAD_5,
      textSearchLanguage: "french",
      lenses: [{ key: "all", name: "All", retrievers: [{ key: "y" }] }],
    });
    expect(error.message).toBe("Request validation failed");
    const paths = (error.details!.errors as { path: string }[]).map((issue) => issue.path);
    expect(paths).toEqual(expect.arrayContaining(["/textSearchLanguage", "/lenses/0/retrievers/0/name"]));
  });

  it("reports a retriever without a readable version-1 configuration at its 5.0 path", () => {
    const retriever = PAYLOAD_5.lenses[0]!.retrievers[1]!;
    const error = failure({
      ...PAYLOAD_5,
      lenses: [{ key: "all", name: "All", retrievers: [{ ...retriever, configVersion: 2 }, { ...retriever, config: {} }] }],
    });
    expect(error.details!.errors).toEqual([
      { path: "/lenses/0/retrievers/0", message: "No valid configuration of version 1" },
      { path: "/lenses/0/retrievers/1", message: "No valid configuration of version 1" },
    ]);
  });
});
