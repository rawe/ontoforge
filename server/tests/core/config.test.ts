import { describe, expect, it } from "vitest";

import { authSettings, loadSettings } from "../../src/config.js";

describe("config defaults", () => {
  const settings = loadSettings({});

  it("has the documented defaults", () => {
    expect(settings.DB_BACKEND).toBe("postgres");
    expect(settings.DB_URI).toBe("postgresql://localhost:5432/ontoforge");
    expect(settings.DB_USER).toBe("postgres");
    expect(settings.DB_PASSWORD).toBe("ontoforge_dev");
    expect(settings.PORT).toBe(8000);
    expect(settings.SHUTDOWN_DRAIN_SECONDS).toBe(20);

    expect(settings.EMBEDDING_PROVIDER).toBeNull();
    expect(settings.EMBEDDING_MODEL).toBe("bge-m3");
    expect(settings.EMBEDDING_BASE_URL).toBe("http://localhost:11434");
    expect(settings.EMBEDDING_API_KEY).toBeNull();
    expect(settings.EMBEDDING_DIMENSIONS).toBe(1024);
    expect(settings.EMBEDDING_BATCH_SIZE).toBe(1);
    expect(settings.EMBEDDING_CONCURRENCY).toBe(1);

    expect(settings.DOCUMENT_CHUNK_SIZE).toBe(1500);
    expect(settings.DOCUMENT_CHUNK_OVERLAP).toBe(200);

    expect(settings.CHANGESET_MAX_BYTES).toBe(32 * 1024 * 1024);
    expect(settings.CHANGESET_MAX_OBJECTS).toBe(10_000);
    expect(settings.REQUEST_BODY_LIMIT).toBe(16 * 1024 * 1024);

    expect(settings.AI_PROVIDER).toBeNull();
    expect(settings.AI_MODEL).toBe("");
    expect(settings.AI_BASE_URL).toBe("http://localhost:11434");
    expect(settings.AI_API_KEY).toBeNull();
    expect(settings.AI_REASONING_EFFORT).toBeNull();

    expect(settings.PUBLIC_URL).toBeNull();
  });
});

