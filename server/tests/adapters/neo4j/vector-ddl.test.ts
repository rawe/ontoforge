/**
 * Vector-index metadata limits and width reconciliation — ported from
 * `backend/tests/test_database.py`. The database calls are served by a
 * fake driver whose session answers `SHOW VECTOR INDEXES` with a canned
 * width and records every statement it is given.
 */

import type { Driver } from "neo4j-driver";
import { describe, expect, it } from "vitest";

import {
  MAX_VECTOR_FILTER_VALUE_BYTES,
  reconcileIndexDimensions,
  validateVectorIndexedProperties,
} from "../../../src/adapters/neo4j/ddl.js";
import { ValidationError } from "../../../src/core/exceptions.js";
import { captureLogs, ENTITY_TYPE_SCOPE } from "../../vectorDrift.js";

describe("validateVectorIndexedProperties", () => {
  it("accepts short strings and non-string values", () => {
    validateVectorIndexedProperties(
      "section",
      { heading: "Short text", order: 1 },
      ["heading", "order"],
      "ent-1",
    );
  });

  it("rejects a UTF-8 byte overflow, naming property and entity", () => {
    const oversized = "x".repeat(MAX_VECTOR_FILTER_VALUE_BYTES + 1);

    expect(() =>
      validateVectorIndexedProperties("section", { content: oversized }, ["content"], "ent-1"),
    ).toThrow(/Property 'content' on entity 'ent-1' is too large/);
  });

  it("measures bytes, not characters (multi-byte overflow)", () => {
    // 16384 three-byte characters = 49152 bytes but only 16384 chars.
    const multibyte = "€".repeat(16_384);
    expect(() =>
      validateVectorIndexedProperties("section", { content: multibyte }, ["content"]),
    ).toThrow(ValidationError);
  });

  it("collects the failing property in details.fields", () => {
    const oversized = "x".repeat(MAX_VECTOR_FILTER_VALUE_BYTES + 1);
    try {
      validateVectorIndexedProperties("section", { content: oversized }, ["content"], "ent-1");
      expect.unreachable("should have thrown");
    } catch (error) {
      expect(error).toBeInstanceOf(ValidationError);
      const details = (error as ValidationError).details as { fields: Record<string, string> };
      expect(details.fields.content).toContain("indexed property size limit");
    }
  });
});

// --- Width reconciliation ---------------------------------------------------

interface FakeSession {
  statements: string[];
  run: (query: string, params?: Record<string, unknown>) => Promise<{ records: unknown[] }>;
  close: () => Promise<void>;
}

/** A driver whose sessions answer SHOW VECTOR INDEXES with `existing` (or
 * nothing when null) and record every other statement. */
function fakeDriver(existingDimensions: number | null): { driver: Driver; session: FakeSession } {
  const session: FakeSession = {
    statements: [],
    run: async (query: string) => {
      if (query.includes("SHOW VECTOR INDEXES")) {
        if (existingDimensions === null) {
          return { records: [] };
        }
        return {
          records: [
            {
              get: (key: string) =>
                key === "options"
                  ? { indexConfig: { "vector.dimensions": existingDimensions } }
                  : null,
            },
          ],
        };
      }
      session.statements.push(query);
      return { records: [] };
    },
    close: async () => {},
  };
  return { driver: { session: () => session } as unknown as Driver, session };
}

async function reconcile(
  existingDimensions: number | null,
  recreate: boolean,
): Promise<{ statements: string[]; warnings: string[]; infos: string[] }> {
  const captured = captureLogs();
  const { driver, session } = fakeDriver(existingDimensions);
  try {
    await reconcileIndexDimensions(driver, "person_embedding", ENTITY_TYPE_SCOPE, 768, recreate);
  } finally {
    captured.restore();
  }
  return { statements: session.statements, warnings: captured.warnings, infos: captured.infos };
}

describe("reconcileIndexDimensions", () => {
  it("leaves matching dimensions alone", async () => {
    const { statements, warnings, infos } = await reconcile(768, false);
    expect(statements).toEqual([]);
    expect(warnings).toEqual([]);
    expect(infos).toEqual([]);
  });

  it("leaves an absent index to the create statement", async () => {
    const { statements, warnings, infos } = await reconcile(null, false);
    expect(statements).toEqual([]);
    expect(warnings).toEqual([]);
    expect(infos).toEqual([]);
  });

  it("warns on mismatch without dropping the index", async () => {
    const { statements, warnings } = await reconcile(1024, false);
    expect(statements).toEqual([]);
    const text = warnings.join("\n");
    expect(text).toContain(ENTITY_TYPE_SCOPE);
    expect(text).toContain("1024");
    expect(text).toContain("768");
    expect(text).toContain("/model/rebuild-embeddings");
  });

  it("names no vendor or physical index in the warning", async () => {
    const { warnings } = await reconcile(1024, false);
    const text = warnings.join("\n");
    for (const leak of ["eo4j", "Cypher", "person_embedding", "VECTOR INDEX", "label"]) {
      expect(text, `'${leak}' leaked into the warning`).not.toContain(leak);
    }
  });

  it("drops the mismatched index when recreation is requested", async () => {
    const { statements, warnings, infos } = await reconcile(1024, true);
    expect(statements).toEqual(["DROP INDEX person_embedding IF EXISTS"]);
    expect(warnings).toEqual([]);
    expect(infos.join("\n")).toContain(ENTITY_TYPE_SCOPE);
  });
});
