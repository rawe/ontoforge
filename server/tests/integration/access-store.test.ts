/**
 * The PostgreSQL access store against a real database of its own,
 * `ontoforge_access_test`, beside the suite's test database: dropped and
 * created by this file, never any other database.
 */

import { randomUUID } from "node:crypto";

import pg from "pg";
import { afterAll, beforeAll, beforeEach, describe, expect, it } from "vitest";

import type { AccessStore } from "../../src/access/store.js";
import { openAccessStore } from "../../src/adapters/postgres/accessStore.js";
import { settings } from "../../src/config.js";
import { ConflictError } from "../../src/core/exceptions.js";

const DATABASE = "ontoforge_access_test";

function accessUrl(): string {
  const url = new URL(settings.DB_URI);
  url.pathname = `/${DATABASE}`;
  return url.toString();
}

async function connect<T>(database: string, work: (client: pg.Client) => Promise<T>): Promise<T> {
  const url = new URL(settings.DB_URI);
  const client = new pg.Client({
    host: url.hostname,
    port: url.port === "" ? 5432 : Number(url.port),
    database,
    user: settings.DB_USER,
    password: settings.DB_PASSWORD,
  });
  await client.connect();
  try {
    return await work(client);
  } finally {
    await client.end();
  }
}

const maintenance = <T>(work: (client: pg.Client) => Promise<T>) => connect("postgres", work);

const ISSUER = "http://issuer.test/realms/x";
const profile = (name: string) => ({ displayName: name, email: `${name}@x.test`, username: name });

let store: AccessStore;

beforeAll(async () => {
  await maintenance((c) => c.query(`DROP DATABASE IF EXISTS ${DATABASE} WITH (FORCE)`));
  store = await openAccessStore(accessUrl(), settings.DB_USER, settings.DB_PASSWORD);
});

afterAll(async () => {
  await store?.close();
});

beforeEach(async () => {
  await connect(DATABASE, (c) => c.query("TRUNCATE audit, assignment, identity, principal"));
});

async function auditActions(): Promise<string[]> {
  const rows = await connect(DATABASE, (c) => c.query("SELECT action FROM audit ORDER BY id"));
  return rows.rows.map((r) => r.action as string);
}

describe("opening", () => {
  it("creates the missing database and its schema, and opens again unchanged", async () => {
    const exists = await maintenance((c) => c.query("SELECT 1 FROM pg_database WHERE datname = $1", [DATABASE]));
    expect(exists.rowCount).toBe(1);
    const again = await openAccessStore(accessUrl(), settings.DB_USER, settings.DB_PASSWORD);
    await again.close();
  });

  it("opens concurrently from several servers", async () => {
    const stores = await Promise.all([1, 2, 3].map(() => openAccessStore(accessUrl(), settings.DB_USER, settings.DB_PASSWORD)));
    await Promise.all(stores.map((s) => s.close()));
  });
});

