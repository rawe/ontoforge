/** The one mapping of a model call's reported usage. */

import { describe, expect, it } from "vitest";

import { tokenUsage } from "../../src/core/usage.js";

describe("tokenUsage", () => {
  it("maps every count LangChain reports", () => {
    expect(tokenUsage({
      input_tokens: 5210, output_tokens: 312, total_tokens: 5522,
      input_token_details: { cache_read: 4800, cache_creation: 0 },
    })).toEqual({ input: 5210, output: 312, cacheRead: 4800, cacheWrite: 0 });
  });

  it("keeps a reported 0 and leaves out what was not reported", () => {
    expect(tokenUsage({ input_tokens: 0, output_tokens: 7 })).toEqual({ input: 0, output: 7 });
    expect(tokenUsage({ output_tokens: 7, input_token_details: {} })).toEqual({ output: 7 });
  });

  it("is nothing when nothing was reported", () => {
    expect(tokenUsage(undefined)).toBeUndefined();
    expect(tokenUsage({})).toBeUndefined();
    expect(tokenUsage({ input_token_details: { cache_read: null } })).toBeUndefined();
  });
});
