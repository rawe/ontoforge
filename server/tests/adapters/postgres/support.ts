/**
 * The unit double for the PostgreSQL adapter: a fake pool that mirrors
 * precisely the surface the two doors consume — `pool.query`,
 * `pool.connect` (returning a client with `query`/`release`), and
 * `pool.end` — plus the recorded-statement log the tests assert against.
 *
 * Behaviour is injected per test through `fakeDb.onQuery`; the default
 * answers every statement with an empty result. Test files activate the
 * double with:
 *
 *   vi.mock("pg", async (importOriginal) => {
 *     const { fakePgModule } = await import("./support.js");
 *     return fakePgModule(await importOriginal());
 *   });
 *
 * `DatabaseError` (and everything else on the module) stays real, so the
 * door module's `instanceof` checks and the tests' fabricated server
 * errors share one class.
 */

export interface RecordedQuery {
  sql: string;
  params: unknown[] | undefined;
}

export interface FakeResult {
  rows: unknown[];
  rowCount: number;
}

export const fakeDb: {
  onQuery: ((sql: string, params?: unknown[]) => Promise<FakeResult>) | undefined;
  queries: RecordedQuery[];
  reset: () => void;
} = {
  onQuery: undefined,
  queries: [],
  reset() {
    this.onQuery = undefined;
    this.queries = [];
  },
};

async function record(sql: string, params?: unknown[]): Promise<FakeResult> {
  fakeDb.queries.push({ sql, params });
  if (fakeDb.onQuery) {
    return fakeDb.onQuery(sql, params);
  }
  return { rows: [], rowCount: 0 };
}

/** The `pg` module with `Pool` replaced by the fake; everything else real. */
export function fakePgModule(actual: typeof import("pg")): Record<string, unknown> {
  class FakePool {
    async query(sql: string, params?: unknown[]): Promise<FakeResult> {
      return record(sql, params);
    }

    async connect(): Promise<{
      query: (sql: string, params?: unknown[]) => Promise<FakeResult>;
      release: () => void;
    }> {
      return { query: record, release: () => undefined };
    }

    async end(): Promise<void> {
      return undefined;
    }
  }
  return {
    default: { ...(actual.default as unknown as Record<string, unknown>), Pool: FakePool },
    DatabaseError: actual.DatabaseError,
  };
}
