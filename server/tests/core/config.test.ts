import { describe, expect, it } from "vitest";

import { loadSettings } from "../../src/config.js";

describe("config defaults", () => {
  const settings = loadSettings({});

  it("matches the Python reference defaults exactly", () => {
    expect(settings.DB_BACKEND).toBe("neo4j");
    expect(settings.DB_URI).toBe("bolt://localhost:7687");
    expect(settings.DB_USER).toBe("neo4j");
    expect(settings.DB_PASSWORD).toBe("ontoforge_dev");
    expect(settings.PORT).toBe(8000);

    expect(settings.EMBEDDING_PROVIDER).toBeNull();
    expect(settings.EMBEDDING_MODEL).toBe("nomic-embed-text");
    expect(settings.EMBEDDING_BASE_URL).toBe("http://localhost:11434");
    expect(settings.EMBEDDING_API_KEY).toBeNull();
    expect(settings.EMBEDDING_DIMENSIONS).toBeNull();

    expect(settings.DOCUMENT_CHUNK_SIZE).toBe(1500);
    expect(settings.DOCUMENT_CHUNK_OVERLAP).toBe(200);

    expect(settings.AI_PROVIDER).toBeNull();
    expect(settings.AI_MODEL).toBe("qwen3:8b");
    expect(settings.AI_BASE_URL).toBe("http://localhost:11434");
    expect(settings.AI_API_KEY).toBeNull();

    expect(settings.PUBLIC_URL).toBeNull();
    expect(settings.DEFAULT_MCP_ONTOLOGY_KEY).toBeNull();
  });
});

describe("config env overrides", () => {
  it("takes every value from the environment", () => {
    const settings = loadSettings({
      DB_BACKEND: "other",
      DB_URI: "bolt://db:7777",
      DB_USER: "admin",
      DB_PASSWORD: "secret",
      PORT: "9001",
      EMBEDDING_PROVIDER: "ollama",
      EMBEDDING_MODEL: "custom-model",
      EMBEDDING_BASE_URL: "http://embed:1234",
      EMBEDDING_API_KEY: "ekey",
      EMBEDDING_DIMENSIONS: "768",
      DOCUMENT_CHUNK_SIZE: "500",
      DOCUMENT_CHUNK_OVERLAP: "50",
      AI_PROVIDER: "openai",
      AI_MODEL: "gpt",
      AI_BASE_URL: "http://ai:4321",
      AI_API_KEY: "akey",
      PUBLIC_URL: "https://onto.example.com",
      DEFAULT_MCP_ONTOLOGY_KEY: "my_ontology",
    });

    expect(settings.DB_BACKEND).toBe("other");
    expect(settings.DB_URI).toBe("bolt://db:7777");
    expect(settings.DB_USER).toBe("admin");
    expect(settings.DB_PASSWORD).toBe("secret");
    expect(settings.PORT).toBe(9001);
    expect(settings.EMBEDDING_PROVIDER).toBe("ollama");
    expect(settings.EMBEDDING_MODEL).toBe("custom-model");
    expect(settings.EMBEDDING_BASE_URL).toBe("http://embed:1234");
    expect(settings.EMBEDDING_API_KEY).toBe("ekey");
    expect(settings.EMBEDDING_DIMENSIONS).toBe(768);
    expect(settings.DOCUMENT_CHUNK_SIZE).toBe(500);
    expect(settings.DOCUMENT_CHUNK_OVERLAP).toBe(50);
    expect(settings.AI_PROVIDER).toBe("openai");
    expect(settings.AI_MODEL).toBe("gpt");
    expect(settings.AI_BASE_URL).toBe("http://ai:4321");
    expect(settings.AI_API_KEY).toBe("akey");
    expect(settings.PUBLIC_URL).toBe("https://onto.example.com");
    expect(settings.DEFAULT_MCP_ONTOLOGY_KEY).toBe("my_ontology");
  });

  it("rejects a non-integer value for an integer variable", () => {
    expect(() => loadSettings({ PORT: "eight thousand" })).toThrow(/PORT/);
    expect(() => loadSettings({ EMBEDDING_DIMENSIONS: "wide" })).toThrow(
      /EMBEDDING_DIMENSIONS/,
    );
  });
});
