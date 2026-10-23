/**
 * User management's scope rules (`access/service.ts`) over an in-memory
 * access store and a mocked registry: what a Platform Administrator and
 * an Ontology Administrator may see, grant and revoke.
 */

import { randomUUID } from "node:crypto";

import { beforeEach, describe, expect, it, vi } from "vitest";

import type { Caller } from "../../src/access/caller.js";
import type { AccessStore, Assignment, NewAssignment, Principal, Role } from "../../src/access/store.js";
import { ConflictError, ForbiddenError, NotFoundError, ValidationError } from "../../src/core/exceptions.js";

const O_FAIR = randomUUID();
const O_OTHER = randomUUID();
const L_VISITOR = randomUUID();
const L_STAFF = randomUUID();
const L_X = randomUUID();

const ONTOLOGIES = [
  { ontologyId: O_FAIR, key: "fair" },
  { ontologyId: O_OTHER, key: "other" },
];
const LENSES: Record<string, { lensId: string; key: string }[]> = {
  fair: [
    { lensId: L_VISITOR, key: "visitor" },
    { lensId: L_STAFF, key: "staff" },
  ],
  other: [{ lensId: L_X, key: "x" }],
};

vi.mock("../../src/core/ports.js", () => ({
  getOntologyRegistry: () => ({
    getOntology: async (key: string) => ONTOLOGIES.find((o) => o.key === key) ?? null,
    listOntologies: async () => ONTOLOGIES,
  }),
  getModelingStore: async (key: string) => ({
    getLensByKey: async (lensKey: string) => LENSES[key]!.find((l) => l.key === lensKey) ?? null,
    listLenses: async () => LENSES[key]!,
  }),
}));

const service = await import("../../src/access/service.js");

/** Just enough of the access store, in memory. */
class MemoryAccess {
  principals = new Map<string, Principal>();
  assignments: Assignment[] = [];

  add(name: string): Principal {
    const p: Principal = {
      id: randomUUID(),
      kind: "user",
      displayName: name,
      email: null,
      username: name,
      status: "active",
      createdAt: new Date(),
      updatedAt: new Date(),
      lastLoginAt: null,
    };
    this.principals.set(p.id, p);
    return p;
  }

  async principal(id: string) {
    return this.principals.get(id) ?? null;
  }
  async assignmentsOf(id: string) {
    return this.assignments.filter((a) => a.principalId === id);
  }
  async assignment(id: string) {
    return this.assignments.find((a) => a.id === id) ?? null;
  }
  async assignmentsInOntology(ontologyId: string) {
    return this.assignments.filter((a) => a.ontologyId === ontologyId);
  }
  async listPrincipals() {
    return { items: [...this.principals.values()], total: this.principals.size };
  }
  async setStatus(id: string, status: Principal["status"]) {
    const p = this.principals.get(id);
    if (!p) return null;
    p.status = status;
    return p;
  }
  async assign(a: NewAssignment, actorId: string): Promise<Assignment> {
    const same = this.assignments.find((x) => x.principalId === a.principalId && x.role === a.role && x.lensId === a.lensId && x.ontologyId === a.ontologyId);
    if (same) return same;
    this.assignments = this.assignments.filter((x) => !(a.lensId !== null && x.principalId === a.principalId && x.lensId === a.lensId));
    const created = { ...a, id: randomUUID(), createdAt: new Date(), createdBy: actorId };
    this.assignments.push(created);
    return created;
  }
  async revoke(id: string) {
    const found = this.assignments.find((a) => a.id === id) ?? null;
    this.assignments = this.assignments.filter((a) => a.id !== id);
    return found;
  }
}

let memory: MemoryAccess;
let store: AccessStore;

function grantDirect(p: Principal, role: Role, ontologyId: string | null = null, lensId: string | null = null): void {
  memory.assignments.push({ id: randomUUID(), principalId: p.id, role, ontologyId, lensId, createdAt: new Date(), createdBy: null });
}

function callerOf(p: Principal): Caller {
  return { principal: p, assignments: memory.assignments.filter((a) => a.principalId === p.id), via: "session" };
}

let platform: Principal;
let fairAdmin: Principal;
let alice: Principal;

beforeEach(() => {
  memory = new MemoryAccess();
  store = memory as unknown as AccessStore;
  platform = memory.add("platform");
  fairAdmin = memory.add("fair-admin");
  alice = memory.add("alice");
  grantDirect(platform, "platform_admin");
  grantDirect(fairAdmin, "ontology_admin", O_FAIR);
  grantDirect(alice, "reader", O_FAIR, L_VISITOR);
  grantDirect(alice, "writer", O_OTHER, L_X);
});

describe("seeing a user", () => {
  it("a Platform Administrator sees every assignment, with keys", async () => {
    const user = await service.getUser(store, callerOf(platform), alice.id);
    expect(user.assignments.map((a) => [a.role, a.ontologyKey, a.lensKey])).toEqual([
      ["reader", "fair", "visitor"],
      ["writer", "other", "x"],
    ]);
  });

  it("an Ontology Administrator sees only those within its ontologies", async () => {
    const user = await service.getUser(store, callerOf(fairAdmin), alice.id);
    expect(user.assignments.map((a) => a.lensKey)).toEqual(["visitor"]);
  });

  it("an assignment whose lens is gone is left out", async () => {
    grantDirect(alice, "reader", O_FAIR, randomUUID());
    const user = await service.getUser(store, callerOf(platform), alice.id);
    expect(user.assignments).toHaveLength(2);
  });

  it("an unknown or malformed user id is not found", async () => {
    await expect(service.getUser(store, callerOf(platform), randomUUID())).rejects.toThrow(NotFoundError);
    await expect(service.getUser(store, callerOf(platform), "nope")).rejects.toThrow(NotFoundError);
  });
});

