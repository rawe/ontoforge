/**
 * The login transaction — what the callback needs to finish a login the
 * browser started — kept in the browser itself, in a short-lived cookie
 * sealed with AES-256-GCM. The key is derived from the client secret, so
 * every server of one deployment can open what another sealed, and no
 * server keeps state per login.
 */

import { createCipheriv, createDecipheriv, hkdfSync, randomBytes } from "node:crypto";

export interface LoginTransaction {
  state: string;
  nonce: string;
  codeVerifier: string;
  /** Where the browser goes once signed in: a path with its query, same origin. */
  returnTo: string;
  /** Milliseconds since the epoch; the cookie is refused from then on. */
  exp: number;
}

/** How long a login may take from the provider's page back to the callback. */
export const LOGIN_LIFETIME_MS = 10 * 60 * 1000;

const IV_BYTES = 12;
const TAG_BYTES = 16;

/** The sealing key of one client secret. */
export function loginCookieKey(clientSecret: string): Buffer {
  return Buffer.from(hkdfSync("sha256", clientSecret, Buffer.alloc(0), "ontoforge login cookie", 32));
}

export function sealLogin(transaction: LoginTransaction, key: Buffer): string {
  const iv = randomBytes(IV_BYTES);
  const cipher = createCipheriv("aes-256-gcm", key, iv);
  const sealed = Buffer.concat([cipher.update(JSON.stringify(transaction), "utf8"), cipher.final()]);
  return Buffer.concat([iv, sealed, cipher.getAuthTag()]).toString("base64url");
}

/** The transaction, or null when the value is not one this key sealed or has expired. */
export function openLogin(value: string, key: Buffer, now: number = Date.now()): LoginTransaction | null {
  const raw = Buffer.from(value, "base64url");
  if (raw.length <= IV_BYTES + TAG_BYTES) return null;
  let transaction: LoginTransaction;
  try {
    const decipher = createDecipheriv("aes-256-gcm", key, raw.subarray(0, IV_BYTES));
    decipher.setAuthTag(raw.subarray(raw.length - TAG_BYTES));
    const text = Buffer.concat([decipher.update(raw.subarray(IV_BYTES, raw.length - TAG_BYTES)), decipher.final()]);
    transaction = JSON.parse(text.toString("utf8")) as LoginTransaction;
  } catch {
    return null;
  }
  if (typeof transaction.exp !== "number" || transaction.exp <= now) return null;
  return transaction;
}
