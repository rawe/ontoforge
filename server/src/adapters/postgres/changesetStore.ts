/**
 * `ChangesetStore` on PostgreSQL: one `changeset` row per changeset, one
 * `changeset_object` row per entity or relation it touches and one
 * `changeset_value` row per staged property value, in an ontology's
 * namespace.
 *
 * - Every mutation but `touch` and `sweep` first takes the changeset row
 *   `FOR UPDATE NOWAIT` in its own transaction (or the bound one): a row
 *   held by a commit or another mutation answers a `ConflictError` at
 *   once. `touch` and `sweep` skip a held row instead.
 * - The state is judged under the row lock, in the statement that writes:
 *   apply, submit and discard change a draft changeset only, unsubmit a
 *   submitted one; apply and submit also only at the version the service
 *   read. A change landing between the service's read and the write is
 *   therefore never overwritten.
 * - An object's first touch is the clock at its insert, so the objects one
 *   change adds keep the order it gives them.
 * - A changeset's number is the lens's highest number plus one, taken
 *   under a transaction-scoped advisory lock keyed by the lens, so two
 *   starts never share one. A number freed by a commit or discard of the
 *   highest is given again.
 * - Objects die with their changeset, values with their object (`ON DELETE
 *   CASCADE`).
 * - `lockForCommit` runs only inside a bound store. It first bounds the
 *   transaction's lock waits (`lock_timeout`, 5 s). The commit lock is a
 *   transaction-scoped advisory lock keyed by the namespace, so it holds
 *   across server instances and dies with the transaction.
 */

import { ConflictError } from "../../core/exceptions.js";
import type {
  ChangesetChange,
  ChangesetRecord,
  ChangesetStore,
  ChangesetSummary,
  Row,
  StagedAction,
  StagedKind,
  StagedObjectRecord,
} from "../../core/ports.js";
import { runQuery, withTransaction, type DbResult, type Querier } from "./errors.js";
import { isUuid } from "./rows.js";

/** The changeset columns of `c`. */
const BASE_COLS = `c.changeset_id, c.lens_id, c.number, c.ruleset_key, c.version, c.note, c.submitted_at,
       c.created_at, c.last_change_at`;

/** The changeset columns of `c` and its number of staged objects. */
const COLS = `${BASE_COLS},
       (SELECT count(*)::int FROM changeset_object o WHERE o.changeset_id = c.changeset_id) AS object_count`;

const OBJECT_COLS = `object_id, kind, type_key, action, from_id, to_id, first_touched_at`;

/** The version bump and last change of every mutation. */
const BUMP = `version = c.version + 1, last_change_at = now()`;

/** How long a commit waits for a row another transaction holds;
 * past it, 55P03 is a `ConflictError`. */
const COMMIT_LOCK_TIMEOUT = "5s";

/** The answer of `lockForCommit` when another commit holds the lock. */
const COMMIT_RUNNING = "Another commit is running; try again";

function busy(id: string): string {
  return `Changeset '${id}' is busy; try again`;
}

function toChangeset(row: Row): ChangesetRecord {
  return {
    id: row.changeset_id as string,
    lensId: row.lens_id as string,
    number: row.number as number,
    rulesetKey: row.ruleset_key as string | null,
    version: row.version as number,
    note: row.note as string | null,
    submittedAt: row.submitted_at as Date | null,
    createdAt: row.created_at as Date,
    lastChangeAt: row.last_change_at as Date,
    objectCount: row.object_count as number,
  };
}

function toObject(row: Row): StagedObjectRecord {
  return {
    objectId: row.object_id as string,
    kind: row.kind as StagedKind,
    typeKey: row.type_key as string,
    action: row.action as StagedAction,
    fromId: row.from_id as string | null,
    toId: row.to_id as string | null,
    firstTouchedAt: row.first_touched_at as Date,
    values: [],
  };
}

/** Take the changeset row `FOR UPDATE NOWAIT`; false when it is gone. A
 * held row is a `ConflictError` with `message`. */
async function lockRow(querier: Querier, id: string, message: string): Promise<boolean> {
  try {
    const result = await querier.query(
      `SELECT 1 FROM changeset WHERE changeset_id = $1 FOR UPDATE NOWAIT`,
      [id],
    );
    return result.rowCount > 0;
  } catch (exc) {
    throw exc instanceof ConflictError ? new ConflictError(message) : exc;
  }
}

export class PostgresChangesetStore implements ChangesetStore {
  /** `bound`: the connection of the runtime store's transaction. */
  constructor(
    private readonly namespace: string,
    private readonly bound?: Querier,
  ) {}

