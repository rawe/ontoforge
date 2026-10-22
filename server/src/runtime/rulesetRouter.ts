/** Ruleset maintenance, REST, mounted at `/api/ontologies/:ontologyKey/runtime/rulesets`:
 * lensless, beside the lens mounts; and the ruleset REST mirror. Every
 * rule lives in `rulesets.ts`. */
import type { FastifyPluginAsyncZod } from "fastify-type-provider-zod";
import { z } from "zod";

import { getRuntimeStore } from "../core/ports.js";
import { changesetRouter } from "./changesetRouter.js";
import { runtimeRouter } from "./router.js";
import * as rulesets from "./rulesets.js";
import { checkOperation, routeOperation } from "./writeAccess.js";

const Ontology = z.object({ ontologyKey: z.string() });
const Ruleset = Ontology.extend({ rulesetKey: z.string() });
const Mount = Ruleset.extend({ lensKey: z.string() });

export const rulesetRouter: FastifyPluginAsyncZod = async (app) => {
  app.get(
    "/",
    { schema: { tags: ["runtime"], params: Ontology, response: { 200: z.array(rulesets.RulesetResponse) } } },
    async (request) => rulesets.listRulesets(await getRuntimeStore(request.params.ontologyKey)),
  );
  app.get(
    "/:rulesetKey",
    { schema: { tags: ["runtime"], params: Ruleset, response: { 200: rulesets.RulesetResponse } } },
    async (request) =>
      rulesets.readRuleset(request.params.rulesetKey, await getRuntimeStore(request.params.ontologyKey)),
  );
  app.put(
    "/:rulesetKey",
    {
      schema: {
        tags: ["runtime"],
        params: Ruleset,
        body: rulesets.RulesetWriteBody,
        response: { 200: rulesets.RulesetResponse },
      },
    },
    async (request) =>
      rulesets.saveRuleset(
        request.params.rulesetKey,
        request.body,
        await getRuntimeStore(request.params.ontologyKey),
      ),
  );
  app.delete(
    "/:rulesetKey",
    { schema: { tags: ["runtime"], params: Ruleset } },
    async (request, reply) => {
      await rulesets.deleteRuleset(request.params.rulesetKey, await getRuntimeStore(request.params.ontologyKey));
      return reply.status(204).send();
    },
  );
};

/**
 * The ruleset REST mirror, mounted at
 * `/api/ontologies/:ontologyKey/runtime/lenses/:lensKey/rulesets/:rulesetKey`:
 * the runtime and changeset routers, plus a root that mirrors `get_ruleset`. Every
 * request first checks ontology, lens and ruleset, in that order, so an
 * unknown ruleset is not found on reads too; then the route's operation
 * against the ruleset's write access (`writeAccess.ts`), before the route
 * runs.
 */
export const rulesetRuntimeRouter: FastifyPluginAsyncZod = async (app) => {
  /** A route's path below the mount, without a trailing slash. */
  const below = (url: string): string => url.slice(app.prefix.length).replace(/(.)\/$/, "$1") || "/";
  // The runtime router's params schemas name no ruleset, and a zod object
  // strips unknown keys: declare `rulesetKey` on every route, so it reaches
  // the write functions and the OpenAPI document. A route with no row in
  // the operation table fails the boot.
  app.addHook("onRoute", (route) => {
    for (const method of [route.method].flat()) routeOperation(method, below(route.url));
    const params = route.schema?.params;
    if (params instanceof z.ZodObject) route.schema!.params = params.extend({ rulesetKey: z.string() });
  });
  app.addHook("preHandler", async (request) => {
    const { ontologyKey, lensKey, rulesetKey } = request.params as z.infer<typeof Mount>;
    const record = await rulesets.readMountRuleset(lensKey, rulesetKey, await getRuntimeStore(ontologyKey));
    checkOperation(
      { rulesetKey, writeAccess: record.writeAccess },
      routeOperation(request.method, below(request.routeOptions.url!)),
    );
  });
  app.get(
    "/",
    { schema: { tags: ["runtime"], params: Mount, response: { 200: rulesets.RulesetView } } },
    async (request) =>
      rulesets.getRulesetView(
        request.params.lensKey,
        request.params.rulesetKey,
        await getRuntimeStore(request.params.ontologyKey),
      ),
  );
  await app.register(runtimeRouter);
  await app.register(changesetRouter, { prefix: "/changesets" });
};
