/**
 * The runtime of every kind of the seam (`kind.ts`): checking a stored
 * configuration against its lens, the runtime list, loading the assistant
 * a request names — stored, or the built-in default derived from the lens —
 * and running one chat turn with its trace.
 *
 * A request can never supply a configuration: what runs is what was saved,
 * checked against the lens again, so a schema change that broke it refuses
 * the question instead of running a guess.
 */

import { NotFoundError, ValidationError } from "../../../core/exceptions.js";
import type { RuntimeStore } from "../../../core/ports.js";
import { configIssues } from "../../../core/retriever.js";
import type { RuntimeAssistant } from "../agents/runtime.js";
import type { StreamExecution } from "../../chatStream.js";
import { loadSchema, type LoadedSchema, type SchemaCacheValue } from "../../schemaCache.js";
import type { GraphThread } from "../../threads/threadStore.js";
import type { AnyAssistantKind, AssistantKind } from "./kind.js";
import { Trace } from "./trace.js";

/** The built-in default of every kind: never stored, derived from the lens. */
export const DEFAULT_ASSISTANT_KEY = "_default";
export const DEFAULT_ASSISTANT_NAME = "Default";

export interface Checked<C> {
  config: C | null;
  errors: string[];
}

/** A stored configuration against its lens: the parsed configuration when
 * the lens can run it, else every error. */
export function checkAssistant<C>(
  kind: AssistantKind<C>,
  version: unknown,
  raw: unknown,
  lens: SchemaCacheValue,
): Checked<C> {
  if (version !== kind.configVersion) {
    return {
      config: null,
      errors: [`Configuration version ${String(version)} is not supported; this release runs version ${kind.configVersion}`],
    };
  }
  const parsed = kind.config.safeParse(raw);
  if (!parsed.success) return { config: null, errors: configIssues(parsed.error) };
  const errors = kind.check(parsed.data, lens);
  return { config: errors.length === 0 ? parsed.data : null, errors };
}

/** Every assistant of the kind in the lens, the built-in default first;
 * no configuration, no validation, no model. */
export async function listRuntimeAssistants(
  kind: AnyAssistantKind,
  lensKey: string,
  store: RuntimeStore,
): Promise<RuntimeAssistant[]> {
  const loaded = await loadSchema(lensKey, store);
  const stored = await store.assistants().listAssistants(loaded.scoped.lensId, kind.kind);
  return [
    { key: DEFAULT_ASSISTANT_KEY, name: DEFAULT_ASSISTANT_NAME, description: kind.defaultDescription, builtIn: true },
    ...stored.map((a) => ({ key: a.key, name: a.name, description: a.description, builtIn: false })),
  ];
}

/** An assistant ready to run in its lens. */
export interface Runnable<C> {
  key: string;
  config: C;
  loaded: LoadedSchema;
}

/** The named assistant, checked against its lens: unknown → not found; one
 * the lens can no longer run → validation error. */
export async function loadRunnable<C>(
  kind: AssistantKind<C>,
  lensKey: string,
  key: string,
  store: RuntimeStore,
): Promise<Runnable<C>> {
  const loaded = await loadSchema(lensKey, store);
  if (key === DEFAULT_ASSISTANT_KEY) return { key, config: kind.derive(loaded.scoped), loaded };
  const stored = await store.assistants().getAssistant(loaded.scoped.lensId, kind.kind, key);
  if (stored === null) throw new NotFoundError(`${kind.noun} '${key}' not found`);
  const { config, errors } = checkAssistant(kind, stored.configVersion, stored.config, loaded.scoped);
  if (config === null) {
    throw new ValidationError(`${kind.noun} '${key}' is invalid in this lens: ${errors.join("; ")}`, { errors });
  }
  return { key, config, loaded };
}

/** One chat turn: the topology first, then the kind's run with its trace,
 * the summary last. */
export async function runTurn<C>(
  kind: AssistantKind<C>,
  runnable: Runnable<C>,
  lensKey: string,
  store: RuntimeStore,
  message: string,
  thread: GraphThread,
  execution: StreamExecution,
): Promise<{ reply: string }> {
  const { signal, onToolEvent: emit } = execution;
  const trace = new Trace(kind.event, emit, signal);
  await trace.graph(kind.topology);
  const reply = await kind.run({
    key: runnable.key,
    config: runnable.config,
    lensKey,
    store,
    loaded: runnable.loaded,
    message,
    thread,
    signal,
    trace,
  });
  return { reply };
}
