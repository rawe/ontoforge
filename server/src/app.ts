/**
 * Fastify application factory: routes, error handlers, CORS, OpenAPI.
 *
 * Every error response uses the one envelope
 * `{"error": {"code", "message", "details?"}}` with exactly nine codes —
 * see the error model in `docs/architecture.md`. Framework-level failures
 * are mapped into the same envelope: an unparsable JSON body answers
 * `400 INVALID_JSON`, a request-shape failure `422 VALIDATION_ERROR`.
 *
 * The probes `/livez` and `/readyz`, and `/metrics`, sit outside `/api` and
 * outside that envelope; shutdown drains through the app's `lifecycle`.
 */

import type { ServerResponse } from "node:http";

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

import { accessRouter } from "./access/router.js";
import { challenge, classifyRoutes, guardRoutes } from "./auth/plugin.js";
import { authRouter, resourceMetadataRouter } from "./auth/router.js";
import type { AuthRuntime } from "./auth/runtime.js";
import {
  CascadeRequiredError,
  ConflictError,
  ForbiddenError,
  NotFoundError,
  ProviderUnavailableError,
  StoreError,
  UnauthenticatedError,
  ValidationError,
} from "./core/exceptions.js";
import { mountMcp } from "./mcp/mount.js";
import { serveMetrics } from "./metrics.js";
import { modelingRouter } from "./modeling/router.js";
import { registryRouter } from "./registry/router.js";
import { aiRouter } from "./runtime/aiRouter.js";
import { changesetRouter } from "./runtime/changesetRouter.js";
import { decisionRouter } from "./runtime/decisionRouter.js";
import { MAX_IDENTITY_LENGTH } from "./runtime/identity.js";
import { runtimeRouter } from "./runtime/router.js";
import { rulesetRouter, rulesetRuntimeRouter } from "./runtime/rulesetRouter.js";
import { serverRouter } from "./server/router.js";
import { openSharedState, type SharedState } from "./sharedState.js";

declare module "fastify" {
  interface FastifyInstance {
    lifecycle: Lifecycle;
  }
}

/**
 * What shutdown drains (`main.ts`): the readiness the probes report and the
 * work still running. Work is every request until its response closes, and
 * every route handler until its promise settles — a chat stream's handler
 * settles only once its turn is published or released, so no work running
 * also means no turn held.
 */
export class Lifecycle {
  private isDraining = false;
  private running = 0;
  private readonly waiters = new Set<() => void>();
  /** Responses whose headers may still be written. */
  private readonly open = new Set<ServerResponse>();

  get draining(): boolean {
    return this.isDraining;
  }

  /** Shutdown starts: `/readyz` answers 503, and every response not yet
   * started — running or new — closes its connection. */
  drain(): void {
    this.isDraining = true;
    for (const response of this.open) this.closeAfter(response);
  }

  /** Count a raw request until its response closes. Raw, so hijacked chat
   * streams and MCP count as well. */
  track(response: ServerResponse): void {
    const end = this.begin();
    this.open.add(response);
    if (this.isDraining) this.closeAfter(response);
    response.once("close", () => {
      this.open.delete(response);
      end();
    });
  }

  private closeAfter(response: ServerResponse): void {
    if (!response.headersSent) response.setHeader("connection", "close");
  }

  /** Count one piece of work; the returned function ends it, once. */
  begin(): () => void {
    this.running += 1;
    let ended = false;
    return () => {
      if (ended) return;
      ended = true;
      this.running -= 1;
      if (this.running === 0) {
        for (const waiter of this.waiters) waiter();
        this.waiters.clear();
      }
    };
  }

  /** True once no work runs, false if some still does after `ms`. */
  settled(ms: number): Promise<boolean> {
    if (this.running === 0) return Promise.resolve(true);
    return new Promise((resolve) => {
      const done = (): void => {
        clearTimeout(timer);
        resolve(true);
      };
      const timer = setTimeout(() => {
        this.waiters.delete(done);
        resolve(false);
      }, ms);
      this.waiters.add(done);
    });
  }
}

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

