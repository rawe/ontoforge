/**
 * Data writes against the current design.
 *
 * A write validates against the cached schema of a design revision and
 * commits in a transaction that holds the design shared and checks that
 * revision first (`RuntimeStore.transaction`): its business checks, the
 * write and its search work all run there. When a design change commits
 * in between — on any server process — the transaction refuses with
 * `DesignChangedError`; the write then reloads the schema, validates again
 * and retries. A write never commits against a design that changed, and
 * never plans its search work against older index definitions.
 */

import { DesignChangedError } from "../core/exceptions.js";
import { sameDesign } from "../core/designRevision.js";
import type { DesignRevision, RuntimeStore } from "../core/ports.js";
import { loadSchema, loadSearchContext, type LoadedSchema, type SearchContext } from "./schemaCache.js";

/** How often a write runs before a design that keeps changing is a 409. A
 * change only gets in between when it commits during the moment between
 * the revision read and the hold. */
const ATTEMPTS = 3;

/** Run `attempt` against the current design revision; once more, read
 * again, when it throws `DesignChangedError`, up to `ATTEMPTS` runs. */
export async function retryOnDesignChange<T>(
  store: RuntimeStore,
  attempt: (current: DesignRevision) => Promise<T>,
): Promise<T> {
  for (let run = 1; ; run++) {
    try {
      return await attempt(await store.designRevision());
    } catch (error) {
      if (!(error instanceof DesignChangedError) || run >= ATTEMPTS) throw error;
    }
  }
}

/** The lens and the search context of one design revision — a design
 * changed between their two loads is a `DesignChangedError`. */
export async function loadDesign(
  lensKey: string,
  store: RuntimeStore,
  current: DesignRevision,
): Promise<{ loaded: LoadedSchema; search: SearchContext }> {
  const loaded = await loadSchema(lensKey, store, current);
  const search = await loadSearchContext(store.ontologyKey, store.searchIndices(), current);
  if (!sameDesign(loaded.design, search.design)) throw new DesignChangedError();
  return { loaded, search };
}

/**
 * One data write: `work` runs inside a transaction checked against the
 * design `loaded` and `search` describe, with the store bound to it —
 * every read, check and write of `work` goes through `tx`.
 */
export function writeWithDesign<T>(
  lensKey: string,
  store: RuntimeStore,
  work: (tx: RuntimeStore, loaded: LoadedSchema, search: SearchContext) => Promise<T>,
): Promise<T> {
  return retryOnDesignChange(store, async (current) => {
    const { loaded, search } = await loadDesign(lensKey, store, current);
    return store.transaction(loaded.design, (tx) => work(tx, loaded, search));
  });
}
