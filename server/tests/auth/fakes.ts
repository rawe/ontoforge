/**
 * Fakes for authentication tests: an access store in memory (only what
 * authentication calls, the authorization server's records included), a
 * provider that knows a fixed set of tokens, and the runtime around them —
 * with the real authorization server over the fake store.
 */

import { randomUUID } from "node:crypto";

import type { AccessStore, Assignment, OAuthRecords, Principal, Profile, Role } from "../../src/access/store.js";
import { createAuthorizationServer } from "../../src/auth/authorizationServer.js";
import type { Identified, LoginStart, Oidc } from "../../src/auth/oidc.js";
import type { AuthRuntime } from "../../src/auth/runtime.js";
import { MemorySessionStore } from "../../src/auth/sessionStore.js";
import type { AuthSettings } from "../../src/config.js";
import { ProviderUnavailableError } from "../../src/core/exceptions.js";

export const ISSUER = "http://localhost:8180/realms/ontoforge";
export const PUBLIC_URL = "http://localhost:8000";
export const WEB_CLIENT_URL = "http://localhost:5173";
export const ADMIN_SUBJECT = "admin-sub";

export const SETTINGS: AuthSettings = {
  issuer: ISSUER,
  backchannelUrl: ISSUER,
  clientId: "ontoforge-web",
  clientSecret: "test-secret",
  audience: "ontoforge-api",
  subjectClaim: "sub",
  adminSubject: ADMIN_SUBJECT,
  sessionIdleSeconds: 3600,
  accessDbUri: "postgresql://localhost:5432/ontoforge_access_test",
  publicUrl: PUBLIC_URL,
  webClientUrl: WEB_CLIENT_URL,
  oauthClients: [],
  oauthClientHosts: null,
};

export function identified(subject: string): Identified {
  return { issuer: ISSUER, subject, displayName: `Name of ${subject}`, email: `${subject}@example.com`, username: subject };
}

interface MemoryRecord {
  payload: Record<string, unknown>;
  grantId: string | null;
  expiresAt: number | null;
}

/** The authorization server's records in memory, expiring as the PostgreSQL store's do. */
export class MemoryOAuthRecords implements OAuthRecords {
  readonly records = new Map<string, MemoryRecord>();

  private live(model: string, id: string): MemoryRecord | null {
    const record = this.records.get(`${model} ${id}`);
    return record === undefined || (record.expiresAt !== null && record.expiresAt <= Date.now()) ? null : record;
  }

  async find(model: string, id: string): Promise<Record<string, unknown> | null> {
    const record = this.live(model, id);
    return record === null ? null : structuredClone(record.payload);
  }

  async upsert(model: string, id: string, payload: Record<string, unknown>, grantId: string | null, expiresIn: number | undefined): Promise<void> {
    const expiresAt = expiresIn === undefined ? null : Date.now() + expiresIn * 1000;
    this.records.set(`${model} ${id}`, { payload: structuredClone(payload), grantId, expiresAt });
  }

  async consume(model: string, id: string): Promise<boolean> {
    const record = this.live(model, id);
    if (record === null || record.payload.consumed !== undefined) return false;
    record.payload.consumed = Math.floor(Date.now() / 1000);
    return true;
  }

  async destroy(model: string, id: string): Promise<void> {
    this.records.delete(`${model} ${id}`);
  }

  async revokeByGrantId(model: string, grantId: string): Promise<void> {
    for (const [key, record] of this.records) if (key.startsWith(`${model} `) && record.grantId === grantId) this.records.delete(key);
  }
}

export class FakeAccess {
  readonly oauth = new MemoryOAuthRecords();
  readonly principals = new Map<string, Principal>();
  readonly identities = new Map<string, string>();
  readonly assignments: Assignment[] = [];
  readonly calls: string[] = [];

  add(subject: string, status: Principal["status"] = "active"): Principal {
    const now = new Date("2026-10-01T00:00:00Z");
    const principal: Principal = {
      id: randomUUID(),
      kind: "user",
      displayName: `Name of ${subject}`,
      email: null,
      username: subject,
      status,
      createdAt: now,
      updatedAt: now,
      lastLoginAt: null,
    };
    this.principals.set(principal.id, principal);
    this.identities.set(`${ISSUER} ${subject}`, principal.id);
    return principal;
  }

