/**
 * The two cookies of browser sign-in: the session cookie, and the login
 * cookie that carries a login in progress (`loginCookie.ts`). Browsers
 * scope cookies by host, not by port, so each name carries the port of
 * `WEB_CLIENT_URL`: two deployments on one host never read each other's.
 *
 * Both are `HttpOnly; Secure; SameSite=Lax` without `Domain`. The session
 * cookie has no lifetime of its own — the server expires the session — and
 * holds 32 random bytes; the server keeps only their digest.
 */

import { randomBytes } from "node:crypto";

import type { FastifyRequest } from "fastify";

export interface CookieNames {
  session: string;
  login: string;
}

export const LOGIN_COOKIE_PATH = "/api/auth";

export function cookieNames(webClientUrl: string): CookieNames {
  const url = new URL(webClientUrl);
  const port = url.port !== "" ? url.port : url.protocol === "https:" ? "443" : "80";
  return { session: `ontoforge_session_${port}`, login: `ontoforge_login_${port}` };
}

export function newSessionId(): string {
  return randomBytes(32).toString("base64url");
}

/** The value of cookie `name` on the request, or null. */
export function readCookie(request: FastifyRequest, name: string): string | null {
  const header = request.headers.cookie;
  if (header === undefined) return null;
  for (const part of header.split(";")) {
    const separator = part.indexOf("=");
    if (separator === -1 || part.slice(0, separator).trim() !== name) continue;
    const value = part.slice(separator + 1).trim();
    return value === "" ? null : value;
  }
  return null;
}

const ATTRIBUTES = "HttpOnly; Secure; SameSite=Lax";

export function sessionCookie(name: string, value: string): string {
  return `${name}=${value}; Path=/; ${ATTRIBUTES}`;
}

export function loginCookie(name: string, value: string, maxAgeSeconds: number): string {
  return `${name}=${value}; Path=${LOGIN_COOKIE_PATH}; Max-Age=${maxAgeSeconds}; ${ATTRIBUTES}`;
}

/** Removes the cookie `name` set at `path`. */
export function clearedCookie(name: string, path: string): string {
  return `${name}=; Path=${path}; Max-Age=0; ${ATTRIBUTES}`;
}
