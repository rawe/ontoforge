/**
 * The PostgreSQL access store: the access database, a database of its own
 * beside the ontology database, with its own pool and its own schema
 * version (`access_storage_version`). `openAccessStore` creates the
 * database when it is missing — in the same PostgreSQL, with the same
 * credentials — and brings its schema up to date under an advisory lock,
 * so several servers starting together create and upgrade it once.
 *
 * Every change runs in one transaction with its audit row. Driver errors
 * never leave this module: an unanticipated one becomes a `StoreError`.
 */

import { randomUUID } from "node:crypto";

import pg from "pg";

import type {
  AccessStore,
  Assignment,
  NewAssignment,
  Principal,
  PrincipalPage,
  PrincipalStatus,
  Profile,
  Role,
} from "../../access/store.js";
import { ConflictError, OntoForgeError } from "../../core/exceptions.js";
import { toStoreError } from "./errors.js";

/** The layout this code creates. */
export const ACCESS_STORAGE_VERSION = 1;

/** Any number; the boot of every server takes it before creating or upgrading. */
const SCHEMA_LOCK = 4_711_001;

const SCHEMA = `
CREATE TABLE IF NOT EXISTS access_storage_version (
  id boolean PRIMARY KEY DEFAULT true CHECK (id),
  version integer NOT NULL
);
CREATE TABLE IF NOT EXISTS principal (
  id uuid PRIMARY KEY,
  kind text NOT NULL CHECK (kind IN ('user', 'service')),
  display_name text NOT NULL,
  email text,
  username text,
  status text NOT NULL CHECK (status IN ('active', 'disabled')),
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  last_login_at timestamptz
);
CREATE TABLE IF NOT EXISTS identity (
  issuer text NOT NULL,
  subject text NOT NULL,
  principal_id uuid NOT NULL REFERENCES principal (id),
  created_at timestamptz NOT NULL DEFAULT now(),
  PRIMARY KEY (issuer, subject)
);
CREATE INDEX IF NOT EXISTS identity_principal ON identity (principal_id);
CREATE TABLE IF NOT EXISTS assignment (
  id uuid PRIMARY KEY,
  principal_id uuid NOT NULL REFERENCES principal (id),
  role text NOT NULL CHECK (role IN ('platform_admin', 'ontology_creator', 'ontology_admin', 'reader', 'writer')),
  ontology_id uuid,
  lens_id uuid,
  created_at timestamptz NOT NULL DEFAULT now(),
  created_by uuid,
  CHECK (
    (role IN ('platform_admin', 'ontology_creator') AND ontology_id IS NULL AND lens_id IS NULL) OR
    (role = 'ontology_admin' AND ontology_id IS NOT NULL AND lens_id IS NULL) OR
    (role IN ('reader', 'writer') AND ontology_id IS NOT NULL AND lens_id IS NOT NULL)
  )
);
CREATE UNIQUE INDEX IF NOT EXISTS assignment_platform ON assignment (principal_id, role)
  WHERE ontology_id IS NULL;
CREATE UNIQUE INDEX IF NOT EXISTS assignment_ontology ON assignment (principal_id, ontology_id)
  WHERE role = 'ontology_admin';
CREATE UNIQUE INDEX IF NOT EXISTS assignment_lens ON assignment (principal_id, lens_id)
  WHERE lens_id IS NOT NULL;
CREATE INDEX IF NOT EXISTS assignment_principal ON assignment (principal_id);
CREATE INDEX IF NOT EXISTS assignment_ontology_id ON assignment (ontology_id);
CREATE TABLE IF NOT EXISTS audit (
  id bigserial PRIMARY KEY,
  at timestamptz NOT NULL DEFAULT now(),
  actor_id uuid,
  action text NOT NULL,
  target_id uuid,
  details jsonb NOT NULL DEFAULT '{}'::jsonb
);
`;

type Row = Record<string, unknown>;

function toPrincipal(row: Row): Principal {
  return {
    id: row.id as string,
    kind: row.kind as Principal["kind"],
    displayName: row.display_name as string,
    email: (row.email as string | null) ?? null,
    username: (row.username as string | null) ?? null,
    status: row.status as PrincipalStatus,
    createdAt: row.created_at as Date,
    updatedAt: row.updated_at as Date,
    lastLoginAt: (row.last_login_at as Date | null) ?? null,
  };
}

