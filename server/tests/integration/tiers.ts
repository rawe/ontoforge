/**
 * Conformance tiers. The integration suite is the conformance suite
 * (`docs/workflows/testing.md`), and it splits in two:
 *
 * - The **contract tier** — everything not gated here — runs on every
 *   adapter: bound stores, registry operations, and isolation semantics
 *   at scale one.
 * - The **multi-ontology tier** needs several ontologies side by side
 *   and runs only on adapters whose registry holds more than one.
 *   Gate its describes/its with `supportsMultipleOntologies`.
 *
 * Neo4j is capped at exactly one ontology — its registry rejects a
 * second create as a domain conflict — so it skips the multi-ontology
 * tier cleanly. Like the reset (`reset.ts`), the capability list is
 * harness knowledge, dispatched on `DB_BACKEND`.
 */

import { settings } from "../../src/config.js";

/** True on the backends whose registry holds several ontologies at
 * once — PostgreSQL today. */
export const supportsMultipleOntologies = settings.DB_BACKEND === "postgres";