describe("config env overrides", () => {
  it("takes every value from the environment", () => {
    const settings = loadSettings({
      DB_BACKEND: "other",
      DB_URI: "postgresql://db:7777/onto",
      DB_USER: "admin",
      DB_PASSWORD: "secret",
      PORT: "9001",
      SHUTDOWN_DRAIN_SECONDS: "45",
      EMBEDDING_PROVIDER: "ollama",
      EMBEDDING_MODEL: "custom-model",
      EMBEDDING_BASE_URL: "http://embed:1234",
      EMBEDDING_API_KEY: "ekey",
      EMBEDDING_DIMENSIONS: "768",
      EMBEDDING_BATCH_SIZE: "16",
      EMBEDDING_CONCURRENCY: "4",
      DOCUMENT_CHUNK_SIZE: "500",
      DOCUMENT_CHUNK_OVERLAP: "50",
      CHANGESET_MAX_BYTES: "1048576",
      CHANGESET_MAX_OBJECTS: "500",
      REQUEST_BODY_LIMIT: "2097152",
      AI_PROVIDER: "openai",
      AI_MODEL: "gpt",
      AI_BASE_URL: "http://ai:4321/v1",
      AI_API_KEY: "akey",
      AI_REASONING_EFFORT: "high",
      PUBLIC_URL: "https://onto.example.com",
    });

    expect(settings.DB_BACKEND).toBe("other");
    expect(settings.DB_URI).toBe("postgresql://db:7777/onto");
    expect(settings.DB_USER).toBe("admin");
    expect(settings.DB_PASSWORD).toBe("secret");
    expect(settings.PORT).toBe(9001);
    expect(settings.SHUTDOWN_DRAIN_SECONDS).toBe(45);
    expect(settings.EMBEDDING_PROVIDER).toBe("ollama");
    expect(settings.EMBEDDING_MODEL).toBe("custom-model");
    expect(settings.EMBEDDING_BASE_URL).toBe("http://embed:1234");
    expect(settings.EMBEDDING_API_KEY).toBe("ekey");
    expect(settings.EMBEDDING_DIMENSIONS).toBe(768);
    expect(settings.EMBEDDING_BATCH_SIZE).toBe(16);
    expect(settings.EMBEDDING_CONCURRENCY).toBe(4);
    expect(settings.DOCUMENT_CHUNK_SIZE).toBe(500);
    expect(settings.DOCUMENT_CHUNK_OVERLAP).toBe(50);
    expect(settings.CHANGESET_MAX_BYTES).toBe(1048576);
    expect(settings.CHANGESET_MAX_OBJECTS).toBe(500);
    expect(settings.REQUEST_BODY_LIMIT).toBe(2097152);
    expect(settings.AI_PROVIDER).toBe("openai");
    expect(settings.AI_MODEL).toBe("gpt");
    expect(settings.AI_BASE_URL).toBe("http://ai:4321/v1");
    expect(settings.AI_API_KEY).toBe("akey");
    expect(settings.AI_REASONING_EFFORT).toBe("high");
    expect(settings.PUBLIC_URL).toBe("https://onto.example.com");
  });

  it("rejects a non-integer value for an integer variable", () => {
    expect(() => loadSettings({ PORT: "eight thousand" })).toThrow(/PORT/);
    expect(() => loadSettings({ EMBEDDING_DIMENSIONS: "wide" })).toThrow(
      /EMBEDDING_DIMENSIONS/,
    );
    expect(() => loadSettings({ EMBEDDING_BATCH_SIZE: "many" })).toThrow(
      /EMBEDDING_BATCH_SIZE/,
    );
  });

  it("rejects zero or a negative value for a positive integer variable", () => {
    for (const name of [
      "EMBEDDING_DIMENSIONS",
      "EMBEDDING_BATCH_SIZE",
      "EMBEDDING_CONCURRENCY",
      "CHANGESET_MAX_BYTES",
      "CHANGESET_MAX_OBJECTS",
      "REQUEST_BODY_LIMIT",
      "SHUTDOWN_DRAIN_SECONDS",
    ]) {
      expect(() => loadSettings({ [name]: "0" })).toThrow(
        new RegExp(`${name} must be a positive integer`),
      );
      expect(() => loadSettings({ [name]: "-2" })).toThrow(new RegExp(name));
    }
  });

  it("sizes the pool from DB_POOL_SIZE and listens on DB_URI unless DB_LISTEN_URI is set", () => {
    expect(loadSettings({}).DB_POOL_SIZE).toBe(10);
    expect(loadSettings({ DB_POOL_SIZE: "25" }).DB_POOL_SIZE).toBe(25);
    expect(() => loadSettings({ DB_POOL_SIZE: "0" })).toThrow(/DB_POOL_SIZE/);
    expect(loadSettings({}).DB_LISTEN_URI).toBeNull();
    expect(loadSettings({ DB_LISTEN_URI: "postgresql://db:5432/ontoforge" }).DB_LISTEN_URI).toBe(
      "postgresql://db:5432/ontoforge",
    );
  });

  it("accepts every reasoning effort level and rejects anything else", () => {
    for (const level of ["none", "low", "medium", "high"]) {
      expect(loadSettings({ AI_REASONING_EFFORT: level }).AI_REASONING_EFFORT).toBe(
        level,
      );
    }
    // A typo must fail the boot, not every inference: the provider answers
    // 400 for an unknown level.
    expect(() => loadSettings({ AI_REASONING_EFFORT: "hight" })).toThrow(
      /AI_REASONING_EFFORT/,
    );
    expect(() => loadSettings({ AI_REASONING_EFFORT: "minimal" })).toThrow(
      /AI_REASONING_EFFORT/,
    );
  });
});


