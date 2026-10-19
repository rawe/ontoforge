/**
 * `ChangesetStore` on PostgreSQL: one `changeset` row per changeset and
 * one `changeset_write` row per staged write, in an ontology's namespace.
 *
 * - Every mutation but `touch` and `sweep` first takes the changeset row
 *   `FOR UPDATE NOWAIT` in its own transaction (or the bound one): a row
 *   held by a commit or another mutation answers a `ConflictError` at
 *   once. `touch` and `sweep` skip a held row instead.
 * - A seq is the changeset's version at the append: every append and
 *   unstage bumps the version, so a seq is never reused, not even after
 *   the last write is unstaged.
 * - The state is judged under the row lock, in the statement that writes:
 *   append, unstage, submit and discard change a draft changeset only,
 *   unsubmit a submitted one. A submit landing between the service's read
 *   and the write is therefore never overwritten.
 * - The journal dies with its changeset (`ON DELETE CASCADE`).
 * - `lockForCommit` runs only inside a bound store. It first bounds the
 *   transaction's lock waits (`lock_timeout`, 5 s). The commit lock is a
 *   transaction-scoped advisory lock keyed by the namespace, so it holds
 *   across server instances and dies with the transaction.
 */

import { ConflictError } from "../../core/exceptions.js";
import type {
  ChangesetRecord,
  ChangesetStore,
  ChangesetSummary,
  ChangesetWriteRecord,
  NewChangesetWrite,
  Row,
} from "../../core/ports.js";
import { runQuery, withTransaction, type DbResult, type Querier } from "./errors.js";
import { isUuid } from "./rows.js";

/** The changeset columns of `c`. */
const BASE_COLS = `c.changeset_id, c.lens_id, c.anchor_key, c.version, c.note, c.submitted_at,
       c.created_at, c.last_change_at`;

/** The changeset columns of `c` and its number of staged writes. */
const COLS = `${BASE_COLS},
       (SELECT count(*)::int FROM changeset_write w WHERE w.changeset_id = c.changeset_id) AS write_count`;

const WRITE_COLS = `seq, operation, arguments, minted_id, type_key, target_id, base, created_at`;

/** The version bump and last change of every mutation. */
const BUMP = `version = c.version + 1, last_change_at = now()`;

