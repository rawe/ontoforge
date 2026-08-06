/**
 * Env-driven settings. A `.env` file in the working directory is honoured,
 * with real environment variables taking precedence over it.
 */

export interface Settings {
  DB_BACKEND: string;
  DB_URI: string;
  DB_USER: string;
  DB_PASSWORD: string;
  PORT: number;

  EMBEDDING_PROVIDER: string | null;
  EMBEDDING_MODEL: string;
  EMBEDDING_BASE_URL: string;
  EMBEDDING_API_KEY: string | null;
  EMBEDDING_DIMENSIONS: number | null;

  DOCUMENT_CHUNK_SIZE: number;
  DOCUMENT_CHUNK_OVERLAP: number;

  AI_PROVIDER: string | null;
  AI_MODEL: string;
  AI_BASE_URL: string;
  AI_API_KEY: string | null;

  PUBLIC_URL: string | null;

  /** Fallback ontology key for runtime-MCP connections. Read per request in
   * `mcp/mount.ts`; surfaced here so every consumer shares one settings
   * object. */
  DEFAULT_MCP_ONTOLOGY_KEY: string | null;
}

function str(env: NodeJS.ProcessEnv, name: string, fallback: string): string {
  const value = env[name];
  return value !== undefined && value !== "" ? value : fallback;
}

function optStr(env: NodeJS.ProcessEnv, name: string): string | null {
  const value = env[name];
  return value !== undefined && value !== "" ? value : null;
}

function int(env: NodeJS.ProcessEnv, name: string, fallback: number): number {
  const value = env[name];
  if (value === undefined || value === "") return fallback;
  const parsed = Number.parseInt(value, 10);
  if (Number.isNaN(parsed)) {
    throw new Error(`Environment variable ${name} is not an integer: '${value}'`);
  }
  return parsed;
}

function optInt(env: NodeJS.ProcessEnv, name: string): number | null {
  const value = env[name];
  if (value === undefined || value === "") return null;
  const parsed = Number.parseInt(value, 10);
  if (Number.isNaN(parsed)) {
    throw new Error(`Environment variable ${name} is not an integer: '${value}'`);
  }
  return parsed;
}

export function loadSettings(env: NodeJS.ProcessEnv = process.env): Settings {
  return {
    DB_BACKEND: str(env, "DB_BACKEND", "neo4j"),
    DB_URI: str(env, "DB_URI", "bolt://localhost:7687"),
    DB_USER: str(env, "DB_USER", "neo4j"),
    DB_PASSWORD: str(env, "DB_PASSWORD", "ontoforge_dev"),
    PORT: int(env, "PORT", 8000),

    EMBEDDING_PROVIDER: optStr(env, "EMBEDDING_PROVIDER"),
    EMBEDDING_MODEL: str(env, "EMBEDDING_MODEL", "nomic-embed-text"),
    EMBEDDING_BASE_URL: str(env, "EMBEDDING_BASE_URL", "http://localhost:11434"),
    EMBEDDING_API_KEY: optStr(env, "EMBEDDING_API_KEY"),
    EMBEDDING_DIMENSIONS: optInt(env, "EMBEDDING_DIMENSIONS"),

    DOCUMENT_CHUNK_SIZE: int(env, "DOCUMENT_CHUNK_SIZE", 1500),
    DOCUMENT_CHUNK_OVERLAP: int(env, "DOCUMENT_CHUNK_OVERLAP", 200),

    AI_PROVIDER: optStr(env, "AI_PROVIDER"),
    AI_MODEL: str(env, "AI_MODEL", "qwen3:8b"),
    AI_BASE_URL: str(env, "AI_BASE_URL", "http://localhost:11434"),
    AI_API_KEY: optStr(env, "AI_API_KEY"),

    PUBLIC_URL: optStr(env, "PUBLIC_URL"),

    DEFAULT_MCP_ONTOLOGY_KEY: optStr(env, "DEFAULT_MCP_ONTOLOGY_KEY"),
  };
}

// Load a `.env` file if one exists in the working directory. `loadEnvFile`
// does not override variables already set in the real environment.
try {
  process.loadEnvFile();
} catch {
  // No .env file — fine.
}

export const settings: Settings = loadSettings();