/** The app over `shared`, which it closes when it closes. The server
 * passes the configured shared state; tests that pass none get it in memory.
 * `auth`, when authentication is on, is closed with the app as well; without
 * it the app runs without authentication. */
export async function createApp(shared?: SharedState, auth: AuthRuntime | null = null): Promise<FastifyInstance> {
  const state = shared ?? (await openSharedState({ kind: "memory" }));
  // An identity is one path segment (`/entities/{type}/identity/{identity}`):
  // its longest form, every code point four UTF-8 bytes percent-encoded,
  // must route rather than hit the not-found handler.
  // Closing ends every open connection, streams included: shutdown has
  // drained them by then (`main.ts`). Fastify 5.12 does this only when the
  // option is exactly `true`.
  const app = Fastify({
    logger: false,
    forceCloseConnections: true,
    routerOptions: { maxParamLength: MAX_IDENTITY_LENGTH * 12 },
  });
  app.addHook("onClose", () => state.close());
  app.decorate("auth", auth);
  if (auth !== null) {
    app.addHook("onClose", () => auth.access.close());
    // Before any route: every route registered from here on declares its need.
    classifyRoutes(app);
  }

  const lifecycle = new Lifecycle();
  app.decorate("lifecycle", lifecycle);
  app.server.on("request", (_request, response) => lifecycle.track(response));
  // Before any route, so every route's requests are counted.
  serveMetrics(app);
  // Every route registered from here on: its handler counts until it settles.
  app.addHook("onRoute", (route) => {
    const handler = route.handler;
    route.handler = function (this: FastifyInstance, request, reply) {
      const result = handler.call(this, request, reply);
      if (result instanceof Promise) {
        const end = lifecycle.begin();
        result.then(end, end);
      }
      return result;
    };
  });

  app.setValidatorCompiler(validatorCompiler);
  app.setSerializerCompiler(serializerCompiler);

  // A client sending `content-type: application/json` with an empty body to
  // a route that declares no body (a validate POST, any DELETE) must
  // succeed. Fastify's default parser would reject that before the route's
  // declaration is consulted. Routes that DO declare a body keep the
  // contract: an empty body answers 400 INVALID_JSON.
  app.addContentTypeParser(
    "application/json",
    { parseAs: "string" },
    (request, body, done) => {
      const text = body as string;
      if (text.trim() === "") {
        if (request.routeOptions?.schema?.body) {
          const error = new Error(
            "Body cannot be empty when content-type is set to 'application/json'",
          ) as Error & { code: string; statusCode: number };
          error.code = "FST_ERR_CTP_EMPTY_JSON_BODY";
          error.statusCode = 400;
          done(error, undefined);
        } else {
          done(null, undefined);
        }
        return;
      }
      try {
        done(null, JSON.parse(text));
      } catch (err) {
        const error = err as Error & { statusCode?: number };
        error.statusCode = 400;
        done(error, undefined);
      }
    },
  );

  // CORS allow-all: origins, methods and headers unrestricted, credentials
  // allowed (the origin is reflected). With authentication on, no credentials:
  // the session cookie serves this deployment's own origin only, and a
  // bearer caller needs none.
  await app.register(cors, {
    origin: true,
    credentials: auth === null,
    methods: ["GET", "HEAD", "PUT", "PATCH", "POST", "DELETE", "OPTIONS"],
    ...(auth !== null ? { exposedHeaders: ["WWW-Authenticate"] } : {}),
  });
  // After CORS, so a refusal still carries its CORS headers.
  if (auth !== null) guardRoutes(app);

  await app.register(swagger, {
    openapi: {
      info: { title: "OntoForge", version: "0.1.0" },
    },
    transform: jsonSchemaTransform,
  });
  await app.register(swaggerUi, { routePrefix: "/docs" });

  app.get("/openapi.json", { schema: { hide: true } }, async () => app.swagger());

  // Probes: live while the event loop answers; ready until shutdown starts
  // draining. Booting needs no answer of its own: the port opens only once
  // boot is done. No dependency is checked — a shared one failing would take
  // every server out of service at once.
  app.get("/livez", { schema: { hide: true } }, async () => ({ live: true }));
  app.get("/readyz", { schema: { hide: true } }, async (_request, reply) =>
    lifecycle.draining ? reply.status(503).send({ ready: false }) : { ready: true },
  );

  // An unknown route is a resource that does not exist; it answers in the
  // standard envelope like every other error, rather than leaking the
  // framework's own not-found shape.
  app.setNotFoundHandler((request, reply) => {
    sendError(reply, 404, "RESOURCE_NOT_FOUND", "Not Found");
  });

  app.setErrorHandler((error, request, reply) => {
    if (error instanceof UnauthenticatedError) {
      reply.header("www-authenticate", challenge(request, error));
      return sendError(reply, 401, "UNAUTHENTICATED", error.message);
    }
    if (error instanceof ForbiddenError) {
      return sendError(reply, 403, "FORBIDDEN", error.message);
    }
    if (error instanceof ProviderUnavailableError) {
      return sendError(reply, 503, "PROVIDER_UNAVAILABLE", error.message);
    }
    if (error instanceof NotFoundError) {
      return sendError(reply, 404, "RESOURCE_NOT_FOUND", error.message, error.details);
    }
    if (error instanceof ConflictError) {
      return sendError(reply, 409, "RESOURCE_CONFLICT", error.message, error.details);
    }
    if (error instanceof ValidationError) {
      return sendError(reply, 422, "VALIDATION_ERROR", error.message, error.details);
    }
    if (error instanceof CascadeRequiredError) {
      return sendError(reply, 409, "CASCADE_REQUIRED", error.message, {
        affectedLenses: error.affectedLenses,
        affectedIndices: error.affectedIndices,
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
    // Framework-level request-shape failures map into the standard envelope.
    if (hasZodFastifySchemaValidationErrors(error)) {
      return sendError(reply, 422, "VALIDATION_ERROR", "Request validation failed", {
        errors: error.validation.map((issue) => ({
          path: issue.instancePath,
          message: issue.message ?? "Invalid value",
        })),
      });
    }
    // Anything else is a bug. Log it server-side and answer a bare 500 with
    // no detail — an unhandled error never describes itself to a client.
    request.log?.error?.(error);
    console.error("Unhandled error:", error);
    return reply.status(500).header("content-type", "text/plain").send("Internal Server Error");
  });

  await app.register(registryRouter, { prefix: "/api" });
  // The phase-neutral server surface: capability reads only.
  await app.register(serverRouter, { prefix: "/api/server" });
  // Sign-in; with authentication off only `me`, which says so.
  await app.register(authRouter, { prefix: "/api/auth" });
  if (auth !== null) {
    // User management exists only with authentication on.
    await app.register(accessRouter, { prefix: "/api" });
    await app.register(resourceMetadataRouter);
  }
  // The modeling and runtime surfaces are ontology-scoped: every request
  // names its ontology in the path and runs against a store bound to it;
  // runtime requests additionally name the lens they read through.
  await app.register(modelingRouter, { prefix: "/api/ontologies/:ontologyKey/model" });
  const runtimePrefix = "/api/ontologies/:ontologyKey/runtime/lenses/:lensKey";
  await app.register(runtimeRouter, { prefix: runtimePrefix });
  await app.register(changesetRouter, { prefix: `${runtimePrefix}/changesets` });
  // One thread store per server: every assistant conversation lives in it.
  await app.register(aiRouter, { prefix: runtimePrefix, threads: state.threads });
  await app.register(decisionRouter, { prefix: runtimePrefix });
  // Ruleset maintenance names no lens: the first lensless runtime routes.
  await app.register(rulesetRouter, { prefix: "/api/ontologies/:ontologyKey/runtime/rulesets" });
  // The ruleset REST mirror: the runtime and changeset routers below a ruleset.
  await app.register(rulesetRuntimeRouter, { prefix: `${runtimePrefix}/rulesets/:rulesetKey` });

  // Startup step 6: both MCP servers share the process and call the same
  // services as REST.
  mountMcp(app);

  return app;
}