describe("provider base URLs", () => {
  it("default to the provider's own endpoint", () => {
    expect(loadSettings({ AI_PROVIDER: "ollama", AI_MODEL: "m" }).AI_BASE_URL).toBe("http://localhost:11434");
    expect(loadSettings({ AI_PROVIDER: "openai", AI_MODEL: "gpt" }).AI_BASE_URL).toBe(
      "https://api.openai.com/v1",
    );
    expect(loadSettings({ EMBEDDING_PROVIDER: "openai" }).EMBEDDING_BASE_URL).toBe(
      "https://api.openai.com/v1",
    );
    expect(loadSettings({ AI_PROVIDER: "anthropic", AI_MODEL: "m" }).AI_BASE_URL).toBe(
      "https://api.anthropic.com",
    );
  });

  it("take an OpenAI-compatible base as the provider documents it, version included", () => {
    for (const url of [
      "https://openrouter.ai/api/v1",
      "https://oai.endpoints.kepler.ai.cloud.ovh.net/v1/",
      "https://generativelanguage.googleapis.com/v1beta/openai",
    ]) {
      expect(loadSettings({ AI_PROVIDER: "openai", AI_MODEL: "m", AI_BASE_URL: url }).AI_BASE_URL).toBe(url);
      expect(loadSettings({ EMBEDDING_PROVIDER: "openai", EMBEDDING_BASE_URL: url }).EMBEDDING_BASE_URL).toBe(url);
    }
  });

  it("reject an OpenAI-compatible base without its version, naming the corrected value", () => {
    expect(() =>
      loadSettings({ AI_PROVIDER: "openai", AI_MODEL: "m", AI_BASE_URL: "https://openrouter.ai/api" }),
    ).toThrow(/AI_BASE_URL .*'https:\/\/openrouter\.ai\/api\/v1'/);
    expect(() =>
      loadSettings({ EMBEDDING_PROVIDER: "openai", EMBEDDING_BASE_URL: "https://oai.endpoints.kepler.ai.cloud.ovh.net/" }),
    ).toThrow(/EMBEDDING_BASE_URL .*'https:\/\/oai\.endpoints\.kepler\.ai\.cloud\.ovh\.net\/v1'/);
  });

  it("reject an Ollama host given with an API path", () => {
    expect(() => loadSettings({ AI_PROVIDER: "ollama", AI_MODEL: "m", AI_BASE_URL: "http://localhost:11434/v1" })).toThrow(
      /AI_BASE_URL .*'http:\/\/localhost:11434'/,
    );
    expect(() =>
      loadSettings({ EMBEDDING_PROVIDER: "ollama", EMBEDDING_BASE_URL: "http://localhost:11434/v1/" }),
    ).toThrow(/EMBEDDING_BASE_URL/);
  });

  it("reject an Anthropic host given with an API path", () => {
    expect(() =>
      loadSettings({ AI_PROVIDER: "anthropic", AI_MODEL: "m", AI_BASE_URL: "https://api.anthropic.com/v1/" }),
    ).toThrow(/AI_BASE_URL must be the Anthropic API host .*'https:\/\/api\.anthropic\.com'/);
  });

  it("reject a value that is not an http(s) URL", () => {
    expect(() => loadSettings({ AI_PROVIDER: "ollama", AI_MODEL: "m", AI_BASE_URL: "localhost:11434" })).toThrow(
      /AI_BASE_URL is not an http\(s\) URL/,
    );
    expect(() => loadSettings({ EMBEDDING_PROVIDER: "openai", EMBEDDING_BASE_URL: "not a url" })).toThrow(
      /EMBEDDING_BASE_URL is not an http\(s\) URL/,
    );
  });

  it("are not checked while their provider is unset", () => {
    expect(loadSettings({ AI_BASE_URL: "https://openrouter.ai/api" }).AI_BASE_URL).toBe("https://openrouter.ai/api");
  });
});

describe("AI model", () => {
  it("has no default: every configured provider must name its model", () => {
    for (const provider of ["ollama", "openai", "anthropic"]) {
      expect(() => loadSettings({ AI_PROVIDER: provider })).toThrow(
        /AI_MODEL is required when AI_PROVIDER is set/,
      );
    }
  });
});

