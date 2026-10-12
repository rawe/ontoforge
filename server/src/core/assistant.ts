/**
 * Assistants of a registered kind (`runtime/assistants/kinds/`): what one
 * stored configuration is, whatever its kind. The configuration is kept as
 * stored — a version or shape this release cannot run stays readable and
 * exportable, and its kind reports it invalid.
 *
 * Agents and retrievers predate the kind registry and keep their own
 * records (`core/ai.ts`, `core/retriever.ts`).
 */

/** The kinds the registry serves, by route segment. A kind is added here
 * and in `runtime/assistants/kinds/index.ts`. */
export const ASSISTANT_KIND_KEYS = ["navigators"] as const;
export type AssistantKindKey = (typeof ASSISTANT_KIND_KEYS)[number];

/** One stored assistant of a registered kind. */
export interface AssistantRecord {
  assistantId: string;
  kind: AssistantKindKey;
  key: string;
  name: string;
  description: string | null;
  configVersion: number;
  config: unknown;
  createdAt: Date;
  updatedAt: Date;
}

/** What a write stores. */
export type AssistantWrite = Omit<AssistantRecord, "createdAt" | "updatedAt">;
