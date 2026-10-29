/**
 * Who is calling, as every entrance — REST, MCP, the chat's nested tool
 * calls — hands it to the one authorization service (`authorize.ts`).
 * Authentication (`auth/`) produces it; authorization only reads it.
 */

import type { Assignment, Principal } from "./store.js";

/** An authenticated, active principal with its assignments as of this request. */
export interface Caller {
  principal: Principal;
  assignments: Assignment[];
  /** How the request proved it: a browser session cookie or a bearer access token. */
  via: "session" | "bearer";
}

/**
 * What a request may do. With authentication off every request is
 * `trusted`: today's behaviour, no check at all. With it on, a request is
 * either a `Caller` or anonymous (`null`), and only public routes serve
 * the anonymous.
 */
export type Access = { kind: "trusted" } | { kind: "caller"; caller: Caller } | { kind: "anonymous" };

export const TRUSTED: Access = { kind: "trusted" };

/**
 * What a route needs, declared once per route in the route table
 * (`routes.ts`) and judged by `authorize.ts`:
 *
 * - `public` — anyone, no caller resolved (probes, docs, `/api/server/*`, `/api/auth/*`,
 *   resource metadata).
 * - `signed-in` — any caller; the handler filters what it returns (`GET /api/ontologies`).
 * - `platform` — the platform role named.
 * - `ontology-admin` — Ontology Administrator of the `:ontologyKey` in the path.
 * - `ontology-member` — any role within that ontology, or Platform Administrator.
 * - `lens` — a lens role on the lens in the path (`:lensKey`, or `:lensId` on modeling
 *   lens routes); `operation` from `runtime/writeAccess.ts`, allowed when the lens role's
 *   level allows it (`authorize.ts` `ROLE_LEVELS`). `orAdmin` also lets the ontology's administrator in
 *   (modeling reads of a lens), never for runtime routes.
 * - `user-admin` — Platform Administrator or an Ontology Administrator of any ontology;
 *   the user-management service narrows it.
 */
export type Need =
  | { kind: "public" }
  | { kind: "signed-in" }
  | { kind: "platform"; role: "platform_admin" | "ontology_creator" }
  | { kind: "ontology-admin" }
  | { kind: "ontology-member" }
  | { kind: "lens"; operation: "read" | "stage" | "commit" | "write"; orAdmin?: true }
  | { kind: "user-admin" };