describe("decision provider configuration", () => {
  it("is optional and has a default model identifier", () => {
    const settings = loadSettings({});
    expect(settings.DECISION_BASE_URL).toBeNull();
    expect(settings.DECISION_MODEL).toBe("jev-1.13.0");
    expect(settings.DECISION_API_KEY).toBeNull();
  });

  it("supports local configuration without a credential", () => {
    const settings = loadSettings({
      DECISION_BASE_URL: "http://localhost:8002",
      DECISION_MODEL: "Mapika/decider-0.8b",
    });
    expect(settings.DECISION_BASE_URL).toBe("http://localhost:8002");
    expect(settings.DECISION_MODEL).toBe("Mapika/decider-0.8b");
    expect(settings.DECISION_API_KEY).toBeNull();
  });

  it("prefers the explicit credential and otherwise honours the provider alias", () => {
    expect(loadSettings({ TYPESAFE_API_KEY: "provider-key" }).DECISION_API_KEY).toBe("provider-key");
    expect(loadSettings({ DECISION_API_KEY: "explicit-key", TYPESAFE_API_KEY: "provider-key" })
      .DECISION_API_KEY).toBe("explicit-key");
    expect(loadSettings({ DECISION_API_KEY: "", TYPESAFE_API_KEY: "provider-key" })
      .DECISION_API_KEY).toBe("provider-key");
  });
});

describe("shared state configuration", () => {
  it("keeps shared state in memory by default", () => {
    const settings = loadSettings({});
    expect(settings.SHARED_STATE).toBe("memory");
    expect(settings.VALKEY_URL).toBeNull();
  });

  it("takes a Valkey with its URL", () => {
    const settings = loadSettings({ SHARED_STATE: "valkey", VALKEY_URL: "redis://valkey:6379" });
    expect(settings.SHARED_STATE).toBe("valkey");
    expect(settings.VALKEY_URL).toBe("redis://valkey:6379");
    expect(loadSettings({ SHARED_STATE: "valkey", VALKEY_URL: "rediss://u:p@valkey:6380/0" }).VALKEY_URL)
      .toBe("rediss://u:p@valkey:6380/0");
  });

  it("fails the boot for an unknown store, a missing or malformed URL, and a URL without the switch", () => {
    expect(() => loadSettings({ SHARED_STATE: "redis" })).toThrow(/SHARED_STATE/);
    expect(() => loadSettings({ SHARED_STATE: "valkey" })).toThrow(/VALKEY_URL is required/);
    expect(() => loadSettings({ SHARED_STATE: "valkey", VALKEY_URL: "http://valkey:6379" })).toThrow(/VALKEY_URL/);
    expect(() => loadSettings({ VALKEY_URL: "redis://valkey:6379" })).toThrow(/SHARED_STATE is not 'valkey'/);
    expect(() => loadSettings({ SHARED_STATE: "memory", VALKEY_URL: "redis://valkey:6379" })).toThrow(/VALKEY_URL/);
  });
});

