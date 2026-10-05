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
  EMBEDDING_DIMENSIONS: number;
  EMBEDDING_BATCH_SIZE: number;
  EMBEDDING_CONCURRENCY: number;

  DOCUMENT_CHUNK_SIZE: number;
  DOCUMENT_CHUNK_OVERLAP: number;

  SEARCH_MAX_ATTEMPTS: number;
  SEARCH_WORKER_BATCH: number;
  SEARCH_POLL_MS: number;

  AI_PROVIDER: string | null;
  AI_MODEL: string;
  AI_BASE_URL: string;
  AI_API_KEY: string | null;
  AI_REASONING_EFFORT: string | null;

  DECISION_BASE_URL: string | null;
  DECISION_MODEL: string;
  DECISION_API_KEY: string | null;

  PUBLIC_URL: string | null;
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

function positiveInt(env: NodeJS.ProcessEnv, name: string, fallback: number): number {
  const parsed = int(env, name, fallback);
  if (parsed < 1) {
    throw new Error(`Environment variable ${name} must be a positive integer: '${env[name]}'`);
  }
  return parsed;
}

/** Accepted `AI_REASONING_EFFORT` levels. `none` switches model thinking off;
 * leaving the variable unset sends nothing and leaves the model at its own
 * default, which is not the same thing. */
const AI_REASONING_EFFORTS = ["none", "low", "medium", "high"];

function optOneOf(
  env: NodeJS.ProcessEnv,
  name: string,
  allowed: string[],
): string | null {
  const value = env[name];
  if (value === undefined || value === "") return null;
  if (!allowed.includes(value)) {
    throw new Error(
      `Environment variable ${name} must be one of ${allowed.join(", ")}: '${value}'`,
    );
  }
  return value;
}

export function loadSettings(env: NodeJS.ProcessEnv = process.env): Settings {
  return {
    DB_BACKEND: str(env, "DB_BACKEND", "postgres"),
    DB_URI: str(env, "DB_URI", "postgresql://localhost:5432/ontoforge"),
    DB_USER: str(env, "DB_USER", "postgres"),
    DB_PASSWORD: str(env, "DB_PASSWORD", "ontoforge_dev"),
    PORT: int(env, "PORT", 8000),

    EMBEDDING_PROVIDER: optStr(env, "EMBEDDING_PROVIDER"),
    EMBEDDING_MODEL: str(env, "EMBEDDING_MODEL", "bge-m3"),
    EMBEDDING_BASE_URL: str(env, "EMBEDDING_BASE_URL", "http://localhost:11434"),
    EMBEDDING_API_KEY: optStr(env, "EMBEDDING_API_KEY"),
    EMBEDDING_DIMENSIONS: positiveInt(env, "EMBEDDING_DIMENSIONS", 1024),
    // Texts per provider request, and requests in flight at once, when the
    // provider embeds many texts (`embedBatch`).
    EMBEDDING_BATCH_SIZE: positiveInt(env, "EMBEDDING_BATCH_SIZE", 1),
    EMBEDDING_CONCURRENCY: positiveInt(env, "EMBEDDING_CONCURRENCY", 1),

    DOCUMENT_CHUNK_SIZE: int(env, "DOCUMENT_CHUNK_SIZE", 1500),
    DOCUMENT_CHUNK_OVERLAP: int(env, "DOCUMENT_CHUNK_OVERLAP", 200),

    // The search worker: failed attempts before an item counts as failed,
    // queue items claimed per batch, and the polling interval that backs up
    // the wake-up notifications.
    SEARCH_MAX_ATTEMPTS: positiveInt(env, "SEARCH_MAX_ATTEMPTS", 5),
    SEARCH_WORKER_BATCH: positiveInt(env, "SEARCH_WORKER_BATCH", 64),
    SEARCH_POLL_MS: positiveInt(env, "SEARCH_POLL_MS", 5000),

    AI_PROVIDER: optStr(env, "AI_PROVIDER"),
    AI_MODEL: str(env, "AI_MODEL", "qwen3:8b"),
    AI_BASE_URL: str(env, "AI_BASE_URL", "http://localhost:11434"),
    AI_API_KEY: optStr(env, "AI_API_KEY"),
    AI_REASONING_EFFORT: optOneOf(env, "AI_REASONING_EFFORT", AI_REASONING_EFFORTS),

    DECISION_BASE_URL: optStr(env, "DECISION_BASE_URL"),
    DECISION_MODEL: str(env, "DECISION_MODEL", "jev-1.13.0"),
    // TypeSafe's own variable name is honoured as the fallback.
    DECISION_API_KEY: optStr(env, "DECISION_API_KEY") ?? optStr(env, "TYPESAFE_API_KEY"),

    PUBLIC_URL: optStr(env, "PUBLIC_URL"),
  };
}

// Exactly one env file is read: the one `ENV_FILE` names, or `.env` from the
// working directory when it does not. `loadEnvFile` never overwrites a
// variable already set in the real environment, so a shell variable still
// wins over both. A named file that is missing is a boot failure — a typo
// must not quietly fall through to the defaults above.
const envFile = process.env.ENV_FILE;
if (envFile !== undefined && envFile !== "") {
  process.loadEnvFile(envFile);
} else {
  try {
    process.loadEnvFile();
  } catch {
    // No .env file — fine.
  }
}

export const settings: Settings = loadSettings();
