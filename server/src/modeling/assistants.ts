/**
 * Assistants of registered kinds in modeling (`runtime/assistants/kinds/`):
 * lens-local CRUD, the same for every kind, and their portable form for
 * transfer. A save checks the configuration against the owning lens and
 * refuses an invalid one; a stored assistant can still become invalid when
 * the lens changes underneath it, which every read reports.
 *
 * The built-in default of each kind is runtime's alone: never listed, read
 * or written here, and its key cannot be stored.
 */

import { randomUUID } from "node:crypto";

import { z } from "zod";

import type { AssistantRecord } from "../core/assistant.js";
import { NotFoundError, ValidationError } from "../core/exceptions.js";
import type { ModelingStore, RuntimeStore } from "../core/ports.js";
import { LENS_RESOURCE_KEY_PATTERN, MAX_KEY_LENGTH } from "../core/schemas.js";
import type { AnyAssistantKind } from "../runtime/assistants/kit/kind.js";
import { checkAssistant } from "../runtime/assistants/kit/runtime.js";
import { loadSchema, type SchemaCacheValue } from "../runtime/schemaCache.js";
import { ExportAssistant } from "./schemas.js";

const Key = z.string().regex(LENS_RESOURCE_KEY_PATTERN).max(MAX_KEY_LENGTH);

/** The write body of `PUT`; the configuration is the kind's to check. */
export const AssistantWriteBody = z
  .object({
    name: z.string().min(1).max(200),
    description: z.string().max(4000).nullable().default(null),
    configVersion: z.number().int(),
    config: z.unknown(),
  })
  .strict();
export type AssistantWriteBodyInput = z.input<typeof AssistantWriteBody>;

/** One assistant in its portable form (transfer). Kept as stored. */
export const PortableAssistant = ExportAssistant;
export type PortableAssistant = z.infer<typeof PortableAssistant>;

export const AssistantResponse = PortableAssistant.extend({
  lensKey: z.string(),
  validation: z.object({ valid: z.boolean(), errors: z.array(z.string()), warnings: z.array(z.string()) }),
  createdAt: z.string(),
  updatedAt: z.string(),
});
export type AssistantResponse = z.infer<typeof AssistantResponse>;

export function portableAssistant(assistant: AssistantRecord): PortableAssistant {
  return {
    key: assistant.key,
    name: assistant.name,
    description: assistant.description,
    configVersion: assistant.configVersion,
    config: assistant.config,
  };
}

function toResponse(
  kind: AnyAssistantKind,
  assistant: AssistantRecord,
  lensKey: string,
  lens: SchemaCacheValue,
): AssistantResponse {
  const { errors } = checkAssistant(kind, assistant.configVersion, assistant.config, lens);
  return {
    ...portableAssistant(assistant),
    lensKey,
    validation: { valid: errors.length === 0, errors, warnings: [] },
    createdAt: assistant.createdAt.toISOString(),
    updatedAt: assistant.updatedAt.toISOString(),
  };
}

/** A storable key: the lens-resource rule, so never the built-in `_default`. */
export function assistantKeyError(kind: AnyAssistantKind, key: string): string | null {
  return Key.safeParse(key).success
    ? null
    : `Invalid ${kind.noun.toLowerCase()} key '${key}'. Must match pattern ${LENS_RESOURCE_KEY_PATTERN.source} ` +
        `and be at most ${MAX_KEY_LENGTH} characters`;
}

/** The lens's id, and the scoped schema its assistants are checked against. */
async function lensOf(
  lensKey: string,
  store: ModelingStore,
  runtime: RuntimeStore,
): Promise<{ lensId: string; lens: SchemaCacheValue }> {
  const found = await store.getLensByKey(lensKey);
  if (!found) throw new NotFoundError(`Lens '${lensKey}' not found`);
  return { lensId: found.lensId as string, lens: (await loadSchema(lensKey, runtime)).scoped };
}

export async function listAssistants(
  kind: AnyAssistantKind,
  lensKey: string,
  store: ModelingStore,
  runtime: RuntimeStore,
): Promise<AssistantResponse[]> {
  const { lensId, lens } = await lensOf(lensKey, store, runtime);
  return (await store.assistants().listAssistants(lensId, kind.kind)).map((a) => toResponse(kind, a, lensKey, lens));
}

export async function getAssistant(
  kind: AnyAssistantKind,
  lensKey: string,
  key: string,
  store: ModelingStore,
  runtime: RuntimeStore,
): Promise<AssistantResponse> {
  const { lensId, lens } = await lensOf(lensKey, store, runtime);
  const found = await store.assistants().getAssistant(lensId, kind.kind, key);
  if (found === null) throw new NotFoundError(`${kind.noun} '${key}' not found`);
  return toResponse(kind, found, lensKey, lens);
}

/** Create or replace (`PUT`); an invalid configuration is refused with every error. */
export async function saveAssistant(
  kind: AnyAssistantKind,
  lensKey: string,
  key: string,
  body: AssistantWriteBodyInput,
  store: ModelingStore,
  runtime: RuntimeStore,
): Promise<[AssistantResponse, boolean]> {
  const keyError = assistantKeyError(kind, key);
  if (keyError !== null) throw new ValidationError(keyError);
  const parsed = AssistantWriteBody.parse(body);
  const { lensId, lens } = await lensOf(lensKey, store, runtime);
  const { config, errors } = checkAssistant(kind, parsed.configVersion, parsed.config, lens);
  if (config === null) {
    throw new ValidationError(`Invalid ${kind.noun.toLowerCase()} configuration: ${errors.join("; ")}`, { errors });
  }
  const [saved, created] = await store.assistants().saveAssistant(
    lensId,
    {
      assistantId: randomUUID(),
      kind: kind.kind,
      key,
      name: parsed.name,
      description: parsed.description,
      configVersion: kind.configVersion,
      config,
    },
    false,
  );
  return [toResponse(kind, saved, lensKey, lens), created];
}

export async function deleteAssistant(
  kind: AnyAssistantKind,
  lensKey: string,
  key: string,
  store: ModelingStore,
): Promise<void> {
  const found = await store.getLensByKey(lensKey);
  if (!found) throw new NotFoundError(`Lens '${lensKey}' not found`);
  if (!(await store.assistants().deleteAssistant(found.lensId as string, kind.kind, key))) {
    throw new NotFoundError(`${kind.noun} '${key}' not found`);
  }
}
