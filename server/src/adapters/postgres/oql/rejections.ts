/**
 * The compiler's two refusal channels.
 *
 * `reject` is the compiler's **only** own rejection of a user query: a
 * property name the validator could not check — the second line behind
 * OQL validation. It raises the core `ValidationError` carrying the same
 * `errors` list the validation path uses, so a caller cannot tell which
 * of the two lines refused.
 *
 * `pendingSurface` is not a user-facing refusal at all: it names a
 * construct the validator admits and this compiler does not emit, so the
 * gap is greppable and never a silently wrong answer.
 */

import { ValidationError } from "../../../core/exceptions.js";

export function reject(message: string): never {
  throw new ValidationError("Query validation failed", { errors: [message] });
}

export function pendingSurface(construct: string): never {
  throw new Error(`OQL construct not compiled by the PostgreSQL adapter yet: ${construct}`);
}