describe("authentication settings", () => {
  const enabled = {
    AUTH_ENABLED: "true",
    PUBLIC_URL: "http://localhost:5173/",
    OIDC_ISSUER: "http://localhost:8180/realms/ontoforge",
    OIDC_CLIENT_ID: "ontoforge-web",
    OIDC_CLIENT_SECRET: "s3cret",
    OIDC_AUDIENCE: "ontoforge-api",
    AUTH_ADMIN_SUBJECT: "4f1c",
    ACCESS_DB_URI: "postgresql://localhost:5432/ontoforge_access",
  };

  it("is off by default and then reads none of its variables", () => {
    const settings = loadSettings({ OIDC_ISSUER: "not a url", AUTH_SESSION_IDLE_SECONDS: "never" });
    expect(settings.AUTH_ENABLED).toBe(false);
    expect(settings.OIDC_ISSUER).toBeNull();
    expect(settings.AUTH_SESSION_IDLE_SECONDS).toBeNull();
    expect(authSettings(settings)).toBeNull();
  });

  it("accepts only true or false", () => {
    expect(() => loadSettings({ AUTH_ENABLED: "yes" })).toThrow(/AUTH_ENABLED/);
    expect(loadSettings({ AUTH_ENABLED: "false" }).AUTH_ENABLED).toBe(false);
  });

  it("reads every variable when on", () => {
    const auth = authSettings(loadSettings(enabled))!;
    expect(auth).toEqual({
      issuer: "http://localhost:8180/realms/ontoforge",
      backchannelUrl: "http://localhost:8180/realms/ontoforge",
      clientId: "ontoforge-web",
      clientSecret: "s3cret",
      audience: "ontoforge-api",
      adminSubject: "4f1c",
      sessionIdleSeconds: 28800,
      accessDbUri: "postgresql://localhost:5432/ontoforge_access",
      publicUrl: "http://localhost:5173",
    });
    expect(
      authSettings(
        loadSettings({ ...enabled, OIDC_BACKCHANNEL_URL: "http://host.docker.internal:8180/realms/ontoforge/", AUTH_SESSION_IDLE_SECONDS: "60" }),
      ),
    ).toMatchObject({ backchannelUrl: "http://host.docker.internal:8180/realms/ontoforge", sessionIdleSeconds: 60 });
  });

  it("fails the boot naming each missing variable when on", () => {
    for (const name of Object.keys(enabled).filter((n) => n !== "AUTH_ENABLED")) {
      const env: Record<string, string> = { ...enabled };
      delete env[name];
      expect(() => loadSettings(env), name).toThrow(new RegExp(name));
    }
  });

  it("refuses malformed URLs", () => {
    expect(() => loadSettings({ ...enabled, OIDC_ISSUER: "localhost:8180" })).toThrow(/OIDC_ISSUER/);
    expect(() => loadSettings({ ...enabled, PUBLIC_URL: "ftp://x" })).toThrow(/PUBLIC_URL/);
    expect(() => loadSettings({ ...enabled, ACCESS_DB_URI: "mysql://x/y" })).toThrow(/ACCESS_DB_URI/);
    expect(() => loadSettings({ ...enabled, OIDC_BACKCHANNEL_URL: "nope" })).toThrow(/OIDC_BACKCHANNEL_URL/);
    expect(() => loadSettings({ ...enabled, AUTH_SESSION_IDLE_SECONDS: "0" })).toThrow(/AUTH_SESSION_IDLE_SECONDS/);
  });

  it("refuses an API audience an ID token would carry: the client id", () => {
    expect(() => loadSettings({ ...enabled, OIDC_AUDIENCE: "ontoforge-web" })).toThrow(/OIDC_AUDIENCE must differ from OIDC_CLIENT_ID/);
  });

  it("allows an http issuer on a loopback host only; the back channel anywhere", () => {
    expect(loadSettings({ ...enabled, OIDC_ISSUER: "https://login.example.com/realms/x" }).OIDC_ISSUER).toBe(
      "https://login.example.com/realms/x",
    );
    expect(() => loadSettings({ ...enabled, OIDC_ISSUER: "http://keycloak.example.com/realms/x" })).toThrow(
      /OIDC_ISSUER must be an https URL/,
    );
    expect(loadSettings({ ...enabled, OIDC_BACKCHANNEL_URL: "http://keycloak:8080/realms/ontoforge" }).OIDC_BACKCHANNEL_URL).toBe(
      "http://keycloak:8080/realms/ontoforge",
    );
  });

  it("allows an http PUBLIC_URL on a loopback host only", () => {
    for (const url of ["http://localhost:5173", "http://127.0.0.1:8000", "http://[::1]:5173", "http://app.localhost", "https://ontoforge.example.com"]) {
      expect(loadSettings({ ...enabled, PUBLIC_URL: url }).PUBLIC_URL, url).toBe(url);
    }
    for (const url of ["http://ontoforge.example.com", "http://192.168.1.5:5173", "http://localhost.example.com"]) {
      expect(() => loadSettings({ ...enabled, PUBLIC_URL: url }), url).toThrow(/PUBLIC_URL must be an https URL/);
    }
    expect(loadSettings({ PUBLIC_URL: "http://ontoforge.example.com" }).PUBLIC_URL).toBe("http://ontoforge.example.com");
  });
});
