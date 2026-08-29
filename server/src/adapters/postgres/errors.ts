/**
 * The adapter's two database doors and driver-error translation.
 *
 * Port contract rule 4 (`core/ports.ts`): driver exceptions never cross
 * the port. This module is the only place in the adapter that imports
 * `pg` — it owns the connection pool and exports exactly two query
 * doors:
 *
 * - `runQuery(sql, params)` — a single statement via `pool.query`, plus
 *   `runArrayQuery`, the same door in `rowMode: "array"` for the OQL
 *   compiler's positional result contract.
 * - `withTransaction(work)` — `pool.connect()`, `BEGIN` … `COMMIT`, with
 *   `ROLLBACK` + `release()` on failure. Any method issuing two or more
 *   statements uses it, reads included; there is deliberately no bare
 *   `withClient`.
 *
 * `pg` has no single error hierarchy (server errors are `DatabaseError`;
 * connection failures are plain `Error`s), so the catch is placed instead
 * of filtered: translation happens only at the driver boundaries —
 * connect and query. `work` receives a thin `Querier` wrapper, never the
 * raw `PoolClient`; code between statements sits outside every catch, so
 * domain exceptions and programming errors propagate as themselves.
 *
 * Named-constraint violations that a service pre-check already guards are
 * translated to the exact domain error the pre-check would have raised
 * had it won the race (the truth table below). Everything else becomes
 * `StoreError`: 22P02 (a bug above the `isUuid` guard, never a phantom
 * not-found), 23502/23514 (adapter bugs), 40001/40P01 (no automatic
 * retry), and the connection/resource classes 08/53/57. What was withheld
 * from the client is logged against the error's `errorId`.
 */

import pg from "pg";
import type { PoolClient } from "pg";

import { settings } from "../../config.js";
import { ConflictError, NotFoundError, OntoForgeError, StoreError } from "../../core/exceptions.js";
import type { Row } from "../../core/ports.js";

/** A statement result with every driver type stripped. */
export interface DbResult {
  rows: Row[];
  rowCount: number;
}

/** The statement surface handed to `withTransaction` work functions. */
export interface Querier {
  query(text: string, params?: unknown[]): Promise<DbResult>;
}

/** Transaction isolation. REPEATABLE READ is used by the two
 * `getFullSchema`s only (their coherent-snapshot obligation); everything
 * else stays at the READ COMMITTED default. */
export type IsolationLevel = "READ COMMITTED" | "REPEATABLE READ";

let pool: pg.Pool | null = null;

/**
 * Create the process-lifetime pool from the config surface and verify
 * connectivity (the mirror of the Neo4j adapter's `verifyConnectivity` —
 * the one sanctioned translation site outside the doors).
 *
 * The DSN is parsed once into a fully discrete `pg` config — never
 * `connectionString` plus discrete credentials mixed, whose merge
 * semantics are a version-dependent sharp edge in `pg`. Credentials ride
 * separately in `DB_USER`/`DB_PASSWORD`; libpq env vars are not used.
 * Pool knobs stay at `pg` defaults.
 */
