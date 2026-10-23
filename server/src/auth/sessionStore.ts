/**
 * Browser sessions and login transactions: shared state
 * (`docs/architecture.md#shared-state`), so a login started on one server
 * completes on another and a session works on every server. Both are lost
 * with the store — a user then signs in again — and both expire on their
 * own: a login transaction after `loginMs`, a session after `idleMs` without
 * use and at the latest `absoluteMs` after it was created.
 *
 * Neither a session id nor a login `state` is kept as it is: the stores
 * key by its SHA-256, so what the store holds cannot be replayed as a
 * cookie.
 */

import { createHash } from "node:crypto";

import { StoreError } from "../core/exceptions.js";

/** What the callback needs to finish a login it did not start. */
export interface LoginTransaction {
  codeVerifier: string;
  nonce: string;
  /** A same-origin path to return to after the login. */
  returnTo: string;
}

export interface Session {
  principalId: string;
  issuer: string;
  subject: string;
  /** For the provider's logout (`id_token_hint`); null if none was issued. */
  idToken: string | null;
}

export interface SessionLifetimes {
  loginMs: number;
  idleMs: number;
  absoluteMs: number;
}

export const LOGIN_LIFETIME_MS = 10 * 60 * 1000;
export const SESSION_ABSOLUTE_LIFETIME_MS = 24 * 60 * 60 * 1000;

export interface SessionStore {
  /** Keeps a login transaction under its `state` for `loginMs`. */
  startLogin(state: string, login: LoginTransaction): Promise<void>;
  /** The transaction of `state`, removed in the same step: a second take finds nothing. */
  takeLogin(state: string): Promise<LoginTransaction | null>;
  /** Keeps a new session; it expires after `idleMs` unused, `absoluteMs` at the latest. */
  create(id: string, session: Session): Promise<void>;
  /** The session, its idle deadline moved on (never past its absolute one); null if gone. */
  get(id: string): Promise<Session | null>;
  delete(id: string): Promise<void>;
}

/** The key part a session id or login state is kept under. */
export function digest(secret: string): string {
  return createHash("sha256").update(secret).digest("hex");
}

export type Clock = () => number;

/** At most this many sessions and login transactions in memory together. */
export const MEMORY_SESSION_STORE_MAX_ENTRIES = 100_000;

interface MemoryEntry {
  value: string;
  /** Expires at this time unless a session's use moves it. */
  deadline: number;
  /** A session's absolute deadline; a login's equals its deadline. */
  absolute: number;
}

/**
 * The sessions of one server process. Expiry is applied on access; a full
 * store first drops what has expired and then refuses, never removing a
 * live entry — as Valkey's `noeviction` does.
 */
export class MemorySessionStore implements SessionStore {
  private readonly logins = new Map<string, MemoryEntry>();
  private readonly sessions = new Map<string, MemoryEntry>();

  constructor(
    private readonly lifetimes: SessionLifetimes,
    private readonly clock: Clock = Date.now,
    private readonly maxEntries = MEMORY_SESSION_STORE_MAX_ENTRIES,
  ) {}

  private room(): void {
    if (this.logins.size + this.sessions.size < this.maxEntries) return;
    const now = this.clock();
    for (const map of [this.logins, this.sessions]) {
      for (const [key, entry] of map) if (entry.deadline <= now) map.delete(key);
    }
    if (this.logins.size + this.sessions.size >= this.maxEntries) {
      throw new StoreError("The session store is full");
    }
  }

  async startLogin(state: string, login: LoginTransaction): Promise<void> {
    this.room();
    const deadline = this.clock() + this.lifetimes.loginMs;
    this.logins.set(digest(state), { value: JSON.stringify(login), deadline, absolute: deadline });
  }

  async takeLogin(state: string): Promise<LoginTransaction | null> {
    const key = digest(state);
    const entry = this.logins.get(key);
    this.logins.delete(key);
    if (entry === undefined || entry.deadline <= this.clock()) return null;
    return JSON.parse(entry.value) as LoginTransaction;
  }

  async create(id: string, session: Session): Promise<void> {
    this.room();
    const now = this.clock();
    const absolute = now + this.lifetimes.absoluteMs;
    this.sessions.set(digest(id), {
      value: JSON.stringify(session),
      deadline: Math.min(now + this.lifetimes.idleMs, absolute),
      absolute,
    });
  }

  async get(id: string): Promise<Session | null> {
    const key = digest(id);
    const entry = this.sessions.get(key);
    if (entry === undefined) return null;
    const now = this.clock();
    if (entry.deadline <= now) {
      this.sessions.delete(key);
      return null;
    }
    entry.deadline = Math.min(now + this.lifetimes.idleMs, entry.absolute);
    return JSON.parse(entry.value) as Session;
  }

  async delete(id: string): Promise<void> {
    this.sessions.delete(digest(id));
  }
}