/** How long a commit waits for a row another transaction holds (V26);
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
    anchorKey: row.anchor_key as string | null,
    version: row.version as number,
    note: row.note as string | null,
    submittedAt: row.submitted_at as Date | null,
    createdAt: row.created_at as Date,
    lastChangeAt: row.last_change_at as Date,
    writeCount: row.write_count as number,
  };
}

function toWrite(row: Row): ChangesetWriteRecord {
  return {
    seq: row.seq as number,
    operation: row.operation as string,
    arguments: row.arguments as Row,
    mintedId: row.minted_id as string | null,
    typeKey: row.type_key as string,
    targetId: row.target_id as string | null,
    base: row.base as Row | null,
    createdAt: row.created_at as Date,
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
    anchorKey: string | null;
    note: string | null;
  }): Promise<ChangesetRecord> {
    const result = await this.query(
      `INSERT INTO changeset AS c (changeset_id, lens_id, anchor_key, version, note)
       VALUES ($1, $2, $3, 1, $4)
       RETURNING ${COLS}`,
      [changeset.id, changeset.lensId, changeset.anchorKey, changeset.note],
    );
    return toChangeset(result.rows[0]!);
  }

  async get(id: string, lensId: string, anchorKey: string | null): Promise<ChangesetRecord | null> {
    if (!isUuid(id)) {
      return null;
    }
    const params: unknown[] = [id, lensId];
    let anchor = "";
    if (anchorKey !== null) {
      params.push(anchorKey);
      anchor = " AND c.anchor_key = $3";
    }
    const result = await this.query(
      `SELECT ${COLS} FROM changeset c WHERE c.changeset_id = $1 AND c.lens_id = $2${anchor}`,
      params,
    );
    const row = result.rows[0];
    return row === undefined ? null : toChangeset(row);
  }

  /** One statement: a row per changeset, operation and type key. */
  async list(lensId: string, anchorKey: string | null): Promise<ChangesetSummary[]> {
    const params: unknown[] = [lensId];
    let anchor = "";
    if (anchorKey !== null) {
      params.push(anchorKey);
      anchor = " AND c.anchor_key = $2";
    }
    const result = await this.query(
      `SELECT ${BASE_COLS}, w.operation, w.type_key, count(w.seq)::int AS write_count
         FROM changeset c LEFT JOIN changeset_write w ON w.changeset_id = c.changeset_id
        WHERE c.lens_id = $1${anchor}
        GROUP BY c.changeset_id, w.operation, w.type_key
        ORDER BY c.submitted_at IS NULL, c.last_change_at DESC, c.changeset_id, w.operation, w.type_key`,
      params,
    );
    const summaries = new Map<string, ChangesetSummary>();
    for (const row of result.rows) {
      const id = row.changeset_id as string;
      let summary = summaries.get(id);
      if (summary === undefined) {
        summary = { ...toChangeset({ ...row, write_count: 0 }), operations: {}, typeKeys: [] };
        summaries.set(id, summary);
      }
      const count = row.write_count as number;
      if (count === 0) {
        continue;
      }
      const operation = row.operation as string;
      const typeKey = row.type_key as string;
      summary.writeCount += count;
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

  async page(id: string, offset: number, limit: number): Promise<ChangesetWriteRecord[]> {
    if (!isUuid(id)) {
      return [];
    }
    const result = await this.query(
      `SELECT ${WRITE_COLS} FROM changeset_write WHERE changeset_id = $1
        ORDER BY seq LIMIT $2 OFFSET $3`,
      [id, limit, offset],
    );
    return result.rows.map(toWrite);
  }

  async findMinted(id: string, mintedId: string): Promise<ChangesetWriteRecord | null> {
    if (!isUuid(id) || !isUuid(mintedId)) {
      return null;
    }
    const result = await this.query(
      `SELECT ${WRITE_COLS} FROM changeset_write WHERE changeset_id = $1 AND minted_id = $2
        ORDER BY seq LIMIT 1`,
      [id, mintedId],
    );
    const row = result.rows[0];
    return row === undefined ? null : toWrite(row);
  }

  append(id: string, write: NewChangesetWrite): Promise<number | null> {
    return this.mutate(id, async (querier) => {
      const result = await querier.query(
        `INSERT INTO changeset_write
                (changeset_id, seq, operation, arguments, minted_id, type_key, target_id, base)
         SELECT $1,
                GREATEST(c.version,
                         COALESCE((SELECT max(seq) FROM changeset_write WHERE changeset_id = $1), 0) + 1),
                $2::text, $3::jsonb, $4::uuid, $5::text, $6::uuid, $7::jsonb
           FROM changeset c WHERE c.changeset_id = $1 AND c.submitted_at IS NULL
         RETURNING seq`,
        [
          id,
          write.operation,
          JSON.stringify(write.arguments),
          write.mintedId,
          write.typeKey,
          write.targetId,
          write.base === null ? null : JSON.stringify(write.base),
        ],
      );
      const seq = result.rows[0]?.seq as number | undefined;
      if (seq === undefined) {
        return null;
      }
      await querier.query(`UPDATE changeset c SET ${BUMP} WHERE c.changeset_id = $1`, [id]);
      return seq;
    });
  }

  async unstage(id: string, seq: number): Promise<boolean> {
    const removed = await this.mutate(id, async (querier) => {
      const result = await querier.query(
        `DELETE FROM changeset_write w USING changeset c
          WHERE w.changeset_id = $1 AND w.seq = $2
            AND c.changeset_id = w.changeset_id AND c.submitted_at IS NULL`,
        [id, seq],
      );
      if (result.rowCount === 0) {
        return false;
      }
      await querier.query(`UPDATE changeset c SET ${BUMP} WHERE c.changeset_id = $1`, [id]);
      return true;
    });
    return removed === true;
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

  async sweep(olderThan: Date): Promise<number> {
    const result = await this.query(
      `DELETE FROM changeset
        WHERE changeset_id IN (SELECT changeset_id FROM changeset
                                WHERE submitted_at IS NULL AND last_change_at < $1
                                FOR UPDATE SKIP LOCKED)`,
      [olderThan],
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

  async deleteWithJournal(id: string): Promise<void> {
    if (!isUuid(id)) {
      return;
    }
    await this.query(`DELETE FROM changeset WHERE changeset_id = $1`, [id]);
  }
}
