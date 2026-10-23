/**
 * The authorization service (`access/authorize.ts`) over a mocked
 * registry and lens table: each role against each need, not found for
 * what a caller holds no role in, forbidden for what it knows but lacks
 * the role for; the role level of a lens and the list filters.
 */

import { describe, expect, it, vi } from "vitest";

import type { Access, Caller, Need } from "../../src/access/caller.js";
import type { Assignment, Role } from "../../src/access/store.js";
import { ForbiddenError, NotFoundError, UnauthenticatedError } from "../../src/core/exceptions.js";

const O_FAIR = "00000000-0000-4000-8000-00000000000f";
const O_OTHER = "00000000-0000-4000-8000-00000000000e";
const L_VISITOR = "00000000-0000-4000-8000-0000000000a1";
const L_STAFF = "00000000-0000-4000-8000-0000000000a2";

const ONTOLOGIES: Record<string, { ontologyId: string; key: string }> = {
  fair: { ontologyId: O_FAIR, key: "fair" },
  other: { ontologyId: O_OTHER, key: "other" },
};
const LENSES = [
  { lensId: L_VISITOR, key: "visitor" },
  { lensId: L_STAFF, key: "staff" },
];

vi.mock("../../src/core/ports.js", () => ({
  getOntologyRegistry: () => ({ getOntology: async (key: string) => ONTOLOGIES[key] ?? null }),
  getModelingStore: async () => ({
    getLensByKey: async (key: string) => LENSES.find((l) => l.key === key) ?? null,
    getLens: async (id: string) => LENSES.find((l) => l.lensId === id) ?? null,
  }),
}));

const { authorize, lensFilter, lensLevel, ontologyFilter, ownerOf } = await import("../../src/access/authorize.js");

let next = 0;
function caller(...roles: [Role, string?, string?][]): Access {
  const principalId = `p${++next}`;
  const assignments: Assignment[] = roles.map(([role, ontologyId, lensId]) => ({
    id: `a${++next}`,
    principalId,
    role,
    ontologyId: ontologyId ?? null,
    lensId: lensId ?? null,
    createdAt: new Date(),
    createdBy: null,
  }));
  const principal = {
    id: principalId,
    kind: "user" as const,
    displayName: principalId,
    email: null,
    username: null,
    status: "active" as const,
    createdAt: new Date(),
    updatedAt: new Date(),
    lastLoginAt: null,
  };
  const value: Caller = { principal, assignments, via: "session" };
  return { kind: "caller", caller: value };
}

const TRUSTED: Access = { kind: "trusted" };
const ANONYMOUS: Access = { kind: "anonymous" };
const PLATFORM_ADMIN = caller(["platform_admin"]);
const CREATOR = caller(["ontology_creator"]);
const ADMIN = caller(["ontology_admin", O_FAIR]);
const READER = caller(["reader", O_FAIR, L_VISITOR]);
const WRITER = caller(["writer", O_FAIR, L_VISITOR]);
const NOBODY = caller();

const READ: Need = { kind: "lens", operation: "read" };
const WRITE: Need = { kind: "lens", operation: "write" };
const STAGE: Need = { kind: "lens", operation: "stage" };
const DESIGN: Need = { kind: "lens", operation: "read", orAdmin: true };
const FAIR = { ontologyKey: "fair" };
const VISITOR = { ontologyKey: "fair", lensKey: "visitor" };

type Outcome = "ok" | 401 | 403 | 404;

async function outcome(access: Access, need: Need, params: Record<string, string> = {}): Promise<Outcome> {
  try {
    await authorize(access, need, params);
    return "ok";
  } catch (error) {
    if (error instanceof UnauthenticatedError) return 401;
    if (error instanceof ForbiddenError) return 403;
    if (error instanceof NotFoundError) return 404;
    throw error;
  }
}

