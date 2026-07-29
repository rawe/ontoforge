/**
 * AI configuration value types shared by modeling and runtime: agent
 * configurations and saved-query pipelines, ported from the dataclass
 * block of the Python reference (`core/ai.py`). The language-model
 * provider itself arrives in session 11 — these are pure data shapes.
 */

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
