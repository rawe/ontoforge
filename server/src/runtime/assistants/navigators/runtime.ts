/**
 * The navigator at runtime: checking a stored configuration against its
 * lens, the runtime list, loading the navigator a request names — stored,
 * or the built-in default derived from the lens — and running one chat
 * turn with its trace.
 *
 * A request can never supply a configuration: what runs is what was saved,
 * checked against the lens again, so a schema change that broke it refuses
 * the question instead of running a guess.
 */

import { configIssues } from "../../../core/configIssues.js";
import { NotFoundError, ValidationError } from "../../../core/exceptions.js";
import type { RuntimeStore } from "../../../core/ports.js";
import type { StreamExecution } from "../../chatStream.js";
import { loadSchema, type LoadedSchema, type SchemaCacheValue } from "../../schemaCache.js";
import type { GraphThread } from "../../threads/threadStore.js";
import type { RuntimeAssistant } from "../assistant.js";
import { Trace } from "../kit/trace.js";
import { checkNavigator, deriveNavigator, NAVIGATOR_CONFIG_VERSION, NavigatorConfig } from "./config.js";
import { NAVIGATOR_DEFAULT_DESCRIPTION, NAVIGATOR_EVENT, NAVIGATOR_TOPOLOGY, run } from "./index.js";

/** The built-in default: never stored, derived from the lens. */
export const DEFAULT_NAVIGATOR_KEY = "_default";
export const DEFAULT_NAVIGATOR_NAME = "Default";

export interface CheckedNavigator {
  config: NavigatorConfig | null;
  errors: string[];
}

/** A stored configuration against its lens: the parsed configuration when
 * the lens can run it, else every error. */
export function checkStoredNavigator(version: unknown, raw: unknown, lens: SchemaCacheValue): CheckedNavigator {
  if (version !== NAVIGATOR_CONFIG_VERSION) {
    return {
      config: null,
      errors: [
        `Configuration version ${String(version)} is not supported; this release runs version ${NAVIGATOR_CONFIG_VERSION}`,
      ],
    };
  }
  const parsed = NavigatorConfig.safeParse(raw);
  if (!parsed.success) return { config: null, errors: configIssues(parsed.error) };
  const errors = checkNavigator(parsed.data, lens);
  return { config: errors.length === 0 ? parsed.data : null, errors };
}

/** Every navigator of the lens, the built-in default first; no
 * configuration, no validation, no model. */
export async function listRuntimeNavigators(lensKey: string, store: RuntimeStore): Promise<RuntimeAssistant[]> {
  const loaded = await loadSchema(lensKey, store);
  const stored = await store.navigators().listNavigators(loaded.scoped.lensId);
  return [
    { key: DEFAULT_NAVIGATOR_KEY, name: DEFAULT_NAVIGATOR_NAME, description: NAVIGATOR_DEFAULT_DESCRIPTION, builtIn: true },
    ...stored.map((n) => ({ key: n.key, name: n.name, description: n.description, builtIn: false })),
  ];
}

/** A navigator ready to run in its lens. */
export interface RunnableNavigator {
  key: string;
  config: NavigatorConfig;
  loaded: LoadedSchema;
}

/** The named navigator, checked against its lens: unknown → not found; one
 * the lens can no longer run → validation error. */
export async function loadRunnableNavigator(
  lensKey: string,
  key: string,
  store: RuntimeStore,
): Promise<RunnableNavigator> {
  const loaded = await loadSchema(lensKey, store);
  if (key === DEFAULT_NAVIGATOR_KEY) return { key, config: deriveNavigator(), loaded };
  const stored = await store.navigators().getNavigator(loaded.scoped.lensId, key);
  if (stored === null) throw new NotFoundError(`Navigator '${key}' not found`);
  const { config, errors } = checkStoredNavigator(stored.configVersion, stored.config, loaded.scoped);
  if (config === null) {
    throw new ValidationError(`Navigator '${key}' is invalid in this lens: ${errors.join("; ")}`, { errors });
  }
  return { key, config, loaded };
}

/** One chat turn: the topology first, then the turn with its trace, the
 * summary last. */
export async function runNavigatorTurn(
  runnable: RunnableNavigator,
  lensKey: string,
  store: RuntimeStore,
  message: string,
  thread: GraphThread,
  execution: StreamExecution,
): Promise<{ reply: string }> {
  const { signal, onToolEvent: emit } = execution;
  const trace = new Trace(NAVIGATOR_EVENT, emit, signal);
  await trace.graph(NAVIGATOR_TOPOLOGY);
  const reply = await run({
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
