/**
 * The registry of assistant kinds served through the kit
 * (`../kit/kind.ts`). Adding a kind: its module here and its key in
 * `core/assistant.ts` — routes, storage, transfer and checks follow.
 */

import type { AssistantKindKey } from "../../../core/assistant.js";
import type { AnyAssistantKind } from "../kit/kind.js";
import { navigator } from "./navigator/index.js";

export const ASSISTANT_KINDS: readonly AnyAssistantKind[] = [navigator];

export function assistantKind(key: AssistantKindKey): AnyAssistantKind {
  const kind = ASSISTANT_KINDS.find((k) => k.kind === key);
  if (kind === undefined) throw new Error(`Assistant kind '${key}' is not registered`);
  return kind;
}
