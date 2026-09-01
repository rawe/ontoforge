import { useQuery } from '@tanstack/react-query'
import * as model from './model'
import * as registry from './registry'
import * as server from './server'
import * as runtime from './runtime'
import { qk } from './queryKeys'

/** Global feature flags — fetched once, never stale. */
export function useFeatures() {
  return useQuery({
    queryKey: qk.features,
    queryFn: server.getFeatures,
    staleTime: Infinity,
  })
}

/** Registry ontology list — feeds the ontology switchers. */
export function useOntologies() {
  return useQuery({
    queryKey: qk.ontologies,
    queryFn: registry.listOntologies,
  })
}

/** Modeling lens list of one ontology (has `lensId` for Studio cross-links). */
export function useLenses(ontologyKey: string | undefined) {
  return useQuery({
    queryKey: qk.lenses(ontologyKey ?? ''),
    queryFn: () => model.listLenses(ontologyKey!),
    enabled: ontologyKey !== undefined && ontologyKey !== '',
  })
}

/**
 * Scope includes of a lens (modeling API). `scoped` is true when any
 * include exists. NOTE: the runtime schema's `lens.includes` field is not
 * populated by the backend — use this hook for scoped/unscoped decisions.
 */
export function useLensScope(ontologyKey: string | undefined, lensId: string | undefined) {
  return useQuery({
    queryKey: qk.model(ontologyKey ?? '', 'lenses', lensId ?? '', 'includes'),
    queryFn: async () => {
      const [entityTypes, relationTypes] = await Promise.all([
        model.listScopeEntityTypes(ontologyKey!, lensId!),
        model.listScopeRelationTypes(ontologyKey!, lensId!),
      ])
      return {
        entityTypes,
        relationTypes,
        scoped: entityTypes.length + relationTypes.length > 0,
      }
    },
    enabled:
      ontologyKey !== undefined &&
      ontologyKey !== '' &&
      lensId !== undefined &&
      lensId !== '',
  })
}

/** Runtime schema for one lens — the lens the workbench renders through. */
export function useRuntimeSchema(
  ontologyKey: string | undefined,
  lensKey: string | undefined,
) {
  return useQuery({
    queryKey: qk.schema(ontologyKey ?? '', lensKey ?? ''),
    queryFn: () => runtime.getSchema(ontologyKey!, lensKey!),
    enabled:
      ontologyKey !== undefined &&
      ontologyKey !== '' &&
      lensKey !== undefined &&
      lensKey !== '',
  })
}
