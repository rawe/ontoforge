/**
 * Shared support for the AI integration suite: Ollama availability probing
 * (the suite SKIPS when the provider or model is absent) and per-file
 * provider enablement via `settings` mutation (config is read at process
 * start, so tests mutate and restore — the same pattern as the embedding
 * suite).
 */

import { settings } from "../../../src/config.js";
import { closeAiModel, initAiModel } from "../../../src/core/ai.js";

/** True when Ollama answers at the AI base URL with the model pulled. */
export async function checkOllamaAiModel(model: string = settings.AI_MODEL): Promise<boolean> {
  try {
    const res = await fetch(`${settings.AI_BASE_URL}/api/tags`, {
      signal: AbortSignal.timeout(3000),
    });
    if (!res.ok) {
      return false;
    }
    const payload = (await res.json()) as { models?: { name: string }[] };
    return (payload.models ?? []).some(
      (m) => m.name === model || m.name.startsWith(`${model}:`),
    );
  } catch {
    return false;
  }
}

let originalProvider: string | null = null;

/** Enable the ollama language model for this test file. Pair with
 * `disableAiProvider`. */
export function enableOllamaAiProvider(): void {
  originalProvider = settings.AI_PROVIDER;
  settings.AI_PROVIDER = "ollama";
  initAiModel();
}

/** Restore the no-provider state for the suites that follow. */
export function disableAiProvider(): void {
  closeAiModel();
  settings.AI_PROVIDER = originalProvider;
}
