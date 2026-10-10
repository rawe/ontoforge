/**
 * The 6.0 → 7.0 upgrader alone: each lens's `aiAgents` and
 * `retrieverAgents` move under `assistants`, everything else stays, and
 * malformed lists are reported at their 6.0 paths.
 */

import { describe, expect, it } from "vitest";

import { ValidationError } from "../../../src/core/exceptions.js";
import { upgrade6to7 } from "../../../src/modeling/transfer/upgrade6to7.js";

const AGENT = { key: "helper", name: "Helper", description: null, systemPrompt: "Be brief.", tools: null };
const RETRIEVER = { key: "finder", name: "Finder", description: null, configVersion: 2, config: { indices: [] } };

const PAYLOAD_6 = {
  formatVersion: "6.0",
  keywordLanguages: ["german"],
  searchIndices: { custom: [], disabled: [] },
  entityTypes: [{ key: "person", displayName: "Person", nameProperty: "name", properties: [] }],
  relationTypes: [],
  lenses: [
    {
      key: "all",
      name: "All",
      indexInclusions: ["person~default"],
      aiAgents: [AGENT],
      savedQueries: [],
      retrieverAgents: [RETRIEVER],
    },
    // An adapter without search indices exported no retrievers.
    { key: "bare", name: "Bare", aiAgents: [] },
  ],
};

describe("upgrade 6.0 → 7.0", () => {
  it("moves each lens's agents and retrievers under assistants", () => {
    const { payload, retrieverWarnings } = upgrade6to7(PAYLOAD_6);
    expect(payload).toEqual({
      ...PAYLOAD_6,
      formatVersion: "7.0",
      lenses: [
        {
          key: "all",
          name: "All",
          indexInclusions: ["person~default"],
          assistants: { agents: [AGENT], retrievers: [RETRIEVER] },
          savedQueries: [],
        },
        { key: "bare", name: "Bare", assistants: { agents: [] } },
      ],
    });
    expect(retrieverWarnings.size).toBe(0);
  });

  it("an absent agent list is empty", () => {
    const { payload } = upgrade6to7({ ...PAYLOAD_6, lenses: [{ key: "all", name: "All" }] });
    expect((payload.lenses as unknown[])[0]).toEqual({ key: "all", name: "All", assistants: { agents: [] } });
  });

  it("reports malformed 6.0 fields at their 6.0 paths, every one together", () => {
    let error: unknown;
    try {
      upgrade6to7({ ...PAYLOAD_6, lenses: [{ key: "all", name: "All", aiAgents: "none", retrieverAgents: [{ key: "x" }] }] });
    } catch (caught) {
      error = caught;
    }
    expect(error).toBeInstanceOf(ValidationError);
    const paths = ((error as ValidationError).details!.errors as { path: string }[]).map((issue) => issue.path);
    expect(paths).toEqual(expect.arrayContaining(["/lenses/0/aiAgents", "/lenses/0/retrieverAgents/0/name"]));
  });
});
