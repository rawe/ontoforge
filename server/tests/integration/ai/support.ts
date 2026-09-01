/**
 * Shared support for the AI integration suite: the deliberate-run gate and
 * the provider-neutral availability probe. The suite installs the configured
 * model itself with `initAiModel` and drops it again with `closeAiModel`;
 * unlike the embedding suite it overrides nothing in `settings`, so the
 * provider under test is exactly the configured one.
 *
 * The suite drives a REAL language model through whatever `AI_PROVIDER`
 * names. It gets that from its own env file — `env/test-ai.env`, selected by
 * the npm script — which configures a local Ollama model and carries no
 * credential, so a default run is free and `server/.env` is never read. A
 * paid provider is reached only by naming an uncommitted file for that run:
 * `ENV_FILE=../env/test-ai.local.env npm run test:integration:ai`.
 */

import { settings } from "../../../src/config.js";

const PROBE_TIMEOUT_MS = 5000;

/** The OpenAI-compatible model listing, served by every provider this suite
 * supports — OpenRouter and Ollama's compatibility layer alike. Probing it
 * keeps the suite free of provider-specific endpoints. */
function modelsUrl(): string {
  return `${settings.AI_BASE_URL.replace(/\/+$/, "")}/v1/models`;
}

async function probeModel(): Promise<string | null> {
  const url = modelsUrl();
  const model = settings.AI_MODEL;
  try {
    const res = await fetch(url, {
      headers: settings.AI_API_KEY ? { authorization: `Bearer ${settings.AI_API_KEY}` } : {},
      signal: AbortSignal.timeout(PROBE_TIMEOUT_MS),
    });
    if (!res.ok) {
      return (
        `AI integration suite SKIPPED: the configured AI endpoint did not answer.\n` +
        `  Probed GET ${url} — HTTP ${res.status}.\n` +
        `  Provider '${settings.AI_PROVIDER}', model '${model}'.\n` +
        `  Check that AI_BASE_URL points at the host serving /v1 (without the\n` +
        `  /v1 itself), and that AI_API_KEY is valid if the endpoint needs one.`
      );
    }
    const payload = (await res.json()) as { data?: { id: string }[] };
    const ids = (payload.data ?? []).map((m) => m.id);
    // Ollama lists tagged names (`qwen3:8b`), so a bare model name matches
    // its tagged form too.
    if (!ids.some((id) => id === model || id.startsWith(`${model}:`))) {
      return (
        `AI integration suite SKIPPED: AI_MODEL is not offered by the endpoint.\n` +
        `  Probed GET ${url} — the listing does not contain '${model}'.\n` +
        `  Use the id exactly as the provider spells it (OpenRouter slugs are\n` +
        `  prefixed, e.g. 'openai/gpt-5.6-luna'). For Ollama: ollama pull ${model}.`
      );
    }
    return null;
  } catch (exc) {
    return (
      `AI integration suite SKIPPED: the configured AI endpoint is unreachable.\n` +
      `  Probed GET ${url} — ${exc instanceof Error ? exc.message : String(exc)}.\n` +
      `  Provider '${settings.AI_PROVIDER}', model '${model}'.\n` +
      `  Check the endpoint is running and AI_BASE_URL is correct.`
    );
  }
}

/**
 * Why the suite is not running, or `null` when it is cleared to run.
 *
 * Every branch names the cause and the fix in full, so an assistant reading
 * the test output can explain the skip without inspecting the code.
 */
export async function aiSuiteSkipReason(): Promise<string | null> {
  if (!settings.AI_PROVIDER) {
    return (
      `AI integration suite SKIPPED: no AI_PROVIDER is configured.\n` +
      `  The suite reads the env file the npm script names — env/test-ai.env by\n` +
      `  default. Set AI_PROVIDER, AI_MODEL and AI_BASE_URL there (plus\n` +
      `  AI_API_KEY for the 'openai' provider). The model must support tool\n` +
      `  calling. See docs/workflows/testing.md.`
    );
  }
  return probeModel();
}
