/**
 * Browser sessions: shared state (`docs/architecture.md#shared-state`), so
 * a session started on one server works on every server. Sessions are lost
 * with the store — a user then signs in again — and expire on their own:
 * after `idleMs` without use, and at the latest `absoluteMs` after they were
 * created. A login in progress keeps no state here: it lives in the
 * browser's encrypted login cookie (`loginCookie.ts`).
 *
 * A session id is not kept as it is: the stores key by its SHA-256, so
 * what the store holds cannot be replayed as a cookie.
 */

import { createHash } from "node:crypto";

import { StoreError } from "../core/exceptions.js";

export interface Session {
  principalId: string;
}

export interface SessionLifetimes {
  idleMs: number;
  absoluteMs: number;
}

export const SESSION_ABSOLUTE_LIFETIME_MS = 24 * 60 * 60 * 1000;

export interface SessionStore {
  /** Keeps a new session; it expires after `idleMs` unused, `absoluteMs` at the latest. */
  create(id: string, session: Session): Promise<void>;
  /** The session, its idle deadline moved on (never past its absolute one); null if gone. */
  get(id: string): Promise<Session | null>;
  delete(id: string): Promise<void>;
}

/** The key part a session id is kept under. */
export function digest(secret: string): string {
  return createHash("sha256").update(secret).digest("hex");
}

export type Clock = () => number;

/** At most this many sessions in memory. */
export const MEMORY_SESSION_STORE_MAX_ENTRIES = 100_000;

interface MemoryEntry {
  value: string;
  /** Expires at this time unless use moves it. */
  deadline: number;
  absolute: number;
}

/**
 * The sessions of one server process. Expiry is applied on access; a full
 * store first drops what has expired and then refuses, never removing a
 * live entry — as Valkey's `noeviction` does.
 */
export class MemorySessionStore implements SessionStore {
  private readonly sessions = new Map<string, MemoryEntry>();

  constructor(
    private readonly lifetimes: SessionLifetimes,
    private readonly clock: Clock = Date.now,
    private readonly maxEntries = MEMORY_SESSION_STORE_MAX_ENTRIES,
  ) {}

  private room(): void {
    if (this.sessions.size < this.maxEntries) return;
    const now = this.clock();
    for (const [key, entry] of this.sessions) if (entry.deadline <= now) this.sessions.delete(key);
    if (this.sessions.size >= this.maxEntries) {
      throw new StoreError("The session store is full");
    }
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
