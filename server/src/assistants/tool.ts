/**
 * A tool a tool loop offers its model (`loop.ts`). The host builds it
 * already authorised and bound to what it reads; `C` is the turn's own
 * state, shared by the run and the presenter (the runtime's entity refs).
 * Catalogs stay with the hosts: this is the one shared type.
 */
import type { z } from "zod";

import type { StreamEvent } from "./session.js";

type Row = Record<string, unknown>;

export interface Tool<C> {
  name: string;
  description: string;
  /** The arguments' schema; arguments that fail it go back to the model as an `{error}` result. */
  input: z.ZodType;
  /** The result for the model: a string as it is, anything else as JSON. */
  run(args: Row, ctx: C, signal?: AbortSignal): Promise<unknown>;
  /** The result an expected failure hands the model, so it can correct
   * itself; undefined for any other error, which aborts the turn. */
  expected(error: unknown): { error: unknown } | undefined;
  /** The host's events for a call's result, sent right after its tool
   * result; an `{error}` result comes here too. */
  present?(args: Row, result: unknown, ctx: C): StreamEvent[];
  /** Runs one call at a time, after the serial calls before it, even when
   * the model asks for several at once. */
  serial?: boolean;
}