describe("authorize", () => {
  it("trusted passes everything; the anonymous only public needs", async () => {
    for (const need of [{ kind: "signed-in" }, { kind: "user-admin" }, { kind: "ontology-admin" }, WRITE] as Need[]) {
      expect(await outcome(TRUSTED, need, VISITOR)).toBe("ok");
      expect(await outcome(ANONYMOUS, need, VISITOR)).toBe(401);
    }
    expect(await outcome(ANONYMOUS, { kind: "public" })).toBe("ok");
  });

  it("platform roles, by name, nothing inherited", async () => {
    const create: Need = { kind: "platform", role: "ontology_creator" };
    expect(await outcome(CREATOR, create)).toBe("ok");
    expect(await outcome(PLATFORM_ADMIN, create)).toBe(403);
    expect(await outcome(ADMIN, create)).toBe(403);
    expect(await outcome(NOBODY, { kind: "signed-in" })).toBe("ok");
  });

  it("user management: Platform Administrators and any Ontology Administrator", async () => {
    const need: Need = { kind: "user-admin" };
    expect(await outcome(PLATFORM_ADMIN, need)).toBe("ok");
    expect(await outcome(ADMIN, need)).toBe("ok");
    expect(await outcome(WRITER, need)).toBe(403);
    expect(await outcome(CREATOR, need)).toBe(403);
  });

  it("an ontology: members and Platform Administrators know it, anyone else gets not found", async () => {
    const member: Need = { kind: "ontology-member" };
    for (const access of [PLATFORM_ADMIN, ADMIN, READER, WRITER]) expect(await outcome(access, member, FAIR)).toBe("ok");
    expect(await outcome(NOBODY, member, FAIR)).toBe(404);
    expect(await outcome(CREATOR, member, FAIR)).toBe(404);
    expect(await outcome(ADMIN, member, { ontologyKey: "other" })).toBe(404);
    expect(await outcome(PLATFORM_ADMIN, member, { ontologyKey: "nope" })).toBe(404);
  });

  it("ontology administration: its administrator; forbidden for the rest who know it", async () => {
    const admin: Need = { kind: "ontology-admin" };
    expect(await outcome(ADMIN, admin, FAIR)).toBe("ok");
    expect(await outcome(READER, admin, FAIR)).toBe(403);
    expect(await outcome(PLATFORM_ADMIN, admin, FAIR)).toBe(403);
    expect(await outcome(NOBODY, admin, FAIR)).toBe(404);
    expect(await outcome(ADMIN, admin, { ontologyKey: "other" })).toBe(404);
  });

  it("a runtime lens: Reader reads, Writer does everything, administrators get no data", async () => {
    expect(await outcome(READER, READ, VISITOR)).toBe("ok");
    expect(await outcome(WRITER, READ, VISITOR)).toBe("ok");
    expect(await outcome(WRITER, WRITE, VISITOR)).toBe("ok");
    expect(await outcome(WRITER, STAGE, VISITOR)).toBe("ok");
    expect(await outcome(READER, WRITE, VISITOR)).toBe(403);
    expect(await outcome(READER, STAGE, VISITOR)).toBe(403);
    expect(await outcome(ADMIN, READ, VISITOR)).toBe(403);
    expect(await outcome(PLATFORM_ADMIN, READ, VISITOR)).toBe(403);
    expect(await outcome(NOBODY, READ, VISITOR)).toBe(404);
  });

  it("a lens the caller holds no role on is not found, as an unknown one", async () => {
    expect(await outcome(READER, READ, { ontologyKey: "fair", lensKey: "staff" })).toBe(404);
    expect(await outcome(READER, READ, { ontologyKey: "fair", lensKey: "nope" })).toBe(404);
    expect(await outcome(ADMIN, READ, { ontologyKey: "fair", lensKey: "nope" })).toBe(404);
    expect(await outcome(PLATFORM_ADMIN, DESIGN, { ontologyKey: "fair", lensId: "nope" })).toBe(404);
  });

  it("the refusal says what is missing", async () => {
    await expect(authorize(READER, WRITE, VISITOR)).rejects.toThrow("Reader on lens 'visitor' cannot write");
    await expect(authorize(NOBODY, READ, VISITOR)).rejects.toThrow("Ontology 'fair' not found");
    await expect(authorize(READER, READ, { ontologyKey: "fair", lensKey: "staff" })).rejects.toThrow(
      "Lens 'staff' not found",
    );
  });

  it("a modeling read of a lens: its role holders and the ontology's administrator", async () => {
    expect(await outcome(ADMIN, DESIGN, { ontologyKey: "fair", lensId: L_STAFF })).toBe("ok");
    expect(await outcome(READER, DESIGN, { ontologyKey: "fair", lensId: L_VISITOR })).toBe("ok");
    expect(await outcome(READER, DESIGN, { ontologyKey: "fair", lensId: L_STAFF })).toBe(404);
    expect(await outcome(READER, DESIGN, { ontologyKey: "fair", lensKey: "visitor" })).toBe("ok");
    expect(await outcome(PLATFORM_ADMIN, DESIGN, { ontologyKey: "fair", lensId: L_VISITOR })).toBe(403);
  });

  it("the ruleset reads (no lens in the path): any lens role in the ontology, or its administrator", async () => {
    expect(await outcome(READER, DESIGN, FAIR)).toBe("ok");
    expect(await outcome(ADMIN, DESIGN, FAIR)).toBe("ok");
    expect(await outcome(PLATFORM_ADMIN, DESIGN, FAIR)).toBe(403);
    expect(await outcome(NOBODY, DESIGN, FAIR)).toBe(404);
  });
});

describe("what handlers ask", () => {
  it("lensLevel: Writer full, Reader and administrators none, trusted full", async () => {
    expect(await lensLevel(TRUSTED, "fair", "visitor")).toBe("full");
    expect(await lensLevel(WRITER, "fair", "visitor")).toBe("full");
    expect(await lensLevel(READER, "fair", "visitor")).toBe("none");
    expect(await lensLevel(ADMIN, "fair", "visitor")).toBe("none");
    expect(await lensLevel(WRITER, "fair", "staff")).toBe("none");
  });

  it("ontologyFilter: every ontology for trusted and Platform Administrators, else those with a role", () => {
    expect(ontologyFilter(TRUSTED)(O_OTHER)).toBe(true);
    expect(ontologyFilter(PLATFORM_ADMIN)(O_OTHER)).toBe(true);
    expect(ontologyFilter(READER)(O_FAIR)).toBe(true);
    expect(ontologyFilter(READER)(O_OTHER)).toBe(false);
    expect(ontologyFilter(CREATOR)(O_FAIR)).toBe(false);
  });

  it("lensFilter: every lens for administrators, else the held ones", () => {
    expect(lensFilter(ADMIN, O_FAIR)(L_STAFF)).toBe(true);
    expect(lensFilter(PLATFORM_ADMIN, O_FAIR)(L_STAFF)).toBe(true);
    expect(lensFilter(READER, O_FAIR)(L_VISITOR)).toBe(true);
    expect(lensFilter(READER, O_FAIR)(L_STAFF)).toBe(false);
  });

  it("ownerOf: the principal, null when trusted", () => {
    expect(ownerOf(TRUSTED)).toBeNull();
    expect(ownerOf(READER)).toBe((READER as { caller: Caller }).caller.principal.id);
  });
});
