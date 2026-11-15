/**
 * The tokens a model call used, as its provider reported them through
 * LangChain's `usage_metadata`: the whole prompt (its cached parts
 * included), the output, and the parts of the prompt read from or written
 * to the provider's cache. Shared by the token counter (`metrics.ts`) and
 * the model steps of a turn's diagnostics (`assistants/diagnostics.ts`).
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

type Counts = Record<string, unknown>;

/**
 * The usage of a streamed call from the usage two of its chunks carried:
 * per count, the larger one. A provider reports a count once (the OpenAI
 * protocol with its last chunk, Anthropic the input with its first) or as
 * a running total (Anthropic's output), never as amounts to add up.
 */
export function largerUsage<T extends object>(a: T, b: T): T {
  const whole = { ...a } as Counts;
  for (const [key, count] of Object.entries(b)) {
    const other = whole[key];
    if (typeof count === "number") whole[key] = typeof other === "number" ? Math.max(other, count) : count;
    else if (count !== null && typeof count === "object") whole[key] = largerUsage((other ?? {}) as Counts, count as Counts);
  }
  return whole as T;
}
