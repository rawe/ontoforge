/**
 * Navigators in modeling: lens-local CRUD and their portable form for
 * transfer. A save checks the configuration against the owning lens
 * (`runtime/assistants/navigators/runtime.ts`) and refuses an invalid one;
 * a stored navigator can still become invalid when the lens changes
 * underneath it, which every read reports.
 *
 * The built-in default is runtime's alone: never listed, read or written
 * here, and its key cannot be stored.
 */

import { randomUUID } from "node:crypto";

import { z } from "zod";

import { NotFoundError, ValidationError } from "../core/exceptions.js";
import type { NavigatorRecord } from "../core/navigator.js";
import type { ModelingStore, RuntimeStore } from "../core/ports.js";
import { LENS_RESOURCE_KEY_PATTERN, MAX_KEY_LENGTH } from "../core/schemas.js";
import { NAVIGATOR_CONFIG_VERSION } from "../runtime/assistants/navigators/config.js";
import { checkStoredNavigator } from "../runtime/assistants/navigators/runtime.js";
import { loadSchema, type SchemaCacheValue } from "../runtime/schemaCache.js";
import { ExportNavigator } from "./schemas.js";

const Key = z.string().regex(LENS_RESOURCE_KEY_PATTERN).max(MAX_KEY_LENGTH);

/** The write body of `PUT`; the configuration is the navigator's to check. */
export const NavigatorWriteBody = z
  .object({
    name: z.string().min(1).max(200),
    description: z.string().max(4000).nullable().default(null),
    configVersion: z.number().int(),
    config: z.unknown(),
  })
  .strict();
export type NavigatorWriteBodyInput = z.input<typeof NavigatorWriteBody>;

/** One navigator in its portable form (transfer). Kept as stored. */
export const PortableNavigator = ExportNavigator;
export type PortableNavigator = z.infer<typeof PortableNavigator>;

export const NavigatorResponse = PortableNavigator.extend({
  lensKey: z.string(),
  validation: z.object({ valid: z.boolean(), errors: z.array(z.string()), warnings: z.array(z.string()) }),
  createdAt: z.string(),
  updatedAt: z.string(),
});
export type NavigatorResponse = z.infer<typeof NavigatorResponse>;

export function portableNavigator(navigator: NavigatorRecord): PortableNavigator {
  return {
    key: navigator.key,
    name: navigator.name,
    description: navigator.description,
    configVersion: navigator.configVersion,
    config: navigator.config,
  };
}

function toResponse(navigator: NavigatorRecord, lensKey: string, lens: SchemaCacheValue): NavigatorResponse {
  const { errors } = checkStoredNavigator(navigator.configVersion, navigator.config, lens);
  return {
    ...portableNavigator(navigator),
    lensKey,
    validation: { valid: errors.length === 0, errors, warnings: [] },
    createdAt: navigator.createdAt.toISOString(),
    updatedAt: navigator.updatedAt.toISOString(),
  };
}

/** A storable key: the lens-resource rule, so never the built-in `_default`. */
export function navigatorKeyError(key: string): string | null {
  return Key.safeParse(key).success
    ? null
    : `Invalid navigator key '${key}'. Must match pattern ${LENS_RESOURCE_KEY_PATTERN.source} ` +
        `and be at most ${MAX_KEY_LENGTH} characters`;
}

/** The lens's id, and the scoped schema its navigators are checked against. */
async function lensOf(
  lensKey: string,
  store: ModelingStore,
  runtime: RuntimeStore,
): Promise<{ lensId: string; lens: SchemaCacheValue }> {
  const found = await store.getLensByKey(lensKey);
  if (!found) throw new NotFoundError(`Lens '${lensKey}' not found`);
  return { lensId: found.lensId as string, lens: (await loadSchema(lensKey, runtime)).scoped };
}

export async function listNavigators(
  lensKey: string,
  store: ModelingStore,
  runtime: RuntimeStore,
): Promise<NavigatorResponse[]> {
  const { lensId, lens } = await lensOf(lensKey, store, runtime);
  return (await store.navigators().listNavigators(lensId)).map((n) => toResponse(n, lensKey, lens));
}

export async function getNavigator(
  lensKey: string,
  key: string,
  store: ModelingStore,
  runtime: RuntimeStore,
): Promise<NavigatorResponse> {
  const { lensId, lens } = await lensOf(lensKey, store, runtime);
  const found = await store.navigators().getNavigator(lensId, key);
  if (found === null) throw new NotFoundError(`Navigator '${key}' not found`);
  return toResponse(found, lensKey, lens);
}

/** Create or replace (`PUT`); an invalid configuration is refused with every error. */
export async function saveNavigator(
  lensKey: string,
  key: string,
  body: NavigatorWriteBodyInput,
  store: ModelingStore,
  runtime: RuntimeStore,
): Promise<[NavigatorResponse, boolean]> {
  const keyError = navigatorKeyError(key);
  if (keyError !== null) throw new ValidationError(keyError);
  const parsed = NavigatorWriteBody.parse(body);
  const { lensId, lens } = await lensOf(lensKey, store, runtime);
  const { config, errors } = checkStoredNavigator(parsed.configVersion, parsed.config, lens);
  if (config === null) {
    throw new ValidationError(`Invalid navigator configuration: ${errors.join("; ")}`, { errors });
  }
  const [saved, created] = await store.changeDesign((s) =>
    s.navigators().saveNavigator(
      lensId,
      {
        navigatorId: randomUUID(),
        key,
        name: parsed.name,
        description: parsed.description,
        configVersion: NAVIGATOR_CONFIG_VERSION,
        config,
      },
      false,
    ));
  return [toResponse(saved, lensKey, lens), created];
}

export async function deleteNavigator(lensKey: string, key: string, store: ModelingStore): Promise<void> {
  await store.changeDesign(async (s) => {
    const found = await s.getLensByKey(lensKey);
    if (!found) throw new NotFoundError(`Lens '${lensKey}' not found`);
    if (!(await s.navigators().deleteNavigator(found.lensId as string, key))) {
      throw new NotFoundError(`Navigator '${key}' not found`);
    }
  });
}
