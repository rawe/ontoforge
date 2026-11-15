/**
 * The resource rule of the authorization server: which resource indicators
 * name something this server serves, and which resource a request uses a
 * token for.
 */

import { describe, expect, it } from "vitest";

import { resourceOf, resourceOfRequest } from "../../src/auth/resources.js";

const PUBLIC_URL = "https://ontoforge.example.com";

describe("resourceOf", () => {
  it("knows the REST API and every MCP mount", () => {
    expect(resourceOf(`${PUBLIC_URL}/api`, PUBLIC_URL)).toEqual({ kind: "api" });
    expect(resourceOf(`${PUBLIC_URL}/mcp/ontologies/books/model`, PUBLIC_URL)).toEqual({
      kind: "mcp",
      ontologyKey: "books",
      lensKey: null,
      rulesetKey: null,
    });
    expect(resourceOf(`${PUBLIC_URL}/mcp/ontologies/books/runtime/lenses/public`, PUBLIC_URL)).toEqual({
      kind: "mcp",
      ontologyKey: "books",
      lensKey: "public",
      rulesetKey: null,
    });
    expect(resourceOf(`${PUBLIC_URL}/mcp/ontologies/books/runtime/lenses/public/rulesets/r%C3%A4`, PUBLIC_URL)).toEqual({
      kind: "mcp",
      ontologyKey: "books",
      lensKey: "public",
      rulesetKey: "rä",
    });
  });

  it("knows nothing else", () => {
    for (const indicator of [
      PUBLIC_URL,
      `${PUBLIC_URL}/`,
      `${PUBLIC_URL}/api/`,
      `${PUBLIC_URL}/api/ontologies`,
      `${PUBLIC_URL}/mcp/ontologies/books`,
      `${PUBLIC_URL}/mcp/ontologies//model`,
      `${PUBLIC_URL}/mcp/ontologies/books/model/`,
      `${PUBLIC_URL}/mcp/ontologies/books/model?x=1`,
      `${PUBLIC_URL}/mcp/ontologies/books/runtime/lenses/public#x`,
      `${PUBLIC_URL}/mcp/ontologies/books/runtime/lenses/public/rulesets`,
      "https://ontoforge.example.com.evil.example/api",
      "http://ontoforge.example.com/api",
      "https://other.example.com/api",
    ]) {
      expect(resourceOf(indicator, PUBLIC_URL), indicator).toBeNull();
    }
  });
});

describe("resourceOfRequest", () => {
  it("is the MCP mount's own URL, the REST API's for /api/*, and none elsewhere", () => {
    expect(resourceOfRequest("/mcp/ontologies/books/model", true, PUBLIC_URL)).toBe(`${PUBLIC_URL}/mcp/ontologies/books/model`);
    expect(resourceOfRequest("/api/ontologies", false, PUBLIC_URL)).toBe(`${PUBLIC_URL}/api`);
    expect(resourceOfRequest("/api", false, PUBLIC_URL)).toBeNull();
    expect(resourceOfRequest("/metrics", false, PUBLIC_URL)).toBeNull();
  });
});