  private query(text: string, params?: unknown[]): Promise<DbResult> {
    if (this.bound !== undefined) {
      return this.bound.query(text, params);
    }
    return runQuery(text, params, this.namespace);
  }

  private tx<T>(work: (querier: Querier) => Promise<T>): Promise<T> {
    if (this.bound !== undefined) {
      return work(this.bound);
    }
    return withTransaction(work, "READ COMMITTED", this.namespace);
  }

  /** One mutation of a changeset that exists: the row taken NOWAIT, then
   * `work`; null when the changeset is gone. */
  private mutate<T>(id: string, work: (querier: Querier) => Promise<T>): Promise<T | null> {
    if (!isUuid(id)) {
      return Promise.resolve(null);
    }
    return this.tx(async (querier) => ((await lockRow(querier, id, busy(id))) ? work(querier) : null));
  }

  async start(changeset: {
    id: string;
    lensId: string;
    rulesetKey: string | null;
    note: string | null;
  }): Promise<ChangesetRecord> {
    return this.tx(async (querier) => {
      await querier.query(`SELECT pg_advisory_xact_lock(hashtextextended('ontoforge.changeset-number.' || $1, 0))`, [
        changeset.lensId,
      ]);
      const result = await querier.query(
        `INSERT INTO changeset AS c (changeset_id, lens_id, number, ruleset_key, version, note)
         SELECT $1, $2, COALESCE(max(number), 0) + 1, $3, 1, $4 FROM changeset WHERE lens_id = $2
         RETURNING ${COLS}`,
        [changeset.id, changeset.lensId, changeset.rulesetKey, changeset.note],
      );
      return toChangeset(result.rows[0]!);
    });
  }

  async get(id: string, lensId: string, rulesetKey: string | null): Promise<ChangesetRecord | null> {
    if (!isUuid(id)) {
      return null;
    }
    const params: unknown[] = [id, lensId];
    let ruleset = "";
    if (rulesetKey !== null) {
      params.push(rulesetKey);
      ruleset = " AND c.ruleset_key = $3";
    }
    const result = await this.query(
      `SELECT ${COLS} FROM changeset c WHERE c.changeset_id = $1 AND c.lens_id = $2${ruleset}`,
      params,
    );
    const row = result.rows[0];
    return row === undefined ? null : toChangeset(row);
  }

  /** One statement: a row per changeset, operation and type key. */
  async list(lensId: string, rulesetKey: string | null): Promise<ChangesetSummary[]> {
    if (!isUuid(lensId)) {
      return [];
    }
    const params: unknown[] = [lensId];
    let ruleset = "";
    if (rulesetKey !== null) {
      params.push(rulesetKey);
      ruleset = " AND c.ruleset_key = $2";
    }
    const result = await this.query(
      `SELECT ${BASE_COLS}, o.action || '_' || o.kind AS operation, o.type_key,
              count(o.object_id)::int AS object_count
         FROM changeset c LEFT JOIN changeset_object o ON o.changeset_id = c.changeset_id
        WHERE c.lens_id = $1${ruleset}
        GROUP BY c.changeset_id, o.action, o.kind, o.type_key
        ORDER BY c.number, c.created_at, c.changeset_id, operation, o.type_key`,
      params,
    );
    const summaries = new Map<string, ChangesetSummary>();
    for (const row of result.rows) {
      const id = row.changeset_id as string;
      let summary = summaries.get(id);
      if (summary === undefined) {
        summary = { ...toChangeset({ ...row, object_count: 0 }), operations: {}, typeKeys: [] };
        summaries.set(id, summary);
      }
      const count = row.object_count as number;
      if (count === 0) {
        continue;
      }
      const operation = row.operation as string;
      const typeKey = row.type_key as string;
      summary.objectCount += count;
      summary.operations[operation] = (summary.operations[operation] ?? 0) + count;
      if (!summary.typeKeys.includes(typeKey)) {
        summary.typeKeys.push(typeKey);
      }
    }
    for (const summary of summaries.values()) {
      summary.typeKeys.sort();
    }
    return [...summaries.values()];
  }

  /** The values of `objects`, read in one statement and attached. */
  private async withValues(id: string, objects: StagedObjectRecord[]): Promise<StagedObjectRecord[]> {
    if (objects.length === 0) {
      return objects;
    }
    const result = await this.query(
      `SELECT object_id, property_key, value, before, bytes FROM changeset_value
        WHERE changeset_id = $1 AND object_id = ANY($2::uuid[])
        ORDER BY object_id, property_key`,
      [id, objects.map((object) => object.objectId)],
    );
    const byId = new Map(objects.map((object) => [object.objectId, object] as const));
    for (const row of result.rows) {
      byId.get(row.object_id as string)!.values.push({
        propertyKey: row.property_key as string,
        value: row.value,
        before: row.before as Row | null,
        bytes: row.bytes as number,
      });
    }
    return objects;
  }