describe("sign-in", () => {
  it("creates one principal for concurrent first sign-ins of one identity", async () => {
    const principals = await Promise.all(
      Array.from({ length: 10 }, () => store.signIn(ISSUER, "sub-1", profile("ada"), false)),
    );
    expect(new Set(principals.map((p) => p.id)).size).toBe(1);
    expect((await store.listPrincipals({ limit: 50, offset: 0 })).total).toBe(1);
    expect(await store.assignmentsOf(principals[0]!.id)).toEqual([]);
    expect(principals[0]!.status).toBe("active");
    expect(principals[0]!.kind).toBe("user");
  });

  it("makes only a newly created bootstrap principal Platform Administrator, once", async () => {
    const first = await Promise.all(
      Array.from({ length: 5 }, () => store.signIn(ISSUER, "boss", profile("boss"), true)),
    );
    const roles = await store.assignmentsOf(first[0]!.id);
    expect(roles.map((a) => a.role)).toEqual(["platform_admin"]);
  });

  it("restores the configured administrator at every sign-in", async () => {
    const admin = await store.signIn(ISSUER, "admin", profile("admin"), true);
    const other = await store.signIn(ISSUER, "other", profile("other"), false);
    await store.assign({ principalId: other.id, role: "platform_admin", ontologyId: null, lensId: null }, admin.id);
    const [role] = await store.assignmentsOf(admin.id);
    await store.revoke(role!.id, other.id);
    await store.setStatus(admin.id, "disabled", other.id);
    const again = await store.signIn(ISSUER, "admin", profile("admin"), true);
    expect(again.status).toBe("active");
    expect((await store.assignmentsOf(admin.id)).map((a) => a.role)).toEqual(["platform_admin"]);
    await store.signIn(ISSUER, "admin", profile("admin"), true);
    expect((await store.assignmentsOf(admin.id)).length).toBe(1);
  });

  it("refreshes the profile but never status or roles", async () => {
    const created = await store.signIn(ISSUER, "sub-2", profile("old"), false);
    const admin = await store.signIn(ISSUER, "admin", profile("admin"), true);
    await store.setStatus(created.id, "disabled", admin.id);
    const again = await store.signIn(ISSUER, "sub-2", { displayName: "New Name", email: "new@x.test", username: "new" }, false);
    expect(again.id).toBe(created.id);
    expect(again.displayName).toBe("New Name");
    expect(again.email).toBe("new@x.test");
    expect(again.status).toBe("disabled");
    expect(await store.assignmentsOf(created.id)).toEqual([]);
  });

  it("never links by email: another subject with the same email is another principal", async () => {
    const a = await store.signIn(ISSUER, "a", profile("same"), false);
    const b = await store.signIn(ISSUER, "b", profile("same"), false);
    const c = await store.signIn("http://other.issuer", "a", profile("same"), false);
    expect(new Set([a.id, b.id, c.id]).size).toBe(3);
  });

  it("finds a principal by its identity only", async () => {
    const created = await store.signIn(ISSUER, "sub-3", profile("x"), false);
    expect((await store.principalOf(ISSUER, "sub-3"))?.id).toBe(created.id);
    expect(await store.principalOf(ISSUER, "unknown")).toBeNull();
    expect(await store.principalOf("http://other", "sub-3")).toBeNull();
  });
});

describe("assignments", () => {
  it("assigns idempotently and lets Reader and Writer on one lens replace each other", async () => {
    const admin = await store.signIn(ISSUER, "admin", profile("admin"), true);
    const user = await store.signIn(ISSUER, "u", profile("u"), false);
    const ontologyId = randomUUID();
    const lensId = randomUUID();
    const reader = await store.assign({ principalId: user.id, role: "reader", ontologyId, lensId }, admin.id);
    const again = await store.assign({ principalId: user.id, role: "reader", ontologyId, lensId }, admin.id);
    expect(again.id).toBe(reader.id);
    const writer = await store.assign({ principalId: user.id, role: "writer", ontologyId, lensId }, admin.id);
    const roles = await store.assignmentsOf(user.id);
    expect(roles.map((a) => [a.role, a.id])).toEqual([["writer", writer.id]]);
    const otherLens = randomUUID();
    await store.assign({ principalId: user.id, role: "reader", ontologyId, lensId: otherLens }, admin.id);
    await store.assign({ principalId: user.id, role: "ontology_admin", ontologyId, lensId: null }, admin.id);
    await store.assign({ principalId: user.id, role: "ontology_creator", ontologyId: null, lensId: null }, admin.id);
    expect((await store.assignmentsOf(user.id)).map((a) => a.role).sort()).toEqual([
      "ontology_admin",
      "ontology_creator",
      "reader",
      "writer",
    ]);
    expect((await store.assignmentsInOntology(ontologyId)).length).toBe(3);
  });

  it("assigns concurrently without duplicates", async () => {
    const admin = await store.signIn(ISSUER, "admin", profile("admin"), true);
    const user = await store.signIn(ISSUER, "u", profile("u"), false);
    const ontologyId = randomUUID();
    const lensId = randomUUID();
    await Promise.all(
      Array.from({ length: 8 }, (_, i) =>
        store.assign({ principalId: user.id, role: i % 2 ? "reader" : "writer", ontologyId, lensId }, admin.id),
      ),
    );
    expect((await store.assignmentsOf(user.id)).length).toBe(1);
  });

  it("keeps the last active Platform Administrator", async () => {
    const admin = await store.signIn(ISSUER, "admin", profile("admin"), true);
    const [role] = await store.assignmentsOf(admin.id);
    await expect(store.revoke(role!.id, admin.id)).rejects.toBeInstanceOf(ConflictError);
    await expect(store.setStatus(admin.id, "disabled", admin.id)).rejects.toBeInstanceOf(ConflictError);
    const second = await store.signIn(ISSUER, "second", profile("second"), false);
    await store.assign({ principalId: second.id, role: "platform_admin", ontologyId: null, lensId: null }, admin.id);
    expect(await store.revoke(role!.id, admin.id)).not.toBeNull();
    expect(await store.revoke(role!.id, admin.id)).toBeNull();
  });

  it("forgets an ontology's and a lens's assignments", async () => {
    const admin = await store.signIn(ISSUER, "admin", profile("admin"), true);
    const user = await store.signIn(ISSUER, "u", profile("u"), false);
    const [o1, o2, o3] = [randomUUID(), randomUUID(), randomUUID()];
    const [l1, l2, l3] = [randomUUID(), randomUUID(), randomUUID()];
    await store.assign({ principalId: user.id, role: "reader", ontologyId: o1, lensId: l1 }, admin.id);
    await store.assign({ principalId: user.id, role: "reader", ontologyId: o2, lensId: l2 }, admin.id);
    await store.assign({ principalId: user.id, role: "writer", ontologyId: o3, lensId: l3 }, admin.id);
    await store.assign({ principalId: user.id, role: "ontology_admin", ontologyId: o3, lensId: null }, admin.id);
    expect(await store.forgetOntology(o1)).toBe(1);
    expect(await store.forgetLens(l2)).toBe(1);
    expect((await store.assignmentsOf(user.id)).map((a) => a.role).sort()).toEqual(["ontology_admin", "writer"]);
    expect((await store.assignmentsOf(admin.id)).map((a) => a.role)).toEqual(["platform_admin"]);
  });
});

