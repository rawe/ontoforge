/**
 * AI configuration value types shared by modeling and runtime — agent
 * configurations and saved-query pipelines, ported from the dataclass
 * block of the Python reference (`core/ai.py`) — plus the language-model
 * provider seam.
 *
 * Two providers, both via OpenAI-compatible chat endpoints: `ollama` and
 * `openai` (`{AI_BASE_URL}/v1`; the openai provider additionally requires
 * `AI_API_KEY`). The engine is LangChain's `ChatOpenAI` (approved stack:
 * LangChain.js / LangGraph.js, replacing the Python reference's
 * pydantic-ai). With no `AI_PROVIDER` configured, no model is installed
 * and every model-running route answers `422 VALIDATION_ERROR` with
 * `details.code: "FEATURE_DISABLED"` (approved divergence #2); listing
 * agents and serving cards keep working. Tests inject a fake model via
 * `setAiModel`.
 */

import type { BaseChatModel } from "@langchain/core/language_models/chat_models";
import { ChatOpenAI } from "@langchain/openai";

import { settings } from "../config.js";

/** A named language-model configuration belonging to one lens. */
export interface AgentConfig {
  key: string;
  name: string;
  description: string | null;
  systemPrompt: string | null;
  /** Allowlist of grantable tool names; `null` = all available. */
  tools: string[] | null;
}

/** One declared saved-query parameter (always a scalar). */
export interface SavedQueryParameter {
  name: string;
  description: string;
  dataType: string;
}

/** One pipeline step: `oql` carries its query in `oql`; `semantic_search`
 * carries its search text in `query`. */
export interface StepConfig {
  name: string;
  /** "oql" or "semantic_search". */
  type: string;
  oql?: string | null;
  entityTypeKey?: string | null;
  query?: string | null;
  limit?: number | null;
  minScore?: number | null;
  bindings?: Record<string, string> | null;
}

/** A stored, named, parameterized pipeline belonging to one lens. */
export interface SavedQueryConfig {
  key: string;
  name: string;
  description: string;
  steps: StepConfig[];
  parameters: SavedQueryParameter[];
}

/** The implicit default agent: `_default`-keyed (no configurable key may
 * begin with an underscore, so it can never be shadowed), undeletable,
 * no prompt of its own, unrestricted tools. */
export const DEFAULT_AGENT_CONFIG: AgentConfig = {
  key: "_default",
  name: "Knowledge Assistant",
  description: null,
  systemPrompt: null,
  tools: null,
};

/** Build a chat model from its provider name; throws on unknown names and
 * missing credentials — startup fails loudly rather than serving degraded. */
export function createAiModel(
  provider: string,
  modelName: string,
  baseUrl: string,
): BaseChatModel {
  const base = baseUrl.replace(/\/+$/, "");
  if (provider === "ollama") {
    // Ollama's OpenAI-compatible endpoint ignores the API key, but the
    // client requires one to be present.
    return new ChatOpenAI({
      model: modelName,
      apiKey: "ollama",
      configuration: { baseURL: `${base}/v1` },
    });
  }
  if (provider === "openai") {
    const apiKey = settings.AI_API_KEY;
    if (!apiKey) {
      throw new Error("AI_API_KEY is required for the openai provider");
    }
    return new ChatOpenAI({
      model: modelName,
      apiKey,
      configuration: { baseURL: `${base}/v1` },
    });
  }
  throw new Error(`Unknown AI provider: '${provider}'`);
}

let model: BaseChatModel | null = null;

/** Startup step 4: install the configured language model, or none. */
export function initAiModel(): void {
  if (!settings.AI_PROVIDER) {
    console.info("AI_PROVIDER not set — AI endpoints disabled");
    return;
  }
  model = createAiModel(settings.AI_PROVIDER, settings.AI_MODEL, settings.AI_BASE_URL);
  console.info(
    `AI model initialized: ${settings.AI_MODEL} ` +
      `(${settings.AI_PROVIDER} via ${settings.AI_BASE_URL})`,
  );
}

export function closeAiModel(): void {
  model = null;
}

/** The active model, or `null` when AI is disabled. */
export function getAiModel(): BaseChatModel | null {
  return model;
}

/** Install (or clear) the active model. Startup and tests only. */
export function setAiModel(next: BaseChatModel | null): void {
  model = next;
}
