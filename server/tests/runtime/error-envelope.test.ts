/**
 * Every error answers in the one envelope `{"error": {code, message,
 * details?}}` with its exact status and code — including framework-level
 * failures (approved divergence #3: request-shape errors use the envelope,
 * unlike the Python server's FastAPI leak).
 */

import type { FastifyInstance } from "fastify";
import { z } from "zod";
import { afterAll, beforeAll, describe, expect, it } from "vitest";

import { createApp } from "../../src/app.js";
import {
  CascadeRequiredError,
  ConflictError,
  NotFoundError,
  StoreError,
  ValidationError,
} from "../../src/core/exceptions.js";

let app: FastifyInstance;

beforeAll(async () => {
  app = await createApp();

  // Stub routes that throw each domain exception.
  app.get("/boom/not-found", () => {
    throw new NotFoundError("Entity not found");
  });
  app.get("/boom/conflict", () => {
    throw new ConflictError("Key already exists");
  });
  app.get("/boom/validation", () => {
    throw new ValidationError("Invalid input", { fields: { name: "required" } });
  });
  app.get("/boom/validation-bare", () => {
    throw new ValidationError("Invalid input");
  });
  app.get("/boom/cascade", () => {
    throw new CascadeRequiredError("Change breaks ontologies", ["lens_a", "lens_b"]);
  });
  app.get("/boom/store", () => {
    throw new StoreError();
  });
  // A route with a body schema, to drive framework-level shape failures.
  app.post(
    "/boom/shape",
    { schema: { body: z.object({ name: z.string() }) } },
    async () => ({ ok: true }),
  );

  await app.ready();
});

afterAll(async () => {
  await app.close();
});

describe("domain exceptions map to their exact status and envelope", () => {
  it("NotFoundError -> 404 RESOURCE_NOT_FOUND", async () => {
    const res = await app.inject({ method: "GET", url: "/boom/not-found" });
    expect(res.statusCode).toBe(404);
    expect(res.json()).toEqual({
      error: { code: "RESOURCE_NOT_FOUND", message: "Entity not found" },
    });
  });

  it("ConflictError -> 409 RESOURCE_CONFLICT", async () => {
    const res = await app.inject({ method: "GET", url: "/boom/conflict" });
    expect(res.statusCode).toBe(409);
    expect(res.json()).toEqual({
      error: { code: "RESOURCE_CONFLICT", message: "Key already exists" },
    });
  });

  it("ValidationError -> 422 VALIDATION_ERROR with details", async () => {
    const res = await app.inject({ method: "GET", url: "/boom/validation" });
    expect(res.statusCode).toBe(422);
    expect(res.json()).toEqual({
      error: {
        code: "VALIDATION_ERROR",
        message: "Invalid input",
        details: { fields: { name: "required" } },
      },
    });
  });

  it("ValidationError without details omits the details key", async () => {
    const res = await app.inject({ method: "GET", url: "/boom/validation-bare" });
    expect(res.statusCode).toBe(422);
    expect(res.json()).toEqual({
      error: { code: "VALIDATION_ERROR", message: "Invalid input" },
    });
  });

  it("CascadeRequiredError -> 409 CASCADE_REQUIRED with affectedOntologies", async () => {
    const res = await app.inject({ method: "GET", url: "/boom/cascade" });
    expect(res.statusCode).toBe(409);
    expect(res.json()).toEqual({
      error: {
        code: "CASCADE_REQUIRED",
        message: "Change breaks ontologies",
        details: { affectedOntologies: ["lens_a", "lens_b"] },
      },
    });
  });

  it("StoreError -> 500 STORAGE_ERROR with an 8-hex errorId and no storage detail", async () => {
    const res = await app.inject({ method: "GET", url: "/boom/store" });
    expect(res.statusCode).toBe(500);
    const body = res.json();
    expect(body.error.code).toBe("STORAGE_ERROR");
    expect(body.error.message).toBe("A storage operation failed");
    expect(body.error.details.errorId).toMatch(/^[0-9a-f]{8}$/);
    expect(res.body).not.toContain("Internal Server Error");
  });
});

describe("framework-level failures answer in the envelope", () => {
  it("an unparsable JSON body -> 400 INVALID_JSON", async () => {
    const res = await app.inject({
      method: "POST",
      url: "/boom/shape",
      headers: { "content-type": "application/json" },
      body: "{not json",
    });
    expect(res.statusCode).toBe(400);
    expect(res.json()).toEqual({
      error: { code: "INVALID_JSON", message: "Request body is not valid JSON" },
    });
  });

  it("an empty JSON body -> 400 INVALID_JSON (parity with the Python handler)", async () => {
    const res = await app.inject({
      method: "POST",
      url: "/boom/shape",
      headers: { "content-type": "application/json" },
      body: "",
    });
    expect(res.statusCode).toBe(400);
    expect(res.json()).toEqual({
      error: { code: "INVALID_JSON", message: "Request body is not valid JSON" },
    });
  });

  it("a request-shape failure -> 422 VALIDATION_ERROR in the envelope (divergence #3)", async () => {
    const res = await app.inject({
      method: "POST",
      url: "/boom/shape",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ name: 123 }),
    });
    expect(res.statusCode).toBe(422);
    const body = res.json();
    expect(body.error.code).toBe("VALIDATION_ERROR");
    expect(Array.isArray(body.error.details.errors)).toBe(true);
    expect(body.error.details.errors.length).toBeGreaterThan(0);
    // No FastAPI-style top-level "detail" leak.
    expect(body.detail).toBeUndefined();
  });

  it("an unknown route -> 404 RESOURCE_NOT_FOUND in the envelope", async () => {
    const res = await app.inject({ method: "GET", url: "/no/such/route" });
    expect(res.statusCode).toBe(404);
    expect(res.json()).toEqual({
      error: { code: "RESOURCE_NOT_FOUND", message: "Not Found" },
    });
  });
});

describe("features route", () => {
  it("reports both capabilities false with the exact field names", async () => {
    const res = await app.inject({ method: "GET", url: "/api/runtime/features" });
    expect(res.statusCode).toBe(200);
    expect(res.json()).toEqual({ semanticSearch: false, ai: false });
  });
});

describe("OpenAPI surface", () => {
  it("serves /openapi.json with the features path", async () => {
    const res = await app.inject({ method: "GET", url: "/openapi.json" });
    expect(res.statusCode).toBe(200);
    const spec = res.json();
    expect(spec.info.title).toBe("OntoForge");
    expect(spec.paths["/api/runtime/features"]).toBeDefined();
  });

  it("serves the swagger UI at /docs", async () => {
    const res = await app.inject({ method: "GET", url: "/docs" });
    expect([200, 302]).toContain(res.statusCode);
  });
});