  /** On the `(changeset_id, first_touched_at, object_id)` index. */
  async page(id: string, offset: number, limit: number): Promise<StagedObjectRecord[]> {
    if (!isUuid(id)) {
      return [];
    }
    const result = await this.query(
      `SELECT ${OBJECT_COLS} FROM changeset_object WHERE changeset_id = $1
        ORDER BY first_touched_at, object_id LIMIT $2 OFFSET $3`,
      [id, limit, offset],
    );
    return this.withValues(id, result.rows.map(toObject));
  }

  async objects(id: string, objectIds: string[]): Promise<StagedObjectRecord[]> {
    const valid = objectIds.filter(isUuid);
    if (!isUuid(id) || valid.length === 0) {
      return [];
    }
    const result = await this.query(
      `SELECT ${OBJECT_COLS} FROM changeset_object WHERE changeset_id = $1 AND object_id = ANY($2::uuid[])
        ORDER BY first_touched_at, object_id`,
      [id, valid],
    );
    return this.withValues(id, result.rows.map(toObject));
  }

  /** No index on the ends: the scan stays inside the changeset's own rows
   * (the primary key's prefix), bounded by the cap on staged objects. */
  async relationsAt(id: string, entityId: string): Promise<string[]> {
    if (!isUuid(id) || !isUuid(entityId)) {
      return [];
    }
    const result = await this.query(
      `SELECT object_id FROM changeset_object
        WHERE changeset_id = $1 AND kind = 'relation' AND (from_id = $2 OR to_id = $2)
        ORDER BY first_touched_at, object_id`,
      [id, entityId],
    );
    return result.rows.map((row) => row.object_id as string);
  }

  /** The objects are found by their values (`changeset_value_match_idx`),
   * never by reading the whole changeset, so that a batch of puts stays
   * linear: those that stage one of `values`, kept when every value of
   * those keys they stage matches. */
  async entityObjectsStaging(id: string, typeKey: string, values: Row): Promise<StagedObjectRecord[]> {
    if (!isUuid(id) || Object.keys(values).length === 0) {
      return [];
    }
    // One equality per key on all three columns of the index, which the
    // planner prefers even before the rows staged here have statistics.
    const keys = Object.keys(values);
    const hits = keys
      .map((_, i) => `SELECT object_id FROM changeset_value
          WHERE changeset_id = $1 AND property_key = $${i * 2 + 4}
            AND md5(value::text) = md5($${i * 2 + 5}::jsonb::text) AND value = $${i * 2 + 5}::jsonb`)
      .join(" UNION ");
    const result = await this.query(
      `WITH hit AS MATERIALIZED (${hits})
       SELECT ${OBJECT_COLS.split(", ").map((column) => `o.${column.trim()}`).join(", ")}
         FROM hit h
         JOIN changeset_object o ON o.changeset_id = $1 AND o.object_id = h.object_id
        WHERE o.kind = 'entity' AND o.type_key = $2 AND o.action <> 'delete'
          AND NOT EXISTS (
            SELECT 1 FROM changeset_value w
             WHERE w.changeset_id = $1 AND w.object_id = h.object_id
               AND w.property_key = ANY($3::text[]) AND w.value <> $${keys.length * 2 + 4}::jsonb -> w.property_key)
        ORDER BY o.first_touched_at, o.object_id`,
      [id, typeKey, keys, ...keys.flatMap((key) => [key, JSON.stringify(values[key])]), JSON.stringify(values)],
    );
    return this.withValues(id, result.rows.map(toObject));
  }

  /** The scan stays inside the changeset's own rows (the primary key's
   * prefix), bounded by the cap on staged objects. */
  async entityObjectsKeyed(id: string, typeKey: string, keys: string[]): Promise<StagedObjectRecord[]> {
    if (!isUuid(id)) {
      return [];
    }
    const result = await this.query(
      `SELECT ${OBJECT_COLS} FROM changeset_object
        WHERE changeset_id = $1 AND kind = 'entity' AND type_key = $2
        ORDER BY first_touched_at, object_id`,
      [id, typeKey],
    );
    const objects = result.rows.map(toObject);
    if (objects.length === 0) {
      return objects;
    }
    const values = await this.query(
      `SELECT object_id, property_key, value, before, bytes FROM changeset_value
        WHERE changeset_id = $1 AND property_key = ANY($2::text[])
        ORDER BY object_id, property_key`,
      [id, keys],
    );
    const byId = new Map(objects.map((object) => [object.objectId, object] as const));
    for (const row of values.rows) {
      byId.get(row.object_id as string)?.values.push({
        propertyKey: row.property_key as string,
        value: row.value,
        before: row.before as Row | null,
        bytes: row.bytes as number,
      });
    }
    return objects;
  }