  grant(principalId: string, role: Role, ontologyId: string | null = null, lensId: string | null = null): Assignment {
    const assignment: Assignment = {
      id: randomUUID(),
      principalId,
      role,
      ontologyId,
      lensId,
      createdAt: new Date("2026-10-02T00:00:00Z"),
      createdBy: null,
    };
    this.assignments.push(assignment);
    return assignment;
  }

  async signIn(issuer: string, subject: string, profile: Profile, bootstrapAdmin: boolean): Promise<Principal> {
    this.calls.push(`signIn ${subject} ${bootstrapAdmin}`);
    const id = this.identities.get(`${issuer} ${subject}`);
    let principal = id === undefined ? this.add(subject) : this.principals.get(id)!;
    principal = { ...principal, ...profile, lastLoginAt: new Date() };
    if (bootstrapAdmin) {
      principal.status = "active";
      if (!this.assignments.some((a) => a.principalId === principal.id && a.role === "platform_admin")) {
        this.grant(principal.id, "platform_admin");
      }
    }
    this.principals.set(principal.id, principal);
    return principal;
  }

  async principalOf(issuer: string, subject: string): Promise<Principal | null> {
    const id = this.identities.get(`${issuer} ${subject}`);
    return id === undefined ? null : this.principals.get(id)!;
  }

  async principal(id: string): Promise<Principal | null> {
    return this.principals.get(id) ?? null;
  }

  async assignmentsOf(principalId: string): Promise<Assignment[]> {
    this.calls.push(`assignmentsOf ${principalId}`);
    return this.assignments.filter((a) => a.principalId === principalId);
  }

  async close(): Promise<void> {}

  store(): AccessStore {
    return this as unknown as AccessStore;
  }
}

export class FakeOidc implements Oidc {
  /** Access tokens this provider accepts. */
  readonly tokens = new Map<string, Identified>();
  verifications = 0;
  /** True while the provider's keys cannot be fetched. */
  unavailable = false;
  /** What the next callback yields: an identity, or an error thrown. */
  login: Identified | Error = identified("someone");
  readonly finished: { callbackUrl: URL; checks: { state: string; nonce: string; codeVerifier: string } }[] = [];
  private counter = 0;

  async startLogin(redirectUri: string): Promise<LoginStart> {
    this.counter += 1;
    const state = `state-${this.counter}`;
    const url = new URL(`${ISSUER}/protocol/openid-connect/auth`);
    url.searchParams.set("redirect_uri", redirectUri);
    url.searchParams.set("state", state);
    return { state, nonce: `nonce-${this.counter}`, codeVerifier: `verifier-${this.counter}`, url };
  }

  async finishLogin(callbackUrl: URL, checks: { state: string; nonce: string; codeVerifier: string }): Promise<Identified> {
    this.finished.push({ callbackUrl, checks });
    if (this.login instanceof Error) throw this.login;
    return this.login;
  }

  logoutUrl(postLogoutRedirectUri: string): string {
    return `${ISSUER}/protocol/openid-connect/logout?post_logout_redirect_uri=${encodeURIComponent(postLogoutRedirectUri)}`;
  }

  async verifyAccessToken(token: string): Promise<Identified | null> {
    this.verifications += 1;
    if (this.unavailable) throw new ProviderUnavailableError();
    return this.tokens.get(token) ?? null;
  }
}

export interface Fakes {
  runtime: AuthRuntime;
  access: FakeAccess;
  oidc: FakeOidc;
}

export function fakeRuntime(settings: AuthSettings = SETTINGS): Fakes {
  const access = new FakeAccess();
  const oidc = new FakeOidc();
  const sessions = new MemorySessionStore({ idleMs: 60_000, absoluteMs: 120_000 });
  const oauth = createAuthorizationServer(settings, access.store());
  return { runtime: { settings, oidc, access: access.store(), sessions, oauth }, access, oidc };
}
