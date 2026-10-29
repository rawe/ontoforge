/**
 * Env-driven settings. A `.env` file in the working directory is honoured,
 * with real environment variables taking precedence over it.
 */

export interface Settings {
  DB_BACKEND: string;
  DB_URI: string;
  DB_USER: string;
  DB_PASSWORD: string;
  DB_POOL_SIZE: number;
  DB_LISTEN_URI: string | null;
  PORT: number;
  SHUTDOWN_DRAIN_SECONDS: number;

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

  CHANGESET_MAX_BYTES: number;
  CHANGESET_MAX_OBJECTS: number;
  REQUEST_BODY_LIMIT: number;

  AI_PROVIDER: string | null;
  AI_MODEL: string;
  AI_BASE_URL: string;
  AI_API_KEY: string | null;
  AI_REASONING_EFFORT: string | null;

  DECISION_BASE_URL: string | null;
  DECISION_MODEL: string;
  DECISION_API_KEY: string | null;

  PUBLIC_URL: string | null;

  SHARED_STATE: "memory" | "valkey";
  VALKEY_URL: string | null;

  AUTH_ENABLED: boolean;
  OIDC_ISSUER: string | null;
  OIDC_BACKCHANNEL_URL: string | null;
  OIDC_CLIENT_ID: string | null;
  OIDC_CLIENT_SECRET: string | null;
  OIDC_AUDIENCE: string | null;
  AUTH_ADMIN_SUBJECT: string | null;
  AUTH_SESSION_IDLE_SECONDS: number | null;
  ACCESS_DB_URI: string | null;
  WEB_CLIENT_URL: string | null;
}

