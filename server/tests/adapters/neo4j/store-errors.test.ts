/**
 * Driver failures are translated at the persistence-port boundary.
 *
 * Port contract rule 4 (`core/ports.ts`): driver exceptions never cross the
 * port.
 */

import { readdirSync, readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

import type { Driver } from "neo4j-driver";
import { Neo4jError } from "neo4j-driver";
import { afterEach, describe, expect, it, vi } from "vitest";

import { runSession, toStoreError } from "../../../src/adapters/neo4j/errors.js";
import { Neo4jModelingStore } from "../../../src/adapters/neo4j/modelingStore.js";
import { NotFoundError, StoreError } from "../../../src/core/exceptions.js";

// The message the reproduction in issue #20 produced. Nothing from it may
// reach the client: it names the vendor, the physical index, and the
// driver's own error code.
const DRIVER_MESSAGE =
  "Vector index 'entity_embedding' has a configured dimensionality of 1024, " +
  "but the provided vector has dimension 768.";

function driverError(): Neo4jError {
  return new Neo4jError(DRIVER_MESSAGE, "Neo.ClientError.Procedure.ProcedureCallFailed", "", "");
}

/** A fake driver whose sessions run the given behaviour. */
function fakeDriver(run?: () => Promise<unknown>): Driver {
  return {
    session: () => ({
      run: run ?? (async () => ({ records: [] })),
      close: async () => undefined,
    }),
  } as unknown as Driver;
}

afterEach(() => {
  vi.restoreAllMocks();
});

describe("the translation itself", () => {
  it("a server-side driver error becomes StoreError with the original as cause", async () => {
    vi.spyOn(console, "error").mockImplementation(() => {});
    const promise = runSession(fakeDriver(), async () => {
      throw driverError();
    });
    await expect(promise).rejects.toBeInstanceOf(StoreError);

    const error = await promise.catch((e: StoreError) => e);
    expect(error.cause).toBeInstanceOf(Neo4jError);
    expect(error.errorId).toMatch(/^[0-9a-f]{8}$/);
  });

  it("a client-side driver failure becomes StoreError", async () => {
    // Connectivity failures are Neo4jError instances carrying a
    // service-unavailable code.
    vi.spyOn(console, "error").mockImplementation(() => {});
    const promise = runSession(fakeDriver(), async () => {
      throw new Neo4jError(
        "Unable to retrieve routing information",
        "ServiceUnavailable",
        "",
        "",
      );
    });
    await expect(promise).rejects.toBeInstanceOf(StoreError);
  });

  it("the StoreError message leaks nothing from the driver", async () => {
    vi.spyOn(console, "error").mockImplementation(() => {});
    const error = await runSession(fakeDriver(), async () => {
      throw driverError();
    }).catch((e: StoreError) => e);

    expect(error.message).toBe("A storage operation failed");
    for (const leak of ["neo4j", "Neo4j", "Vector index", "entity_embedding", "1024"]) {
      expect(error.message).not.toContain(leak);
    }
  });

  it("domain exceptions pass through untouched", async () => {
    const promise = runSession(fakeDriver(), async () => {
      throw new NotFoundError("Entity not found");
    });
    await expect(promise).rejects.toBeInstanceOf(NotFoundError);
  });

  it("ordinary bugs are not swallowed", async () => {
    const promise = runSession(fakeDriver(), async () => {
      throw new TypeError("unsupported operand");
    });
    await expect(promise).rejects.toBeInstanceOf(TypeError);
  });

  it("the driver failure is logged against the errorId", async () => {
    const logged: string[] = [];
    vi.spyOn(console, "error").mockImplementation((...args: unknown[]) => {
      logged.push(args.map(String).join(" "));
    });

    const error = await runSession(fakeDriver(), async () => {
      throw driverError();
    }).catch((e: StoreError) => e);

    const record = logged.find((line) => line.includes("Storage failure"));
    expect(record).toBeDefined();
    expect(record).toContain(error.errorId);
    // The detail withheld from the client must be present server-side.
    expect(record).toContain(DRIVER_MESSAGE);
  });

  it("toStoreError sets the cause and keeps the neutral message", () => {
    vi.spyOn(console, "error").mockImplementation(() => {});
    const original = driverError();
    const error = toStoreError(original);
    expect(error.cause).toBe(original);
    expect(error.message).toBe("A storage operation failed");
  });
});

describe("store methods are covered by it", () => {
  it("a store method raises StoreError when the driver fails", async () => {
    vi.spyOn(console, "error").mockImplementation(() => {});
    const store = new Neo4jModelingStore(
      fakeDriver(async () => {
        throw driverError();
      }),
    );
    await expect(store.findReservedTypeKeysInUse()).rejects.toBeInstanceOf(StoreError);
  });

  it("no adapter module opens an untranslated session", () => {
    // `errors.runSession` is the adapter's only door to the database. A new
    // store method written as `this.driver.session()` would silently reopen
    // the gap this guard closes, and no behavioural test would catch it.
    const adapterDir = join(
      dirname(fileURLToPath(import.meta.url)),
      "../../../src/adapters/neo4j",
    );
    const offenders = readdirSync(adapterDir)
      .filter((name) => name.endsWith(".ts") && name !== "errors.ts")
      .filter((name) => readFileSync(join(adapterDir, name), "utf8").includes(".session("));
    expect(offenders).toEqual([]);
  });
});