describe("granting", () => {
  it("an Ontology Administrator grants Reader and Writer on its lenses; they replace each other", async () => {
    const granted = await service.grant(store, callerOf(fairAdmin), alice.id, { role: "writer", ontologyKey: "fair", lensKey: "visitor" });
    expect(granted).toMatchObject({ role: "writer", ontologyKey: "fair", lensKey: "visitor", ontologyId: O_FAIR, lensId: L_VISITOR });
    expect((await memory.assignmentsOf(alice.id)).filter((a) => a.lensId === L_VISITOR).map((a) => a.role)).toEqual(["writer"]);
  });

  it("an Ontology Administrator cannot grant outside its ontology, nor administrator or platform roles", async () => {
    await expect(service.grant(store, callerOf(fairAdmin), alice.id, { role: "reader", ontologyKey: "other", lensKey: "x" })).rejects.toThrow(NotFoundError);
    await expect(service.grant(store, callerOf(fairAdmin), alice.id, { role: "ontology_admin", ontologyKey: "fair" })).rejects.toThrow(ForbiddenError);
    await expect(service.grant(store, callerOf(fairAdmin), alice.id, { role: "ontology_creator" })).rejects.toThrow(ForbiddenError);
  });

  it("a Reader cannot grant on its own lens's ontology", async () => {
    await expect(service.grant(store, callerOf(alice), alice.id, { role: "writer", ontologyKey: "fair", lensKey: "visitor" })).rejects.toThrow(ForbiddenError);
  });

  it("a Platform Administrator grants every role", async () => {
    const caller = callerOf(platform);
    expect((await service.grant(store, caller, alice.id, { role: "ontology_creator" })).ontologyKey).toBeNull();
    expect((await service.grant(store, caller, alice.id, { role: "ontology_admin", ontologyKey: "other" })).ontologyId).toBe(O_OTHER);
    expect((await service.grant(store, caller, alice.id, { role: "reader", ontologyKey: "fair", lensKey: "staff" })).lensId).toBe(L_STAFF);
  });

  it("keys must fit the role; unknown ontologies and lenses are not found", async () => {
    const caller = callerOf(platform);
    await expect(service.grant(store, caller, alice.id, { role: "platform_admin", ontologyKey: "fair" })).rejects.toThrow(ValidationError);
    await expect(service.grant(store, caller, alice.id, { role: "ontology_admin" })).rejects.toThrow(ValidationError);
    await expect(service.grant(store, caller, alice.id, { role: "reader", ontologyKey: "fair" })).rejects.toThrow(ValidationError);
    await expect(service.grant(store, caller, alice.id, { role: "reader", ontologyKey: "nope", lensKey: "x" })).rejects.toThrow("Ontology 'nope' not found");
    await expect(service.grant(store, caller, alice.id, { role: "reader", ontologyKey: "fair", lensKey: "nope" })).rejects.toThrow("Lens 'nope' not found");
    await expect(service.grant(store, caller, randomUUID(), { role: "ontology_creator" })).rejects.toThrow(NotFoundError);
  });
});

describe("revoking", () => {
  it("an Ontology Administrator revokes lens roles within its ontology; others it does not see", async () => {
    const [inFair, inOther] = await memory.assignmentsOf(alice.id);
    await expect(service.revoke(store, callerOf(fairAdmin), alice.id, inOther!.id)).rejects.toThrow(NotFoundError);
    await service.revoke(store, callerOf(fairAdmin), alice.id, inFair!.id);
    expect((await memory.assignmentsOf(alice.id)).map((a) => a.id)).toEqual([inOther!.id]);
  });

  it("an Ontology Administrator sees but cannot revoke an administrator role in its ontology", async () => {
    const [own] = await memory.assignmentsOf(fairAdmin.id);
    await expect(service.revoke(store, callerOf(fairAdmin), fairAdmin.id, own!.id)).rejects.toThrow(ForbiddenError);
  });

  it("an assignment named under another user is not found", async () => {
    const [inFair] = await memory.assignmentsOf(alice.id);
    await expect(service.revoke(store, callerOf(platform), fairAdmin.id, inFair!.id)).rejects.toThrow(NotFoundError);
  });
});

describe("platform administration", () => {
  it("only Platform Administrators change status or admit services; none disables itself", async () => {
    await expect(service.setUserStatus(store, callerOf(fairAdmin), alice.id, "disabled")).rejects.toThrow(ForbiddenError);
    expect((await service.setUserStatus(store, callerOf(platform), alice.id, "disabled")).status).toBe("disabled");
    await expect(service.setUserStatus(store, callerOf(platform), platform.id, "disabled")).rejects.toThrow(ConflictError);
    await expect(service.admitService(store, callerOf(fairAdmin), "http://issuer", { displayName: "s", subject: "s" })).rejects.toThrow(ForbiddenError);
  });

  it("an ontology's access list: its administrator and Platform Administrators", async () => {
    const list = await service.ontologyAccess(store, callerOf(fairAdmin), "fair");
    expect(list.assignments.map((a) => [a.user.displayName, a.role])).toEqual([
      ["fair-admin", "ontology_admin"],
      ["alice", "reader"],
    ]);
    expect((await service.ontologyAccess(store, callerOf(platform), "fair")).assignments).toHaveLength(2);
    await expect(service.ontologyAccess(store, callerOf(alice), "fair")).rejects.toThrow(ForbiddenError);
    await expect(service.ontologyAccess(store, callerOf(fairAdmin), "other")).rejects.toThrow(NotFoundError);
  });
});