  async relationObjectsAt(
    id: string,
    typeKey: string,
    pairs: { fromId: string; toId: string }[],
  ): Promise<StagedObjectRecord[]> {
    const valid = pairs.filter((pair) => isUuid(pair.fromId) && isUuid(pair.toId));
    if (!isUuid(id) || valid.length === 0) {
      return [];
    }
    const result = await this.query(
      `SELECT ${OBJECT_COLS.split(", ").map((column) => `o.${column.trim()}`).join(", ")}
         FROM changeset_object o
         JOIN unnest($3::uuid[], $4::uuid[]) AS p (from_id, to_id)
           ON p.from_id = o.from_id AND p.to_id = o.to_id
        WHERE o.changeset_id = $1 AND o.kind = 'relation' AND o.type_key = $2
        ORDER BY o.first_touched_at, o.object_id`,
      [id, typeKey, valid.map((pair) => pair.fromId), valid.map((pair) => pair.toId)],
    );
    return result.rows.map(toObject);
  }

  async stagedBytes(id: string): Promise<number> {
    if (!isUuid(id)) {
      return 0;
    }
    const result = await this.query(
      `SELECT COALESCE(sum(bytes), 0)::float8 AS bytes FROM changeset_value WHERE changeset_id = $1`,
      [id],
    );
    return result.rows[0]!.bytes as number;
  }

  /** Two round trips for a staged call, which a batch makes once per
   * item: the row taken and bumped in one statement, the objects and
   * values written in another. The object count is the one before the
   * change, net of the objects it removes and adds. */
  async apply(id: string, expectedVersion: number, change: ChangesetChange): Promise<ChangesetRecord | null> {
    if (!isUuid(id)) {
      return null;
    }
    return this.tx(async (querier) => {
      let bumped: DbResult;
      try {
        // Under the row lock the state and the version cannot change.
        bumped = await querier.query(
          `WITH held AS (SELECT changeset_id FROM changeset WHERE changeset_id = $1 FOR UPDATE NOWAIT)
           UPDATE changeset c SET ${BUMP} FROM held
            WHERE c.changeset_id = held.changeset_id AND c.version = $2 AND c.submitted_at IS NULL
            RETURNING ${COLS}`,
          [id, expectedVersion],
        );
      } catch (exc) {
        throw exc instanceof ConflictError ? new ConflictError(busy(id)) : exc;
      }
      const row = bumped.rows[0];
      if (row === undefined) {
        return null;
      }
      let count = row.object_count as number;
      const removeObjects = change.removeObjects ?? [];
      if (removeObjects.length > 0) {
        const removed = await querier.query(
          `DELETE FROM changeset_object WHERE changeset_id = $1 AND object_id = ANY($2::uuid[])`,
          [id, removeObjects],
        );
        count -= removed.rowCount;
      }
      const removeValues = change.removeValues ?? [];
      if (removeValues.length > 0) {
        await querier.query(
          `DELETE FROM changeset_value v USING unnest($2::uuid[], $3::text[]) AS r(object_id, property_key)
            WHERE v.changeset_id = $1 AND v.object_id = r.object_id AND v.property_key = r.property_key`,
          [id, removeValues.map((value) => value.objectId), removeValues.map((value) => value.propertyKey)],
        );
      }
      const objects = change.objects ?? [];
      const values = change.values ?? [];
      if (objects.length > 0 || values.length > 0) {
        // The values' objects are written first, in the same statement:
        // its foreign key is checked at its end. Objects are touched in
        // list order.
        const written = await querier.query(
          `WITH objects AS (
             INSERT INTO changeset_object
                    (changeset_id, object_id, kind, type_key, action, from_id, to_id, first_touched_at)
             SELECT $1, o.object_id, o.kind, o.type_key, o.action, o.from_id, o.to_id, clock_timestamp()
               FROM unnest($2::uuid[], $3::text[], $4::text[], $5::text[], $6::uuid[], $7::uuid[])
                    WITH ORDINALITY AS o(object_id, kind, type_key, action, from_id, to_id, n)
              ORDER BY o.n
             ON CONFLICT (changeset_id, object_id) DO UPDATE SET action = EXCLUDED.action
             RETURNING (xmax = 0) AS added),
           staged AS (
             INSERT INTO changeset_value (changeset_id, object_id, property_key, value, before, bytes)
             SELECT $1, v.object_id, v.property_key, v.value, v.before, v.bytes
               FROM unnest($8::uuid[], $9::text[], $10::jsonb[], $11::jsonb[], $12::integer[])
                    AS v(object_id, property_key, value, before, bytes)
             ON CONFLICT (changeset_id, object_id, property_key)
             DO UPDATE SET value = EXCLUDED.value, before = EXCLUDED.before, bytes = EXCLUDED.bytes)
           SELECT count(*) FILTER (WHERE added)::int AS added FROM objects`,
          [
            id,
            objects.map((object) => object.objectId),
            objects.map((object) => object.kind),
            objects.map((object) => object.typeKey),
            objects.map((object) => object.action),
            objects.map((object) => object.fromId),
            objects.map((object) => object.toId),
            values.map((value) => value.objectId),
            values.map((value) => value.propertyKey),
            values.map((value) => JSON.stringify(value.value)),
            values.map((value) => (value.before === null ? null : JSON.stringify(value.before))),
            values.map((value) => value.bytes),
          ],
        );
        count += written.rows[0]!.added as number;
      }
      return toChangeset({ ...row, object_count: count });
    });
  }

