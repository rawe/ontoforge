/**
 * TanStack Query key scheme (see master spec):
 *
 *   ['features']                                     staleTime Infinity
 *   ['lenses']                                   modeling lens list
 *   ['schema', lensKey]                          runtime schema
 *   ['entities', lensKey, typeKey, params]
 *   ['entity', lensKey, typeKey, id]
 *   ['document', lensKey, typeKey, id, propertyKey]
 *   ['neighbors', lensKey, typeKey, id, params]
 *   ['relations', lensKey, typeKey, params]
 *   ['savedQueries', lensKey]
 *   ['agents', lensKey]
 *   ['model', ...]                                   modeling sub-keys
 *
 * Mutations invalidate precisely; scope/schema mutations invalidate
 * `['schema']` broadly.
 */

export const qk = {
  features: ['features'] as const,
  lenses: ['lenses'] as const,

  schemaAll: ['schema'] as const,
  schema: (lensKey: string) => ['schema', lensKey] as const,

  entities: (lensKey: string, typeKey: string, params?: unknown) =>
    params === undefined
      ? (['entities', lensKey, typeKey] as const)
      : (['entities', lensKey, typeKey, params] as const),
  entity: (lensKey: string, typeKey: string, id: string) =>
    ['entity', lensKey, typeKey, id] as const,
  document: (lensKey: string, typeKey: string, id: string, propertyKey: string) =>
    ['document', lensKey, typeKey, id, propertyKey] as const,
  neighbors: (lensKey: string, typeKey: string, id: string, params?: unknown) =>
    params === undefined
      ? (['neighbors', lensKey, typeKey, id] as const)
      : (['neighbors', lensKey, typeKey, id, params] as const),
  relations: (lensKey: string, typeKey: string, params?: unknown) =>
    params === undefined
      ? (['relations', lensKey, typeKey] as const)
      : (['relations', lensKey, typeKey, params] as const),

  savedQueries: (lensKey: string) => ['savedQueries', lensKey] as const,
  agents: (lensKey: string) => ['agents', lensKey] as const,

  model: (...parts: readonly unknown[]) => ['model', ...parts] as const,
} as const