/** The settings authentication runs on: present only when it is enabled. */
export interface AuthSettings {
  issuer: string;
  backchannelUrl: string;
  clientId: string;
  clientSecret: string;
  audience: string;
  adminSubject: string;
  sessionIdleSeconds: number;
  accessDbUri: string;
  /** The server's address: MCP clients sign in for resources under it. */
  publicUrl: string;
  /** The web client's address, where browser sign-in runs; null: no browser sign-in. */
  webClientUrl: string | null;
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

/**
 * Where shared state such as assistant conversations lives: `memory` serves
 * one process only, `valkey` is shared by every server naming the same
 * `VALKEY_URL`. A URL without the switch fails the boot — it would otherwise
 * quietly run each server on its own memory.
 */
function sharedState(env: NodeJS.ProcessEnv): Pick<Settings, "SHARED_STATE" | "VALKEY_URL"> {
  const store = optOneOf(env, "SHARED_STATE", ["memory", "valkey"]) ?? "memory";
  const url = optStr(env, "VALKEY_URL");
  if (store === "memory") {
    if (url !== null) {
      throw new Error("Environment variable VALKEY_URL is set but SHARED_STATE is not 'valkey'");
    }
    return { SHARED_STATE: "memory", VALKEY_URL: null };
  }
  if (url === null) {
    throw new Error("Environment variable VALKEY_URL is required when SHARED_STATE is 'valkey'");
  }
  let protocol: string | null = null;
  try {
    protocol = new URL(url).protocol;
  } catch {
    // Reported below.
  }
  if (protocol !== "redis:" && protocol !== "rediss:") {
    throw new Error("Environment variable VALKEY_URL is not a redis:// or rediss:// URL");
  }
  return { SHARED_STATE: "valkey", VALKEY_URL: url };
}

/** `value` checked as an http(s) URL, trailing slashes trimmed unless `exact`. */
function httpUrl(name: string, value: string, exact = false): string {
  let protocol: string | null = null;
  try {
    protocol = new URL(value).protocol;
  } catch {
    // Reported below.
  }
  if (protocol !== "http:" && protocol !== "https:") {
    throw new Error(`Environment variable ${name} is not an http(s) URL: '${value}'`);
  }
  return exact ? value : value.replace(/\/+$/, "");
}

/** Hosts a browser treats as secure over plain `http:`. */
function isLoopback(hostname: string): boolean {
  return (
    hostname === "localhost" ||
    hostname === "127.0.0.1" ||
    hostname === "[::1]" ||
    hostname.endsWith(".localhost")
  );
}

/**
 * A URL authentication relies on: https, or http on a loopback host only.
 * `WEB_CLIENT_URL`'s cookies are `Secure`, which a browser accepts over
 * `http:` from a loopback host only — anywhere else the sign-in would
 * silently never stick; the issuer's keys and the tokens sent to
 * `PUBLIC_URL` must not cross a network in the clear.
 */
function secureUrl(name: string, value: string, exact = false): string {
  const url = httpUrl(name, value, exact);
  const { protocol, hostname } = new URL(url);
  if (protocol === "http:" && !isLoopback(hostname)) {
    throw new Error(
      `Environment variable ${name} must be an https URL when AUTH_ENABLED is 'true' ` +
        `(http is allowed on localhost only): '${value}'`,
    );
  }
  return url;
}

/**
 * Authentication: `AUTH_ENABLED` is `true` or `false` (the default). When
 * it is on, every variable it needs must be set — a missing one fails the
 * boot rather than leaving a server that would have to run unprotected.
 * When it is off, the others are not read: a preset may carry them.
 */
function auth(
  env: NodeJS.ProcessEnv,
): Pick<
  Settings,
  | "AUTH_ENABLED"
  | "OIDC_ISSUER"
  | "OIDC_BACKCHANNEL_URL"
  | "OIDC_CLIENT_ID"
  | "OIDC_CLIENT_SECRET"
  | "OIDC_AUDIENCE"
  | "AUTH_ADMIN_SUBJECT"
  | "AUTH_SESSION_IDLE_SECONDS"
  | "ACCESS_DB_URI"
  | "WEB_CLIENT_URL"
> {
  const enabled = optOneOf(env, "AUTH_ENABLED", ["true", "false"]) === "true";
  if (!enabled) {
    return {
      AUTH_ENABLED: false,
      OIDC_ISSUER: null,
      OIDC_BACKCHANNEL_URL: null,
      OIDC_CLIENT_ID: null,
      OIDC_CLIENT_SECRET: null,
      OIDC_AUDIENCE: null,
      AUTH_ADMIN_SUBJECT: null,
      AUTH_SESSION_IDLE_SECONDS: null,
      ACCESS_DB_URI: null,
      WEB_CLIENT_URL: null,
    };
  }
  const required = (name: string): string => {
    const value = optStr(env, name);
    if (value === null) {
      throw new Error(`Environment variable ${name} is required when AUTH_ENABLED is 'true'`);
    }
    return value;
  };
  secureUrl("PUBLIC_URL", required("PUBLIC_URL"));
  // Optional: a server without a web client accepts bearer tokens only.
  const webClient = optStr(env, "WEB_CLIENT_URL");
  // Exactly as given: tokens must carry this very string, a trailing slash included.
  const issuer = secureUrl("OIDC_ISSUER", required("OIDC_ISSUER"), true);
  // The back channel may be http anywhere: the server's own way to the issuer, e.g. in a container network.
  const backchannel = optStr(env, "OIDC_BACKCHANNEL_URL");
  const clientId = required("OIDC_CLIENT_ID");
  const audience = required("OIDC_AUDIENCE");
  // An ID token names the client as its audience: it must never pass as an API credential.
  if (audience === clientId) {
    throw new Error("Environment variable OIDC_AUDIENCE must differ from OIDC_CLIENT_ID");
  }
  const accessDb = required("ACCESS_DB_URI");
  if (!/^postgres(ql)?:\/\//.test(accessDb)) {
    throw new Error("Environment variable ACCESS_DB_URI is not a postgresql:// URL");
  }
  return {
    AUTH_ENABLED: true,
    OIDC_ISSUER: issuer,
    OIDC_BACKCHANNEL_URL: backchannel === null ? null : httpUrl("OIDC_BACKCHANNEL_URL", backchannel),
    OIDC_CLIENT_ID: clientId,
    OIDC_CLIENT_SECRET: required("OIDC_CLIENT_SECRET"),
    OIDC_AUDIENCE: audience,
    AUTH_ADMIN_SUBJECT: required("AUTH_ADMIN_SUBJECT"),
    AUTH_SESSION_IDLE_SECONDS: positiveInt(env, "AUTH_SESSION_IDLE_SECONDS", 8 * 60 * 60),
    ACCESS_DB_URI: accessDb,
    WEB_CLIENT_URL: webClient === null ? null : secureUrl("WEB_CLIENT_URL", webClient),
  };
}

/** The authentication settings, or null when authentication is off. */
export function authSettings(s: Settings): AuthSettings | null {
  if (!s.AUTH_ENABLED) return null;
  return {
    issuer: s.OIDC_ISSUER!,
    backchannelUrl: s.OIDC_BACKCHANNEL_URL ?? s.OIDC_ISSUER!,
    clientId: s.OIDC_CLIENT_ID!,
    clientSecret: s.OIDC_CLIENT_SECRET!,
    audience: s.OIDC_AUDIENCE!,
    adminSubject: s.AUTH_ADMIN_SUBJECT!,
    sessionIdleSeconds: s.AUTH_SESSION_IDLE_SECONDS!,
    accessDbUri: s.ACCESS_DB_URI!,
    publicUrl: httpUrl("PUBLIC_URL", s.PUBLIC_URL!),
    webClientUrl: s.WEB_CLIENT_URL === null ? null : httpUrl("WEB_CLIENT_URL", s.WEB_CLIENT_URL),
  };
}

/** Where a provider is reached when no base URL is configured. */
const DEFAULT_BASE_URLS: Record<string, string> = {
  ollama: "http://localhost:11434",
  openai: "https://api.openai.com/v1",
  anthropic: "https://api.anthropic.com",
};

/** The providers whose base URL is a host: the server appends the API path. */
const HOST_PROVIDERS: Record<string, string> = { ollama: "Ollama", anthropic: "Anthropic API" };

/**
 * A provider's base URL, written as that provider documents it: an
 * OpenAI-compatible API base names its version (`…/v1`), an Ollama or
 * Anthropic host does not, because the server appends their own paths. Either mistake would
 * otherwise only surface as a 404 on the first model call, so it fails the
 * boot and names the corrected value.
 */
function baseUrl(env: NodeJS.ProcessEnv, name: string, provider: string | null): string {
  const value =
    optStr(env, name) ?? DEFAULT_BASE_URLS[provider ?? "ollama"] ?? DEFAULT_BASE_URLS["ollama"]!;
  if (provider === null || (provider !== "openai" && !(provider in HOST_PROVIDERS))) return value;
  let url: URL | null = null;
  try {
    url = new URL(value);
  } catch {
    // Reported below.
  }
  if (url === null || (url.protocol !== "http:" && url.protocol !== "https:")) {
    throw new Error(`Environment variable ${name} is not an http(s) URL: '${value}'`);
  }
  const versioned = url.pathname.split("/").some((segment) => /^v\d/.test(segment));
  if (provider === "openai" && !versioned) {
    throw new Error(
      `Environment variable ${name} must be the OpenAI-compatible API base including its ` +
        `version, as the provider documents it — e.g. '${value.replace(/\/+$/, "")}/v1': '${value}'`,
    );
  }
  if (provider !== "openai" && versioned) {
    throw new Error(
      `Environment variable ${name} must be the ${HOST_PROVIDERS[provider]} host without an ` +
        `API path — e.g. '${url.origin}': '${value}'`,
    );
  }
  return value;
}

/** The chat model has no default: a configured provider must name one.
 * Empty while no provider is configured, since nothing reads it then. */
function aiModel(env: NodeJS.ProcessEnv, provider: string | null): string {
  const value = optStr(env, "AI_MODEL");
  if (value === null && provider !== null) {
    throw new Error("Environment variable AI_MODEL is required when AI_PROVIDER is set");
  }
  return value ?? "";
}

export function loadSettings(env: NodeJS.ProcessEnv = process.env): Settings {
  const embeddingProvider = optStr(env, "EMBEDDING_PROVIDER");
  const aiProvider = optStr(env, "AI_PROVIDER");
  return {
    DB_BACKEND: str(env, "DB_BACKEND", "postgres"),
    DB_URI: str(env, "DB_URI", "postgresql://localhost:5432/ontoforge"),
    DB_USER: str(env, "DB_USER", "postgres"),
    DB_PASSWORD: str(env, "DB_PASSWORD", "ontoforge_dev"),
    // Connections the ontology database pool opens at most, per server.
    DB_POOL_SIZE: positiveInt(env, "DB_POOL_SIZE", 10),
    // Where the search worker's `LISTEN` connection goes; DB_URI when unset.
    // A transaction-mode pooler cannot carry LISTEN, so behind one this
    // names the database directly.
    DB_LISTEN_URI: optStr(env, "DB_LISTEN_URI"),
    PORT: int(env, "PORT", 8000),
    // How long a stopping server lets running requests and chat streams
    // finish before it cuts them.
    SHUTDOWN_DRAIN_SECONDS: positiveInt(env, "SHUTDOWN_DRAIN_SECONDS", 20),

    EMBEDDING_PROVIDER: embeddingProvider,
    EMBEDDING_MODEL: str(env, "EMBEDDING_MODEL", "bge-m3"),
    EMBEDDING_BASE_URL: baseUrl(env, "EMBEDDING_BASE_URL", embeddingProvider),
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

    // The most bytes one changeset's staged values hold (`valueBytes`).
    CHANGESET_MAX_BYTES: positiveInt(env, "CHANGESET_MAX_BYTES", 32 * 1024 * 1024),
    // The most staged objects one changeset holds.
    CHANGESET_MAX_OBJECTS: positiveInt(env, "CHANGESET_MAX_OBJECTS", 10_000),
    // The largest request body the server reads, in bytes.
    REQUEST_BODY_LIMIT: positiveInt(env, "REQUEST_BODY_LIMIT", 16 * 1024 * 1024),

    AI_PROVIDER: aiProvider,
    AI_MODEL: aiModel(env, aiProvider),
    AI_BASE_URL: baseUrl(env, "AI_BASE_URL", aiProvider),
    AI_API_KEY: optStr(env, "AI_API_KEY"),
    AI_REASONING_EFFORT: optOneOf(env, "AI_REASONING_EFFORT", AI_REASONING_EFFORTS),

    DECISION_BASE_URL: optStr(env, "DECISION_BASE_URL"),
    DECISION_MODEL: str(env, "DECISION_MODEL", "jev-1.13.0"),
    // TypeSafe's own variable name is honoured as the fallback.
    DECISION_API_KEY: optStr(env, "DECISION_API_KEY") ?? optStr(env, "TYPESAFE_API_KEY"),

    PUBLIC_URL: optStr(env, "PUBLIC_URL"),

    ...sharedState(env),
    ...auth(env),
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
