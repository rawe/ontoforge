/**
 * TanStack Query key scheme (see master spec):
 *
 *   ['features']                                     staleTime Infinity
 *   ['ontologies']                                   modeling ontology list
 *   ['schema', ontologyKey]                          runtime schema
 *   ['entities', ontologyKey, typeKey, params]
 *   ['entity', ontologyKey, typeKey, id]
 *   ['document', ontologyKey, typeKey, id, propertyKey]
 *   ['neighbors', ontologyKey, typeKey, id, params]
 *   ['relations', ontologyKey, typeKey, params]
 *   ['savedQueries', ontologyKey]
 *   ['agents', ontologyKey]
 *   ['model', ...]                                   modeling sub-keys
 *
 * Mutations invalidate precisely; scope/schema mutations invalidate
 * `['schema']` broadly.
 */

export const qk = {
  features: ['features'] as const,
  ontologies: ['ontologies'] as const,

  schemaAll: ['schema'] as const,
  schema: (ontologyKey: string) => ['schema', ontologyKey] as const,

  entities: (ontologyKey: string, typeKey: string, params?: unknown) =>
    params === undefined
      ? (['entities', ontologyKey, typeKey] as const)
      : (['entities', ontologyKey, typeKey, params] as const),
  entity: (ontologyKey: string, typeKey: string, id: string) =>
    ['entity', ontologyKey, typeKey, id] as const,
  document: (ontologyKey: string, typeKey: string, id: string, propertyKey: string) =>
    ['document', ontologyKey, typeKey, id, propertyKey] as const,
  neighbors: (ontologyKey: string, typeKey: string, id: string, params?: unknown) =>
    params === undefined
      ? (['neighbors', ontologyKey, typeKey, id] as const)
      : (['neighbors', ontologyKey, typeKey, id, params] as const),
  relations: (ontologyKey: string, typeKey: string, params?: unknown) =>
    params === undefined
      ? (['relations', ontologyKey, typeKey] as const)
      : (['relations', ontologyKey, typeKey, params] as const),

  savedQueries: (ontologyKey: string) => ['savedQueries', ontologyKey] as const,
  agents: (ontologyKey: string) => ['agents', ontologyKey] as const,

  model: (...parts: readonly unknown[]) => ['model', ...parts] as const,
} as const
