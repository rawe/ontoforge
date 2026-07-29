/**
 * Fastify application factory: routes, error handlers, CORS, OpenAPI.
 *
 * Every error response uses the one envelope
 * `{"error": {"code", "message", "details?"}}` with exactly six codes —
 * see the error model in `docs/architecture.md`. Framework-level failures
 * are mapped into the same envelope: an unparsable JSON body answers
 * `400 INVALID_JSON`, a request-shape failure `422 VALIDATION_ERROR`
 * (approved divergence #3 in `ts-migration/00-overview.md`).
 */

import cors from "@fastify/cors";
import swagger from "@fastify/swagger";
import swaggerUi from "@fastify/swagger-ui";
import Fastify, { type FastifyInstance, type FastifyReply } from "fastify";
import {
  hasZodFastifySchemaValidationErrors,
  jsonSchemaTransform,
  serializerCompiler,
  validatorCompiler,
} from "fastify-type-provider-zod";

import {
  CascadeRequiredError,
  ConflictError,
  NotFoundError,
  StoreError,
  ValidationError,
} from "./core/exceptions.js";
import { mountMcp } from "./mcp/mount.js";
import { modelingRouter } from "./modeling/router.js";
import { runtimeGlobalRouter } from "./runtime/router.js";

function sendError(
  reply: FastifyReply,
  status: number,
  code: string,
  message: string,
  details?: Record<string, unknown> | null,
): FastifyReply {
  const error: Record<string, unknown> = { code, message };
  if (details) {
    error.details = details;
  }
  return reply.status(status).send({ error });
}

export async function createApp(): Promise<FastifyInstance> {
  const app = Fastify({ logger: false });

  app.setValidatorCompiler(validatorCompiler);
  app.setSerializerCompiler(serializerCompiler);

  // CORS allow-all, matching the Python reference: origins, methods and
  // headers unrestricted, credentials allowed (the origin is reflected).
  await app.register(cors, {
    origin: true,
    credentials: true,
    methods: ["GET", "HEAD", "PUT", "PATCH", "POST", "DELETE", "OPTIONS"],
  });

  await app.register(swagger, {
    openapi: {
      info: { title: "OntoForge", version: "0.1.0" },
    },
    transform: jsonSchemaTransform,
  });
  await app.register(swaggerUi, { routePrefix: "/docs" });

  app.get("/openapi.json", { schema: { hide: true } }, async () => app.swagger());

  // An unknown route is a resource that does not exist; it answers in the
  // standard envelope like every other error (the Python server leaks the
  // framework's `{"detail": "Not Found"}` here — same family as approved
  // divergence #3, flagged in the migration notes).
  app.setNotFoundHandler((request, reply) => {
    sendError(reply, 404, "RESOURCE_NOT_FOUND", "Not Found");
  });

  app.setErrorHandler((error, request, reply) => {
    if (error instanceof NotFoundError) {
      return sendError(reply, 404, "RESOURCE_NOT_FOUND", error.message);
    }
    if (error instanceof ConflictError) {
      return sendError(reply, 409, "RESOURCE_CONFLICT", error.message);
    }
    if (error instanceof ValidationError) {
      return sendError(reply, 422, "VALIDATION_ERROR", error.message, error.details);
    }
    if (error instanceof CascadeRequiredError) {
      return sendError(reply, 409, "CASCADE_REQUIRED", error.message, {
        affectedOntologies: error.affectedOntologies,
      });
    }
    if (error instanceof StoreError) {
      // The adapter has already logged the originating failure against this
      // id; the response carries the id and nothing else about the storage.
      return sendError(reply, 500, "STORAGE_ERROR", error.message, {
        errorId: error.errorId,
      });
    }
    // An unparsable request body (framework-level JSON parse failure).
    const frameworkError = error as { code?: string; statusCode?: number };
    if (
      frameworkError.code === "FST_ERR_CTP_INVALID_JSON_BODY" ||
      frameworkError.code === "FST_ERR_CTP_EMPTY_JSON_BODY" ||
      (error instanceof SyntaxError && frameworkError.statusCode === 400)
    ) {
      return sendError(reply, 400, "INVALID_JSON", "Request body is not valid JSON");
    }
    // Framework-level request-shape failures map into the standard envelope
    // (approved divergence #3).
    if (hasZodFastifySchemaValidationErrors(error)) {
      return sendError(reply, 422, "VALIDATION_ERROR", "Request validation failed", {
        errors: error.validation.map((issue) => ({
          path: issue.instancePath,
          message: issue.message ?? "Invalid value",
        })),
      });
    }
    // Anything else is a bug. Log it server-side and answer a bare 500 with
    // no detail, matching the Python server's behaviour for unhandled errors.
    request.log?.error?.(error);
    console.error("Unhandled error:", error);
    return reply.status(500).header("content-type", "text/plain").send("Internal Server Error");
  });

  await app.register(modelingRouter, { prefix: "/api/model" });
  await app.register(runtimeGlobalRouter, { prefix: "/api/runtime" });

  // Startup step 6: the MCP servers share the process and call the same
  // services as REST. Modeling is mounted here; runtime follows in its slice.
  mountMcp(app);

  return app;
}