describe("principals", () => {
  it("admits a service principal once", async () => {
    const admin = await store.signIn(ISSUER, "admin", profile("admin"), true);
    const service = await store.admitService(ISSUER, "svc", "Nightly import", admin.id);
    expect(service.kind).toBe("service");
    expect((await store.principalOf(ISSUER, "svc"))?.id).toBe(service.id);
    await expect(store.admitService(ISSUER, "svc", "Again", admin.id)).rejects.toBeInstanceOf(ConflictError);
    await expect(store.admitService(ISSUER, "admin", "Taken", admin.id)).rejects.toBeInstanceOf(ConflictError);
  });

  it("searches by name, email and username, case-insensitively, with literal wildcards", async () => {
    await store.signIn(ISSUER, "1", { displayName: "Ada Lovelace", email: "ada@x.test", username: "ada" }, false);
    await store.signIn(ISSUER, "2", { displayName: "Bob", email: "bob_100%@x.test", username: "bob" }, false);
    expect((await store.listPrincipals({ search: "LOVE", limit: 10, offset: 0 })).items.map((p) => p.username)).toEqual(["ada"]);
    expect((await store.listPrincipals({ search: "100%", limit: 10, offset: 0 })).total).toBe(1);
    expect((await store.listPrincipals({ search: "_", limit: 10, offset: 0 })).total).toBe(1);
    const page = await store.listPrincipals({ limit: 1, offset: 1 });
    expect(page.total).toBe(2);
    expect(page.items.map((p) => p.displayName)).toEqual(["Bob"]);
  });

  it("audits every change", async () => {
    const admin = await store.signIn(ISSUER, "admin", profile("admin"), true);
    const user = await store.signIn(ISSUER, "u", profile("u"), false);
    const a = await store.assign({ principalId: user.id, role: "ontology_creator", ontologyId: null, lensId: null }, admin.id);
    await store.revoke(a.id, admin.id);
    await store.setStatus(user.id, "disabled", admin.id);
    await store.setStatus(user.id, "active", admin.id);
    expect(await auditActions()).toEqual([
      "principal.created",
      "assignment.created",
      "principal.created",
      "assignment.created",
      "assignment.removed",
      "principal.disabled",
      "principal.enabled",
    ]);
  });
});
