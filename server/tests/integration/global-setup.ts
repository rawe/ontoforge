/**
 * Vitest global setup, shared by every suite that touches the database:
 * the suite-level hard reset runs exactly once per suite invocation,
 * before any test file — see `reset.ts`.
 */

import { hardReset } from "./reset.js";

export default async function setup(): Promise<void> {
  await hardReset();
}