  async submit(id: string, expectedVersion: number, note: string | null): Promise<ChangesetRecord | null> {
    const row = await this.mutate(id, async (querier) => {
      const result = await querier.query(
        `UPDATE changeset c SET submitted_at = now(), note = $3, ${BUMP}
          WHERE c.changeset_id = $1 AND c.version = $2 AND c.submitted_at IS NULL
          RETURNING ${COLS}`,
        [id, expectedVersion, note],
      );
      return result.rows[0] ?? null;
    });
    return row === null ? null : toChangeset(row);
  }

  async unsubmit(id: string, note: string): Promise<ChangesetRecord | null> {
    const row = await this.mutate(id, async (querier) => {
      const result = await querier.query(
        `UPDATE changeset c SET submitted_at = NULL, note = $2, ${BUMP}
          WHERE c.changeset_id = $1 AND c.submitted_at IS NOT NULL
          RETURNING ${COLS}`,
        [id, note],
      );
      return result.rows[0] ?? null;
    });
    return row === null ? null : toChangeset(row);
  }

  async discard(id: string): Promise<boolean> {
    const deleted = await this.mutate(id, async (querier) => {
      const result = await querier.query(
        `DELETE FROM changeset WHERE changeset_id = $1 AND submitted_at IS NULL`,
        [id],
      );
      return result.rowCount > 0;
    });
    return deleted === true;
  }

  async touch(id: string): Promise<void> {
    if (!isUuid(id)) {
      return;
    }
    await this.query(
      `UPDATE changeset SET last_change_at = now()
        WHERE changeset_id IN (SELECT changeset_id FROM changeset WHERE changeset_id = $1
                                FOR UPDATE SKIP LOCKED)`,
      [id],
    );
  }

  async sweep(idleMs: number): Promise<number> {
    // The cutoff by now(), the clock that wrote last_change_at.
    const result = await this.query(
      `DELETE FROM changeset
        WHERE changeset_id IN (SELECT changeset_id FROM changeset
                                WHERE submitted_at IS NULL
                                  AND last_change_at < now() - $1::bigint * interval '1 millisecond'
                                FOR UPDATE SKIP LOCKED)`,
      [idleMs],
    );
    return result.rowCount;
  }

  async lockForCommit(id: string): Promise<ChangesetRecord | null> {
    if (this.bound === undefined) {
      throw new Error("lockForCommit runs inside a bound store only");
    }
    if (!isUuid(id)) {
      return null;
    }
    await this.bound.query(`SET LOCAL lock_timeout = '${COMMIT_LOCK_TIMEOUT}'`);
    const lock = await this.bound.query(
      `SELECT pg_try_advisory_xact_lock(hashtextextended('ontoforge.commit.' || current_schema(), 0)) AS taken`,
    );
    if (lock.rows[0]!.taken !== true) {
      throw new ConflictError(COMMIT_RUNNING);
    }
    if (!(await lockRow(this.bound, id, COMMIT_RUNNING))) {
      return null;
    }
    const result = await this.bound.query(`SELECT ${COLS} FROM changeset c WHERE c.changeset_id = $1`, [id]);
    return toChangeset(result.rows[0]!);
  }

  async deleteCommitted(id: string): Promise<void> {
    if (!isUuid(id)) {
      return;
    }
    await this.query(`DELETE FROM changeset WHERE changeset_id = $1`, [id]);
  }
}