function toAssignment(row: Row): Assignment {
  return {
    id: row.id as string,
    principalId: row.principal_id as string,
    role: row.role as Role,
    ontologyId: (row.ontology_id as string | null) ?? null,
    lensId: (row.lens_id as string | null) ?? null,
    createdAt: row.created_at as Date,
    createdBy: (row.created_by as string | null) ?? null,
  };
}

/** The discrete settings of `url`; a user or password in the URL wins over the given ones. */
function connectionConfig(url: string, user: string, password: string, database?: string): pg.ClientConfig {
  const parsed = new URL(url);
  return {
    host: parsed.hostname,
    port: parsed.port === "" ? 5432 : Number(parsed.port),
    database: database ?? decodeURIComponent(parsed.pathname.replace(/^\//, "")),
    user: parsed.username !== "" ? decodeURIComponent(parsed.username) : user,
    password: parsed.password !== "" ? decodeURIComponent(parsed.password) : password,
  };
}

function quoteIdent(name: string): string {
  return `"${name.replace(/"/g, '""')}"`;
}

/** Creates the database of `config` when it does not exist, through the `postgres` database. */
async function ensureDatabase(config: pg.ClientConfig): Promise<void> {
  const maintenance = new pg.Client({ ...config, database: "postgres" });
  await maintenance.connect();
  try {
    const found = await maintenance.query("SELECT 1 FROM pg_database WHERE datname = $1", [config.database]);
    if (found.rowCount === 0) {
      try {
        await maintenance.query(`CREATE DATABASE ${quoteIdent(config.database!)}`);
        console.log(`Access database '${config.database}' created`);
      } catch (error) {
        // Another server created it first: 'already exists', or — when both
        // created it at the same moment — a unique violation in the catalog.
        if (!(error instanceof pg.DatabaseError && (error.code === "42P04" || error.code === "23505"))) throw error;
      }
    }
  } finally {
    await maintenance.end();
  }
}

/** Why `error` happened, in words: its message, else those of the errors it
 * gathers (a refused connection tried on several addresses), else its code. */
function reasonOf(error: unknown): string {
  if (!(error instanceof Error)) return String(error);
  if (error.message !== "") return error.message;
  if (error instanceof AggregateError && error.errors.length > 0) {
    return [...new Set(error.errors.map(reasonOf))].join("; ");
  }
  const code = (error as { code?: unknown }).code;
  return typeof code === "string" ? code : error.name;
}

/** Opens the access database: creates it if missing, brings its schema up to date. */
export async function openAccessStore(url: string, user: string, password: string): Promise<AccessStore> {
  const config = connectionConfig(url, user, password);
  try {
    await ensureDatabase(config);
  } catch (error) {
    throw new Error(
      `Access database '${config.database}' at ${config.host}:${config.port} is not usable: ${reasonOf(error)}`,
      { cause: error },
    );
  }
  const pool = new pg.Pool(config);
  pool.on("error", (error) => console.error(`Access database: ${error.message}`));
  const store = new PostgresAccessStore(pool);
  try {
    await store.migrate();
  } catch (error) {
    await pool.end().catch(() => undefined);
    throw new Error(
      `Access database '${config.database}' could not be prepared: ${reasonOf(error)}`,
      { cause: error },
    );
  }
  return store;
}

const PRINCIPAL_COLUMNS = "id, kind, display_name, email, username, status, created_at, updated_at, last_login_at";
const ASSIGNMENT_COLUMNS = "id, principal_id, role, ontology_id, lens_id, created_at, created_by";

type Client = pg.PoolClient;

class PostgresAccessStore implements AccessStore {
  constructor(private readonly pool: pg.Pool) {}

  async migrate(): Promise<void> {
    const client = await this.pool.connect();
    try {
      await client.query("BEGIN");
      await client.query("SELECT pg_advisory_xact_lock($1)", [SCHEMA_LOCK]);
      await client.query(SCHEMA);
      const current = await client.query("SELECT version FROM access_storage_version");
      if (current.rowCount === 0) {
        await client.query("INSERT INTO access_storage_version (version) VALUES ($1)", [ACCESS_STORAGE_VERSION]);
      } else if ((current.rows[0].version as number) > ACCESS_STORAGE_VERSION) {
        throw new Error(
          `access storage version ${current.rows[0].version} is newer than this server's ${ACCESS_STORAGE_VERSION}`,
        );
      }
      await client.query("COMMIT");
    } catch (error) {
      await client.query("ROLLBACK").catch(() => undefined);
      throw error;
    } finally {
      client.release();
    }
  }

  /** One statement; driver errors become a StoreError. */
  private async query(sql: string, params: unknown[] = []): Promise<Row[]> {
    try {
      return (await this.pool.query(sql, params)).rows as Row[];
    } catch (error) {
      throw toStoreError(error);
    }
  }

  /** One transaction; domain errors pass, driver errors become a StoreError. */
  private async transaction<T>(work: (client: Client) => Promise<T>): Promise<T> {
    let client: Client;
    try {
      client = await this.pool.connect();
    } catch (error) {
      throw toStoreError(error);
    }
    try {
      await client.query("BEGIN");
      const result = await work(client);
      await client.query("COMMIT");
      return result;
    } catch (error) {
      await client.query("ROLLBACK").catch(() => undefined);
      if (error instanceof OntoForgeError) throw error;
      throw toStoreError(error);
    } finally {
      client.release();
    }
  }

  private async audit(client: Client, actorId: string | null, action: string, targetId: string | null, details: object): Promise<void> {
    await client.query("INSERT INTO audit (actor_id, action, target_id, details) VALUES ($1, $2, $3, $4)", [
      actorId,
      action,
      targetId,
      JSON.stringify(details),
    ]);
  }

  async signIn(issuer: string, subject: string, profile: Profile, bootstrapAdmin: boolean): Promise<Principal> {
    return this.transaction(async (client) => {
      // Concurrent first sign-ins of one identity queue here; the second finds the first's row.
      await client.query("SELECT pg_advisory_xact_lock(hashtextextended($1, 0))", [`${issuer}\n${subject}`]);
      const bound = await client.query("SELECT principal_id FROM identity WHERE issuer = $1 AND subject = $2", [
        issuer,
        subject,
      ]);
      if (bound.rowCount !== 0) {
        const id = bound.rows[0].principal_id as string;
        if (bootstrapAdmin) await this.ensureBootstrapAdmin(client, id);
        const updated = await client.query(
          `UPDATE principal SET display_name = $2, email = $3, username = $4, last_login_at = now(), updated_at = now()
           WHERE id = $1 RETURNING ${PRINCIPAL_COLUMNS}`,
          [id, profile.displayName, profile.email, profile.username],
        );
        return toPrincipal(updated.rows[0] as Row);
      }
      const id = randomUUID();
      const created = await client.query(
        `INSERT INTO principal (id, kind, display_name, email, username, status, last_login_at)
         VALUES ($1, 'user', $2, $3, $4, 'active', now()) RETURNING ${PRINCIPAL_COLUMNS}`,
        [id, profile.displayName, profile.email, profile.username],
      );
      await client.query("INSERT INTO identity (issuer, subject, principal_id) VALUES ($1, $2, $3)", [issuer, subject, id]);
      await this.audit(client, null, "principal.created", id, { issuer, kind: "user" });
      if (bootstrapAdmin) await this.ensureBootstrapAdmin(client, id);
      return toPrincipal(created.rows[0] as Row);
    });
  }

  /** The configured administrator: active and Platform Administrator, whatever happened before. */
  private async ensureBootstrapAdmin(client: Client, id: string): Promise<void> {
    const enabled = await client.query(
      "UPDATE principal SET status = 'active', updated_at = now() WHERE id = $1 AND status <> 'active'",
      [id],
    );
    if (enabled.rowCount) await this.audit(client, null, "principal.enabled", id, { reason: "bootstrap administrator" });
    const assignmentId = randomUUID();
    const granted = await client.query(
      `INSERT INTO assignment (id, principal_id, role) VALUES ($1, $2, 'platform_admin')
       ON CONFLICT (principal_id, role) WHERE ontology_id IS NULL DO NOTHING`,
      [assignmentId, id],
    );
    if (granted.rowCount) {
      await this.audit(client, null, "assignment.created", id, {
        assignmentId,
        role: "platform_admin",
        reason: "bootstrap administrator",
      });
    }
  }

  async principalOf(issuer: string, subject: string): Promise<Principal | null> {
    const rows = await this.query(
      `SELECT ${PRINCIPAL_COLUMNS.split(", ").map((c) => `p.${c}`).join(", ")}
       FROM identity i JOIN principal p ON p.id = i.principal_id WHERE i.issuer = $1 AND i.subject = $2`,
      [issuer, subject],
    );
    return rows[0] ? toPrincipal(rows[0]) : null;
  }

  async principal(id: string): Promise<Principal | null> {
    const rows = await this.query(`SELECT ${PRINCIPAL_COLUMNS} FROM principal WHERE id = $1`, [id]);
    return rows[0] ? toPrincipal(rows[0]) : null;
  }

  async assignmentsOf(principalId: string): Promise<Assignment[]> {
    const rows = await this.query(
      `SELECT ${ASSIGNMENT_COLUMNS} FROM assignment WHERE principal_id = $1 ORDER BY created_at, id`,
      [principalId],
    );
    return rows.map(toAssignment);
  }

  async assignment(id: string): Promise<Assignment | null> {
    const rows = await this.query(`SELECT ${ASSIGNMENT_COLUMNS} FROM assignment WHERE id = $1`, [id]);
    return rows[0] ? toAssignment(rows[0]) : null;
  }

  async assignmentsInOntology(ontologyId: string): Promise<Assignment[]> {
    const rows = await this.query(
      `SELECT ${ASSIGNMENT_COLUMNS} FROM assignment WHERE ontology_id = $1 ORDER BY created_at, id`,
      [ontologyId],
    );
    return rows.map(toAssignment);
  }

  async listPrincipals(query: { search?: string; limit: number; offset: number }): Promise<PrincipalPage> {
    const search = query.search?.trim() ?? "";
    const pattern = `%${search.replace(/[\\%_]/g, (c) => `\\${c}`)}%`;
    const where = search === "" ? "" : "WHERE display_name ILIKE $1 OR email ILIKE $1 OR username ILIKE $1";
    const params = search === "" ? [] : [pattern];
    const total = await this.query(`SELECT count(*)::int AS n FROM principal ${where}`, params);
    const rows = await this.query(
      `SELECT ${PRINCIPAL_COLUMNS} FROM principal ${where}
       ORDER BY lower(display_name), id LIMIT $${params.length + 1} OFFSET $${params.length + 2}`,
      [...params, query.limit, query.offset],
    );
    return { items: rows.map(toPrincipal), total: total[0]!.n as number };
  }

  async admitService(issuer: string, subject: string, displayName: string, actorId: string): Promise<Principal> {
    return this.transaction(async (client) => {
      await client.query("SELECT pg_advisory_xact_lock(hashtextextended($1, 0))", [`${issuer}\n${subject}`]);
      const bound = await client.query("SELECT principal_id FROM identity WHERE issuer = $1 AND subject = $2", [
        issuer,
        subject,
      ]);
      if (bound.rowCount !== 0) {
        throw new ConflictError("This identity is already bound to a principal", {
          principalId: bound.rows[0].principal_id,
        });
      }
      const id = randomUUID();
      const created = await client.query(
        `INSERT INTO principal (id, kind, display_name, status) VALUES ($1, 'service', $2, 'active')
         RETURNING ${PRINCIPAL_COLUMNS}`,
        [id, displayName],
      );
      await client.query("INSERT INTO identity (issuer, subject, principal_id) VALUES ($1, $2, $3)", [issuer, subject, id]);
      await this.audit(client, actorId, "principal.created", id, { issuer, kind: "service" });
      return toPrincipal(created.rows[0] as Row);
    });
  }

  /** Locks the active Platform Administrators' assignments and counts them. */
  private async activePlatformAdmins(client: Client): Promise<string[]> {
    const rows = await client.query(
      `SELECT a.principal_id FROM assignment a JOIN principal p ON p.id = a.principal_id
       WHERE a.role = 'platform_admin' AND p.status = 'active' FOR UPDATE OF a, p`,
    );
    return rows.rows.map((r) => r.principal_id as string);
  }

  async setStatus(id: string, status: PrincipalStatus, actorId: string): Promise<Principal | null> {
    return this.transaction(async (client) => {
      if (status === "disabled") {
        const admins = await this.activePlatformAdmins(client);
        if (admins.length === 1 && admins[0] === id) {
          throw new ConflictError("The last active Platform Administrator cannot be disabled");
        }
      }
      const updated = await client.query(
        `UPDATE principal SET status = $2, updated_at = now() WHERE id = $1 RETURNING ${PRINCIPAL_COLUMNS}`,
        [id, status],
      );
      if (updated.rowCount === 0) return null;
      await this.audit(client, actorId, status === "disabled" ? "principal.disabled" : "principal.enabled", id, {});
      return toPrincipal(updated.rows[0] as Row);
    });
  }

  async assign(assignment: NewAssignment, actorId: string): Promise<Assignment> {
    return this.transaction(async (client) => {
      const { principalId, role, ontologyId, lensId } = assignment;
      // One assignment per principal and scope at a time: concurrent assigns queue here.
      await client.query("SELECT 1 FROM principal WHERE id = $1 FOR UPDATE", [principalId]);
      let existing;
      if (lensId !== null) {
        existing = await client.query(`SELECT ${ASSIGNMENT_COLUMNS} FROM assignment WHERE principal_id = $1 AND lens_id = $2`, [
          principalId,
          lensId,
        ]);
      } else if (ontologyId !== null) {
        existing = await client.query(
          `SELECT ${ASSIGNMENT_COLUMNS} FROM assignment WHERE principal_id = $1 AND ontology_id = $2 AND role = 'ontology_admin'`,
          [principalId, ontologyId],
        );
      } else {
        existing = await client.query(
          `SELECT ${ASSIGNMENT_COLUMNS} FROM assignment WHERE principal_id = $1 AND role = $2 AND ontology_id IS NULL`,
          [principalId, role],
        );
      }
      const current = existing.rows[0] ? toAssignment(existing.rows[0] as Row) : null;
      if (current && current.role === role) return current;
      if (current) {
        // The other lens role on the same lens: replaced.
        await client.query("DELETE FROM assignment WHERE id = $1", [current.id]);
        await this.audit(client, actorId, "assignment.removed", principalId, {
          assignmentId: current.id,
          role: current.role,
          ontologyId: current.ontologyId,
          lensId: current.lensId,
          reason: "replaced",
        });
      }
      const id = randomUUID();
      const created = await client.query(
        `INSERT INTO assignment (id, principal_id, role, ontology_id, lens_id, created_by)
         VALUES ($1, $2, $3, $4, $5, $6) RETURNING ${ASSIGNMENT_COLUMNS}`,
        [id, principalId, role, ontologyId, lensId, actorId],
      );
      await this.audit(client, actorId, "assignment.created", principalId, { assignmentId: id, role, ontologyId, lensId });
      return toAssignment(created.rows[0] as Row);
    });
  }

  async revoke(id: string, actorId: string): Promise<Assignment | null> {
    return this.transaction(async (client) => {
      const found = await client.query(`SELECT ${ASSIGNMENT_COLUMNS} FROM assignment WHERE id = $1`, [id]);
      if (found.rowCount === 0) return null;
      const assignment = toAssignment(found.rows[0] as Row);
      if (assignment.role === "platform_admin") {
        const admins = await this.activePlatformAdmins(client);
        if (admins.length === 1 && admins[0] === assignment.principalId) {
          throw new ConflictError("The last active Platform Administrator's role cannot be removed");
        }
      }
      await client.query("DELETE FROM assignment WHERE id = $1", [id]);
      await this.audit(client, actorId, "assignment.removed", assignment.principalId, {
        assignmentId: id,
        role: assignment.role,
        ontologyId: assignment.ontologyId,
        lensId: assignment.lensId,
      });
      return assignment;
    });
  }

  async forgetOntology(ontologyId: string): Promise<number> {
    return this.transaction(async (client) => {
      const removed = await client.query("DELETE FROM assignment WHERE ontology_id = $1", [ontologyId]);
      if (removed.rowCount) await this.audit(client, null, "assignment.swept", null, { ontologyId, count: removed.rowCount });
      return removed.rowCount ?? 0;
    });
  }

  async forgetLens(lensId: string): Promise<number> {
    return this.transaction(async (client) => {
      const removed = await client.query("DELETE FROM assignment WHERE lens_id = $1", [lensId]);
      if (removed.rowCount) await this.audit(client, null, "assignment.swept", null, { lensId, count: removed.rowCount });
      return removed.rowCount ?? 0;
    });
  }

  async close(): Promise<void> {
    await this.pool.end();
  }
}
