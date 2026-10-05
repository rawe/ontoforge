/**
 * The pgvector version gate: search entries need `halfvec` (0.7.0+).
 */

import { describe, expect, it } from "vitest";

import { supportsHalfvec } from "../../../src/adapters/postgres/ddl.js";

describe("pgvector halfvec support", () => {
  it("starts at 0.7.0", () => {
    expect(supportsHalfvec("0.6.2")).toBe(false);
    expect(supportsHalfvec("0.7.0")).toBe(true);
    expect(supportsHalfvec("0.8.6")).toBe(true);
    expect(supportsHalfvec("0.10.0")).toBe(true);
    expect(supportsHalfvec("1.0.0")).toBe(true);
  });
});
