/**
 * Runtime schema cache.
 *
 * Seam: session 04 fills this module with the per-lens cache described in
 * `docs/architecture.md#schema-cache`. Until then only the invalidation
 * entry point exists — every mutating modeling service path already calls
 * it at the same points the Python service does, so wiring does not change
 * when the cache arrives.
 */

/** Clear the loaded schema cache. No-op until the cache exists. */
export function invalidateLoadedSchemaCache(): void {}
