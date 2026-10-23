/**
 * Shared support for the Valkey suite: the dev Valkey's URL in the suite's
 * own logical database (`env/test-valkey.env`), checked before any test
 * runs, and the key-expiry invariant every aspect's suite asserts.
 */

import { Valkey } from "iovalkey";
import { expect } from "vitest";

import { settings } from "../../../src/config.js";

/** The dev Valkey's container (`docker-compose.yml`); one test pauses and restarts it. */
export const CONTAINER = "ontoforge-valkey-dev";
/** The logical database the suite owns: it flushes this one only. */
const DATABASE = "/15";

if (settings.SHARED_STATE !== "valkey" || settings.VALKEY_URL === null) {
  throw new Error("The Valkey suite runs with env/test-valkey.env (SHARED_STATE=valkey, VALKEY_URL)");
}
if (new URL(settings.VALKEY_URL).pathname !== DATABASE) {
  throw new Error(`The Valkey suite flushes its database: VALKEY_URL must name database ${DATABASE.slice(1)}`);
}
export const url = settings.VALKEY_URL;

/** A plain client for what the stores never do: flushing, configuring, inspecting. */
export async function openAdmin(): Promise<Valkey> {
  const admin = new Valkey(url);
  await admin.ping();
  return admin;
}

/**
 * Every key under `ontoforge:*` expires: under `noeviction` a key without
 * an expiry is never freed. A key gone between SCAN and PTTL counts as
 * expired.
 */
export async function expectEveryKeyExpiring(admin: Valkey): Promise<void> {
  const keys: string[] = [];
  let cursor = "0";
  do {
    const [next, batch] = await admin.scan(cursor, "MATCH", "ontoforge:*", "COUNT", 1000);
    keys.push(...batch);
    cursor = next;
  } while (cursor !== "0");
  const lasting = [];
  for (const key of keys) if ((await admin.pttl(key)) === -1) lasting.push(key);
  expect(lasting).toEqual([]);
}
