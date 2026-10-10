/**
 * TanStack Query key scheme (see master spec):
 *
 *   ['features']                                     staleTime Infinity
 *   ['ontologies']                                   registry ontology list
 *   ['lenses', ontologyKey]                          modeling lens list
 *   ['schema', ontologyKey, lensKey]                 runtime schema
 *   ['schema', ontologyKey, lensKey, 'search-indices']  runtime search catalog
 *   ['entities', ontologyKey, lensKey, typeKey, params]
 *   ['entity', ontologyKey, lensKey, typeKey, id]
 *   ['document', ontologyKey, lensKey, typeKey, id, propertyKey]
 *   ['neighbors', ontologyKey, lensKey, typeKey, id, params]
 *   ['relations', ontologyKey, lensKey, typeKey, params]
 *   ['savedQueries', ontologyKey, lensKey]
 *   ['assistants', ontologyKey, lensKey, kind]       runtime assistant list of a kind
 *   ['model', ontologyKey, ...]                      modeling sub-keys
 *   ['model', ontologyKey, 'retriever-agents', lensKey]  retriever agents of a lens
 *
 * Every ontology-scoped key carries the ontology key, so the same lens
 * key in two ontologies never shares a cache entry. Mutations invalidate
 * precisely; scope/schema mutations invalidate `['schema']` broadly.
 */

import type { AssistantKind } from './types'

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
  assistants: (ontologyKey: string, lensKey: string, kind: AssistantKind) =>
    ['assistants', ontologyKey, lensKey, kind] as const,

  model: (ontologyKey: string, ...parts: readonly unknown[]) =>
    ['model', ontologyKey, ...parts] as const,
  /** Under `model`: every modeling mutation (scope, schema) refreshes their validation. */
  retrieverAgents: (ontologyKey: string, lensKey: string) =>
    ['model', ontologyKey, 'retriever-agents', lensKey] as const,
} as const
