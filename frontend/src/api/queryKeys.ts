/**
 * TanStack Query key scheme (see master spec):
 *
 *   ['features']                                     staleTime Infinity
 *   ['ontologies']                                   registry ontology list
 *   ['lenses', ontologyKey]                          modeling lens list
 *   ['schema', ontologyKey, lensKey]                 runtime schema
 *   ['entities', ontologyKey, lensKey, typeKey, params]
 *   ['entity', ontologyKey, lensKey, typeKey, id]
 *   ['document', ontologyKey, lensKey, typeKey, id, propertyKey]
 *   ['neighbors', ontologyKey, lensKey, typeKey, id, params]
 *   ['relations', ontologyKey, lensKey, typeKey, params]
 *   ['savedQueries', ontologyKey, lensKey]
 *   ['agents', ontologyKey, lensKey]
 *   ['model', ontologyKey, ...]                      modeling sub-keys
 *
 * Every ontology-scoped key carries the ontology key, so the same lens
 * key in two ontologies never shares a cache entry. Mutations invalidate
 * precisely; scope/schema mutations invalidate `['schema']` broadly.
 */

export const qk = {
  features: ['features'] as const,
  ontologies: ['ontologies'] as const,
  lenses: (ontologyKey: string) => ['lenses', ontologyKey] as const,

  schemaAll: ['schema'] as const,
  schema: (ontologyKey: string, lensKey: string) =>
    ['schema', ontologyKey, lensKey] as const,

  entities: (ontologyKey: string, lensKey: string, typeKey: string, params?: unknown) =>
    params === undefined
      ? (['entities', ontologyKey, lensKey, typeKey] as const)
      : (['entities', ontologyKey, lensKey, typeKey, params] as const),
  entity: (ontologyKey: string, lensKey: string, typeKey: string, id: string) =>
    ['entity', ontologyKey, lensKey, typeKey, id] as const,
  document: (
    ontologyKey: string,
    lensKey: string,
    typeKey: string,
    id: string,
    propertyKey: string,
  ) => ['document', ontologyKey, lensKey, typeKey, id, propertyKey] as const,
  neighbors: (
    ontologyKey: string,
    lensKey: string,
    typeKey: string,
    id: string,
    params?: unknown,
  ) =>
    params === undefined
      ? (['neighbors', ontologyKey, lensKey, typeKey, id] as const)
      : (['neighbors', ontologyKey, lensKey, typeKey, id, params] as const),
  relations: (ontologyKey: string, lensKey: string, typeKey: string, params?: unknown) =>
    params === undefined
      ? (['relations', ontologyKey, lensKey, typeKey] as const)
      : (['relations', ontologyKey, lensKey, typeKey, params] as const),

  savedQueries: (ontologyKey: string, lensKey: string) =>
    ['savedQueries', ontologyKey, lensKey] as const,
  agents: (ontologyKey: string, lensKey: string) =>
    ['agents', ontologyKey, lensKey] as const,

  model: (ontologyKey: string, ...parts: readonly unknown[]) =>
    ['model', ontologyKey, ...parts] as const,
} as const