export async function initPool(): Promise<void> {
  const url = new URL(settings.DB_URI);
  pool = new pg.Pool({
    host: url.hostname,
    port: url.port === "" ? 5432 : Number(url.port),
    database: url.pathname.replace(/^\//, ""),
    user: settings.DB_USER,
    password: settings.DB_PASSWORD,
  });
  try {
    await pool.query("SELECT 1");
  } catch (exc) {
    const failed = pool;
    pool = null;
    await failed.end().catch(() => undefined);
    throw toStoreError(exc);
  }
}

export async function closePool(): Promise<void> {
  if (pool !== null) {
    await pool.end();
    pool = null;
  }
}

function getPool(): pg.Pool {
  if (pool === null) {
    throw new Error("PostgreSQL pool not initialized");
  }
  return pool;
}

/** Door one: a single statement on the shared pool. */
export async function runQuery(text: string, params?: unknown[]): Promise<DbResult> {
  const active = getPool();
  try {
    const result = await active.query(text, params);
    return { rows: result.rows as Row[], rowCount: result.rowCount ?? 0 };
  } catch (exc) {
    throw translate(exc);
  }
}

/**
 * Door one in `rowMode: "array"`: positional rows instead of key/value
 * ones. The OQL compiler names its own columns — several of them may
 * repeat, and only the compiled plan knows which is which — so the
 * result rows must arrive in projection order, unkeyed.
 */
export async function runArrayQuery(text: string, params?: unknown[]): Promise<unknown[][]> {
  const active = getPool();
  try {
    const result = await active.query({ text, values: params, rowMode: "array" });
    return result.rows as unknown[][];
  } catch (exc) {
    throw translate(exc);
  }
}

/** Door two: `work` runs inside one transaction on one connection. */
export async function withTransaction<T>(
  work: (querier: Querier) => Promise<T>,
  isolation: IsolationLevel = "READ COMMITTED",
): Promise<T> {
  const active = getPool();
  let client: PoolClient;
  try {
    client = await active.connect();
  } catch (exc) {
    throw translate(exc);
  }
  const querier: Querier = {
    async query(text: string, params?: unknown[]): Promise<DbResult> {
      try {
        const result = await client.query(text, params);
        return { rows: result.rows as Row[], rowCount: result.rowCount ?? 0 };
      } catch (exc) {
        throw translate(exc);
      }
    },
  };
  let committed = false;
  try {
    await querier.query(
      isolation === "REPEATABLE READ" ? "BEGIN ISOLATION LEVEL REPEATABLE READ" : "BEGIN",
    );
    const result = await work(querier);
    await querier.query("COMMIT");
    committed = true;
    return result;
  } finally {
    if (!committed) {
      // The failure that got us here is what matters; a rollback error
      // on a broken connection must not mask it.
      await client.query("ROLLBACK").catch(() => undefined);
    }
    client.release();
  }
}

/** Log a driver failure and return the `StoreError` that replaces it
 * (parity with the Neo4j adapter's `toStoreError`): SQLSTATE, constraint
 * name, driver message, and stack go to the server log against the
 * generated `errorId`; the client message stays the generic default. */
export function toStoreError(exc: unknown): StoreError {
  const error = new StoreError();
  const storage =
    exc instanceof pg.DatabaseError
      ? ` [sqlstate ${exc.code ?? "?"}, constraint ${exc.constraint ?? "-"}]`
      : "";
  if (exc instanceof Error) {
    error.cause = exc;
    console.error(
      `Storage failure ${error.errorId}:${storage} ${exc.name}: ${exc.message}`,
      exc.stack ?? "",
    );
  } else {
    console.error(`Storage failure ${error.errorId}: ${String(exc)}`);
  }
  return error;
}

/** Translate whatever the driver threw at a door boundary. */
function translate(exc: unknown): OntoForgeError {
  if (exc instanceof pg.DatabaseError) {
    const domain = translateConstraint(exc);
    if (domain !== null) {
      return domain;
    }
  }
  return toStoreError(exc);
}

/** The insert-side FK constraints whose vanished parent is an entity. */
const ENTITY_FKS = new Set(["relation_from_fk", "relation_to_fk", "document_chunk_entity_fk"]);

/** The relation-type endpoint FKs: NotFound on the insert side, Conflict
 * when their RESTRICT fires on an entity-type DELETE. */
const ENDPOINT_FKS = new Set(["relation_type_source_fk", "relation_type_target_fk"]);

/**
 * The named-constraint truth table: one lookup, keyed by the constraint
 * name PG reports plus the violation direction, mapping to the exact
 * domain error the service pre-check would have raised had it won the
 * race. PG distinguishes the directions by SQLSTATE: the insert-side
 * check raises 23503 (foreign_key_violation) while a firing `ON DELETE
 * RESTRICT` raises 23001 (restrict_violation). The table only claims
 * constraints whose pre-check already exists; anything else falls
 * through to `StoreError` (rule 4's "violations the code did not
 * anticipate"). The two upsert arbiters (`ai_agent_config_key_unique`,
 * `saved_query_key_unique`) never surface — they arbitrate `ON CONFLICT`.
 */
function translateConstraint(exc: pg.DatabaseError): OntoForgeError | null {
  const constraint = exc.constraint;
  if (constraint === undefined) {
    return null;
  }
  const value = detailKeyValue(exc.detail) ?? "unknown";
  switch (exc.code) {
    case "23503": // insert side: the parent vanished between pre-check and INSERT
      if (ENTITY_FKS.has(constraint)) {
        return new NotFoundError(`Entity '${value}' not found`);
      }
      if (ENDPOINT_FKS.has(constraint)) {
        return new NotFoundError(`Entity type '${value}' not found`);
      }
      return null;
    case "23001": // delete side: RESTRICT fired on an entity-type DELETE
      if (ENDPOINT_FKS.has(constraint)) {
        return new ConflictError(
          `Entity type '${value}' is referenced by one or more relation types`,
        );
      }
      return null;
    case "23505":
      switch (constraint) {
        case "lens_key_unique":
          return new ConflictError(`Lens with key '${value}' already exists`);
        case "lens_name_unique":
          return new ConflictError(`Lens with name '${value}' already exists`);
        case "entity_type_key_unique":
          return new ConflictError(`Entity type with key '${value}' already exists`);
        case "relation_type_key_unique":
          return new ConflictError(`Relation type with key '${value}' already exists`);
        case "property_def_entity_key_unique":
        case "property_def_relation_key_unique":
          return new ConflictError(`Property with key '${value}' already exists on this type`);
        case "lens_includes_entity_unique":
          return new ConflictError("Entity type is already included in this lens");
        case "lens_includes_relation_unique":
          return new ConflictError("Relation type is already included in this lens");
        default:
          return null;
      }
    default:
      return null;
  }
}

/**
 * Extract the interesting value from a constraint violation's DETAIL
 * line, `Key (col[, col])=(value[, value]) …`. For a single-column key
 * the whole value is returned verbatim (it may contain commas); for a
 * composite key the last component is the one worth naming (the leading
 * components are uuids, which never contain `, `).
 */
function detailKeyValue(detail: string | undefined): string | null {
  if (detail === undefined) {
    return null;
  }
  const match = /^Key \((?<cols>[^)]+)\)=\((?<vals>.*)\) /.exec(detail);
  if (!match?.groups) {
    return null;
  }
  const cols = (match.groups["cols"] as string).split(", ");
  const vals = match.groups["vals"] as string;
  if (cols.length === 1) {
    return vals;
  }
  const parts = vals.split(", ");
  return parts[parts.length - 1] ?? null;
}
