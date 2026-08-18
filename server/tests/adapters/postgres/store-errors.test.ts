/**
 * Driver failures are translated at the two PostgreSQL doors.
 *
 * Port contract rule 4 (`core/ports.ts`): driver exceptions never cross
 * the port. The named-constraint truth table maps violations whose
 * service pre-check already exists onto the exact domain error the
 * pre-check would have raised had it won the race; everything else
 * becomes `StoreError`.
 *
 * Empirical note pinned here (spec label corrected on ticket 06): a
 * firing `ON DELETE RESTRICT` raises SQLSTATE **23001**
 * (restrict_violation), not 23503 — 23503 (foreign_key_violation) is the
 * insert-side/NO ACTION code. Verified on PostgreSQL 18.
 */

import { readdirSync, readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

import pg from "pg";
import { afterEach, beforeAll, beforeEach, describe, expect, it, vi } from "vitest";

import {
  initPool,
  runQuery,
  toStoreError,
  withTransaction,
} from "../../../src/adapters/postgres/errors.js";
import { ConflictError, NotFoundError, StoreError } from "../../../src/core/exceptions.js";
import { fakeDb } from "./support.js";

vi.mock("pg", async (importOriginal) => {
  const { fakePgModule } = await import("./support.js");
  return fakePgModule(await importOriginal());
});

function dbError(code: string, constraint?: string, detail?: string): pg.DatabaseError {
  const error = new pg.DatabaseError("constraint violation", 0, "error");
  error.code = code;
  if (constraint !== undefined) {
    error.constraint = constraint;
  }
  if (detail !== undefined) {
    error.detail = detail;
  }
  return error;
}

/** Drive one fabricated driver failure through door one. */
async function translated(exc: unknown): Promise<unknown> {
  fakeDb.onQuery = async () => {
    throw exc;
  };
  return runQuery("SELECT 1").catch((e: unknown) => e);
}

beforeAll(async () => {
  await initPool();
});

beforeEach(() => {
  fakeDb.reset();
});

afterEach(() => {
  vi.restoreAllMocks();
});

describe("the truth table: 23503 insert side (vanished parent)", () => {
  it.each(["relation_from_fk", "relation_to_fk", "document_chunk_entity_fk"])(
    "%s → NotFoundError naming the entity",
    async (constraint) => {
      const error = await translated(
        dbError(
          "23503",
          constraint,
          'Key (from_id)=(4f2d8a31-0000-4000-8000-000000000000) is not present in table "entity".',
        ),
      );
      expect(error).toBeInstanceOf(NotFoundError);
      expect((error as NotFoundError).message).toBe(
        "Entity '4f2d8a31-0000-4000-8000-000000000000' not found",
      );
    },
  );

  it.each(["relation_type_source_fk", "relation_type_target_fk"])(
    "%s on INSERT → NotFoundError naming the entity type",
    async (constraint) => {
      const error = await translated(
        dbError(
          "23503",
          constraint,
          'Key (source_entity_type_key)=(person) is not present in table "entity_type".',
        ),
      );
      expect(error).toBeInstanceOf(NotFoundError);
      expect((error as NotFoundError).message).toBe("Entity type 'person' not found");
    },
  );

  it("an unclaimed FK constraint falls through to StoreError", async () => {
    vi.spyOn(console, "error").mockImplementation(() => {});
    const error = await translated(
      dbError("23503", "saved_query_ontology_fk", "Key (ontology_id)=(x) is not present…"),
    );
    expect(error).toBeInstanceOf(StoreError);
  });
});

describe("the truth table: 23001 delete side (RESTRICT fired)", () => {
  // The spec's truth-table label says 23503 for the delete side; the real
  // SQLSTATE is 23001 (restrict_violation) — the outcome is unchanged.
  it.each(["relation_type_source_fk", "relation_type_target_fk"])(
    "%s on DELETE → ConflictError matching the pre-check",
    async (constraint) => {
      const error = await translated(
        dbError("23001", constraint, 'Key (key)=(person) is still referenced from table "relation_type".'),
      );
      expect(error).toBeInstanceOf(ConflictError);
      expect((error as ConflictError).message).toBe(
        "Entity type 'person' is referenced by one or more relation types",
      );
    },
  );

  it("a 23503 with an endpoint FK is the INSERT side, never Conflict", async () => {
    const error = await translated(
      dbError(
        "23503",
        "relation_type_source_fk",
        'Key (source_entity_type_key)=(person) is not present in table "entity_type".',
      ),
    );
    expect(error).toBeInstanceOf(NotFoundError);
  });

  it("an unclaimed constraint on 23001 falls through to StoreError", async () => {
    vi.spyOn(console, "error").mockImplementation(() => {});
    const error = await translated(dbError("23001", "relation_from_fk"));
    expect(error).toBeInstanceOf(StoreError);
  });
});

describe("the truth table: 23505 named uniques", () => {
  const cases: [string, string, string][] = [
    ["ontology_key_unique", "Key (key)=(hr) already exists.", "Ontology with key 'hr' already exists"],
    [
      "ontology_name_unique",
      "Key (name)=(Human Resources) already exists.",
      "Ontology with name 'Human Resources' already exists",
    ],
    [
      "entity_type_key_unique",
      "Key (key)=(person) already exists.",
      "Entity type with key 'person' already exists",
    ],
    [
      "relation_type_key_unique",
      "Key (key)=(works_for) already exists.",
      "Relation type with key 'works_for' already exists",
    ],
    [
      "property_def_entity_key_unique",
      "Key (entity_type_id, key)=(4f2d8a31-0000-4000-8000-000000000000, name) already exists.",
      "Property with key 'name' already exists on this type",
    ],
    [
      "property_def_relation_key_unique",
      "Key (relation_type_id, key)=(4f2d8a31-0000-4000-8000-000000000000, since) already exists.",
      "Property with key 'since' already exists on this type",
    ],
    [
      "ontology_includes_entity_unique",
      "Key (ontology_id, entity_type_id)=(a, b) already exists.",
      "Entity type is already included in this ontology",
    ],
    [
      "ontology_includes_relation_unique",
      "Key (ontology_id, relation_type_id)=(a, b) already exists.",
      "Relation type is already included in this ontology",
    ],
  ];

  it.each(cases)("%s → ConflictError", async (constraint, detail, message) => {
    const error = await translated(dbError("23505", constraint, detail));
    expect(error).toBeInstanceOf(ConflictError);
    expect((error as ConflictError).message).toBe(message);
  });

  it.each(["ai_agent_config_key_unique", "saved_query_key_unique"])(
    "the upsert arbiter %s is unclaimed — StoreError if it ever surfaces",
    async (constraint) => {
      vi.spyOn(console, "error").mockImplementation(() => {});
      const error = await translated(dbError("23505", constraint, "Key (ontology_id, key)=(a, b)…"));
      expect(error).toBeInstanceOf(StoreError);
    },
  );

  it("an unknown unique constraint falls through to StoreError", async () => {
    vi.spyOn(console, "error").mockImplementation(() => {});
    const error = await translated(dbError("23505", "some_future_unique", "Key (x)=(y)…"));
    expect(error).toBeInstanceOf(StoreError);
  });
});

describe("everything else becomes StoreError", () => {
  it.each([
    ["22P02 invalid text representation (a bug above the isUuid guard)", "22P02"],
    ["23502 not-null violation (an adapter bug)", "23502"],
    ["23514 check violation (an adapter bug)", "23514"],
    ["40001 serialization failure (no automatic retry)", "40001"],
    ["40P01 deadlock (no automatic retry)", "40P01"],
    ["57P01 admin shutdown", "57P01"],
  ])("%s", async (_label, code) => {
    vi.spyOn(console, "error").mockImplementation(() => {});
    const error = await translated(dbError(code));
    expect(error).toBeInstanceOf(StoreError);
  });

  it("a plain connection Error becomes StoreError", async () => {
    vi.spyOn(console, "error").mockImplementation(() => {});
    const error = await translated(new Error("connect ECONNREFUSED 127.0.0.1:5432"));
    expect(error).toBeInstanceOf(StoreError);
  });

  it("the StoreError message leaks nothing from the driver", async () => {
    vi.spyOn(console, "error").mockImplementation(() => {});
    const error = (await translated(
      dbError("23514", "property_def_one_owner", "Failing row contains (…)."),
    )) as StoreError;
    expect(error.message).toBe("A storage operation failed");
    for (const leak of ["23514", "property_def_one_owner", "postgres", "Failing row"]) {
      expect(error.message).not.toContain(leak);
    }
  });

  it("the withheld detail is logged against the errorId", async () => {
    const logged: string[] = [];
    vi.spyOn(console, "error").mockImplementation((...args: unknown[]) => {
      logged.push(args.map(String).join(" "));
    });
    const error = (await translated(dbError("23514", "property_def_one_owner"))) as StoreError;
    const record = logged.find((line) => line.includes("Storage failure"));
    expect(record).toBeDefined();
    expect(record).toContain(error.errorId);
    expect(record).toContain("23514");
    expect(record).toContain("property_def_one_owner");
  });

  it("toStoreError sets the cause and keeps the neutral message", () => {
    vi.spyOn(console, "error").mockImplementation(() => {});
    const original = dbError("57014");
    const error = toStoreError(original);
    expect(error.cause).toBe(original);
    expect(error.message).toBe("A storage operation failed");
    expect(error.errorId).toMatch(/^[0-9a-f]{8}$/);
  });
});

describe("door two: withTransaction", () => {
  it("wraps the work in BEGIN…COMMIT on one connection", async () => {
    const result = await withTransaction(async (querier) => {
      await querier.query("SELECT 2");
      return "done";
    });
    expect(result).toBe("done");
    expect(fakeDb.queries.map((q) => q.sql)).toEqual(["BEGIN", "SELECT 2", "COMMIT"]);
  });

  it("REPEATABLE READ is requested through BEGIN itself", async () => {
    await withTransaction(async () => undefined, "REPEATABLE READ");
    expect(fakeDb.queries[0]?.sql).toBe("BEGIN ISOLATION LEVEL REPEATABLE READ");
  });

  it("translates a mid-transaction driver failure and rolls back", async () => {
    fakeDb.onQuery = async (sql) => {
      if (sql.startsWith("INSERT")) {
        throw dbError("23505", "entity_type_key_unique", "Key (key)=(person) already exists.");
      }
      return { rows: [], rowCount: 0 };
    };
    const promise = withTransaction(async (querier) => {
      await querier.query("INSERT INTO entity_type VALUES (…)");
    });
    await expect(promise).rejects.toBeInstanceOf(ConflictError);
    expect(fakeDb.queries.map((q) => q.sql)).toContain("ROLLBACK");
    expect(fakeDb.queries.map((q) => q.sql)).not.toContain("COMMIT");
  });

  it("domain exceptions thrown between statements pass through untouched", async () => {
    const promise = withTransaction(async () => {
      throw new NotFoundError("Entity not found");
    });
    await expect(promise).rejects.toBeInstanceOf(NotFoundError);
  });

  it("ordinary bugs are not swallowed", async () => {
    const promise = withTransaction(async () => {
      throw new TypeError("unsupported operand");
    });
    await expect(promise).rejects.toBeInstanceOf(TypeError);
  });
});

describe("bypass prevention", () => {
  it("no adapter module imports the driver outside the door module", () => {
    // `errors.ts` owns the pool and the translation; a query module that
    // imported `pg` directly would silently reopen the untranslated gap.
    // (`.query(` cannot be the token — it legitimately appears everywhere.)
    const adapterDir = join(
      dirname(fileURLToPath(import.meta.url)),
      "../../../src/adapters/postgres",
    );
    const sources = (dir: string, prefix = ""): string[] =>
      readdirSync(dir, { withFileTypes: true }).flatMap((entry) =>
        entry.isDirectory()
          ? sources(join(dir, entry.name), `${prefix}${entry.name}/`)
          : entry.name.endsWith(".ts")
            ? [`${prefix}${entry.name}`]
            : [],
      );
    const offenders = sources(adapterDir)
      .filter((name) => name !== "errors.ts")
      .filter((name) => readFileSync(join(adapterDir, name), "utf8").includes('from "pg"'));
    expect(offenders).toEqual([]);
  });
});
