/**
 * The assistant-kind seam. A kind is one module under
 * `runtime/assistants/kinds/<kind>/` that says what its configuration is,
 * how it is checked against a lens and derived for the built-in default,
 * which steps it runs, and how one turn runs. Everything else — routes,
 * storage, validation on read, the runtime list, threads, transfer — is
 * the kit's and is the same for every kind.
 *
 * Every kind of this seam is a LangGraph state machine with a fixed,
 * visible topology: its steps are announced at the start of a turn and
 * traced as they run (`trace.ts`), and every entity the answer may use is
 * streamed before the answer.
 *
 * Agents and retrievers predate the seam and keep their own modules.
 */

import type { z } from "zod";

import type { AssistantKindKey } from "../../../core/assistant.js";
import type { RuntimeStore } from "../../../core/ports.js";
import type { LoadedSchema, SchemaCacheValue } from "../../schemaCache.js";
import type { GraphThread } from "../../threads/threadStore.js";
import type { Trace } from "./trace.js";

/** One step of a kind's pipeline, as the client draws it. */
export interface StepDef {
  id: string;
  label: string;
  description: string;
  /** Whether the step calls the language model. */
  model: boolean;
}

/** One edge of the pipeline; an edge to itself is a repeat. */
export interface EdgeDef {
  from: string;
  to: string;
  label?: string;
}

export interface Topology {
  steps: StepDef[];
  edges: EdgeDef[];
}

/** What one turn of a kind runs with. */
export interface Turn<C> {
  /** The assistant's key, `_default` for the derived one. */
  key: string;
  config: C;
  lensKey: string;
  store: RuntimeStore;
  loaded: LoadedSchema;
  message: string;
  thread: GraphThread;
  signal: AbortSignal;
  trace: Trace;
}

export interface AssistantKind<C> {
  /** The route segment and storage kind, plural: `navigators`. */
  kind: AssistantKindKey;
  /** The event prefix and the noun, singular: `navigator` → `navigator.step`. */
  event: string;
  /** The noun in messages: `Navigator`. */
  noun: string;
  /** The configuration version this release writes and runs. */
  configVersion: number;
  /** Shape and limits; parsing fills defaults. */
  config: z.ZodType<C>;
  /** Errors against the lens; none when the lens can run it. */
  check(config: C, lens: SchemaCacheValue): string[];
  /** The built-in default's configuration, derived from the lens and valid by construction. */
  derive(lens: SchemaCacheValue): C;
  /** The built-in default's runtime list description. */
  defaultDescription: string;
  topology: Topology;
  /** Runs one turn on its thread and returns the answer. */
  run(turn: Turn<C>): Promise<string>;
}

/** Any kind, for the registry. */
export type AnyAssistantKind = AssistantKind<any>;
