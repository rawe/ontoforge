/**
 * The tokens a model call used, as its provider reported them through
 * LangChain's `usage_metadata`: the whole prompt (its cached parts
 * included), the output, and the parts of the prompt read from or written
 * to the provider's cache. Shared by the token counter (`metrics.ts`) and
 * the model calls of a turn's diagnostics (`assistants/modelCalls.ts`).
 */

export interface TokenUsage {
  input?: number;
  output?: number;
  cacheRead?: number;
  cacheWrite?: number;
}

/** The usage a call reported: each count only when it was reported, a
 * reported 0 kept; nothing when none was. */
export function tokenUsage(usage: unknown): TokenUsage | undefined {
  if (usage === null || typeof usage !== "object") return undefined;
  const reported = usage as Record<string, unknown>;
  const cached = (reported.input_token_details ?? {}) as Record<string, unknown>;
  const counts = Object.entries({
    input: reported.input_tokens,
    output: reported.output_tokens,
    cacheRead: cached.cache_read,
    cacheWrite: cached.cache_creation,
  }).filter(([, count]) => typeof count === "number" && Number.isFinite(count));
  return counts.length === 0 ? undefined : Object.fromEntries(counts) as TokenUsage;
}
