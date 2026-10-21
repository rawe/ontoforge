/** Anchor maintenance, REST, mounted at `/api/ontologies/:ontologyKey/runtime/anchors`:
 * lensless, beside the lens mounts; and the anchored REST mirror. Every
 * rule lives in `anchors.ts`. */
import type { FastifyPluginAsyncZod } from "fastify-type-provider-zod";
import { z } from "zod";

import { getRuntimeStore } from "../core/ports.js";
import * as anchors from "./anchors.js";
import { changesetRouter } from "./changesetRouter.js";
import { runtimeRouter } from "./router.js";
import { checkOperation, routeOperation } from "./writeAccess.js";

const Ontology = z.object({ ontologyKey: z.string() });
const Anchor = Ontology.extend({ anchorKey: z.string() });
const Mount = Anchor.extend({ lensKey: z.string() });

export const anchorRouter: FastifyPluginAsyncZod = async (app) => {
  app.get(
    "/",
    { schema: { tags: ["runtime"], params: Ontology, response: { 200: z.array(anchors.AnchorResponse) } } },
    async (request) => anchors.listAnchors(await getRuntimeStore(request.params.ontologyKey)),
  );
  app.get(
    "/:anchorKey",
    { schema: { tags: ["runtime"], params: Anchor, response: { 200: anchors.AnchorResponse } } },
    async (request) =>
      anchors.readAnchor(request.params.anchorKey, await getRuntimeStore(request.params.ontologyKey)),
  );
  app.put(
    "/:anchorKey",
    {
      schema: {
        tags: ["runtime"],
        params: Anchor,
        body: anchors.AnchorWriteBody,
        response: { 200: anchors.AnchorResponse },
      },
    },
    async (request) =>
      anchors.saveAnchor(
        request.params.anchorKey,
        request.body,
        await getRuntimeStore(request.params.ontologyKey),
      ),
  );
  app.delete(
    "/:anchorKey",
    { schema: { tags: ["runtime"], params: Anchor } },
    async (request, reply) => {
      await anchors.deleteAnchor(request.params.anchorKey, await getRuntimeStore(request.params.ontologyKey));
      return reply.status(204).send();
    },
  );
};

/**
 * The anchored REST mirror, mounted at
 * `/api/ontologies/:ontologyKey/runtime/lenses/:lensKey/anchors/:anchorKey`:
 * the runtime and changeset routers, plus a root that mirrors `get_anchor`. Every
 * request first checks ontology, lens and anchor, in that order, so an
 * unknown anchor is not found on reads too; then the route's operation
 * against the ruleset's write access (`writeAccess.ts`), before the route
 * runs.
 */
export const anchoredRuntimeRouter: FastifyPluginAsyncZod = async (app) => {
  /** A route's path below the mount, without a trailing slash. */
  const below = (url: string): string => url.slice(app.prefix.length).replace(/(.)\/$/, "$1") || "/";
  // The runtime router's params schemas name no anchor, and a zod object
  // strips unknown keys: declare `anchorKey` on every route, so it reaches
  // the write functions and the OpenAPI document. A route with no row in
  // the operation table fails the boot.
  app.addHook("onRoute", (route) => {
    for (const method of [route.method].flat()) routeOperation(method, below(route.url));
    const params = route.schema?.params;
    if (params instanceof z.ZodObject) route.schema!.params = params.extend({ anchorKey: z.string() });
  });
  app.addHook("preHandler", async (request) => {
    const { ontologyKey, lensKey, anchorKey } = request.params as z.infer<typeof Mount>;
    const record = await anchors.readMountRuleset(lensKey, anchorKey, await getRuntimeStore(ontologyKey));
    checkOperation(
      { rulesetKey: anchorKey, writeAccess: record.writeAccess },
      routeOperation(request.method, below(request.routeOptions.url!)),
    );
  });
  app.get(
    "/",
    { schema: { tags: ["runtime"], params: Mount, response: { 200: anchors.AnchorView } } },
    async (request) =>
      anchors.getAnchorView(
        request.params.lensKey,
        request.params.anchorKey,
        await getRuntimeStore(request.params.ontologyKey),
      ),
  );
  await app.register(runtimeRouter);
  await app.register(changesetRouter, { prefix: "/changesets" });
};
