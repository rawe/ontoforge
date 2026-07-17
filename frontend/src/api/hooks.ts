import { useQuery } from '@tanstack/react-query'
import * as model from './model'
import * as runtime from './runtime'
import { qk } from './queryKeys'

/** Global feature flags — fetched once, never stale. */
export function useFeatures() {
  return useQuery({
    queryKey: qk.features,
    queryFn: runtime.getFeatures,
    staleTime: Infinity,
  })
}

/** Modeling ontology list (has `ontologyId` for Studio cross-links). */
export function useOntologies() {
  return useQuery({
    queryKey: qk.ontologies,
    queryFn: model.listOntologies,
  })
}

/**
 * Scope includes of an ontology (modeling API). `scoped` is true when any
 * include exists. NOTE: the runtime schema's `ontology.includes` field is not
 * populated by the backend — use this hook for scoped/unscoped decisions.
 */
export function useOntologyScope(ontologyId: string | undefined) {
  return useQuery({
    queryKey: qk.model('ontologies', ontologyId ?? '', 'includes'),
    queryFn: async () => {
      const [entityTypes, relationTypes] = await Promise.all([
        model.listScopeEntityTypes(ontologyId!),
        model.listScopeRelationTypes(ontologyId!),
      ])
      return {
        entityTypes,
        relationTypes,
        scoped: entityTypes.length + relationTypes.length > 0,
      }
    },
    enabled: ontologyId !== undefined && ontologyId !== '',
  })
}

/** Runtime schema for one ontology — the lens the workbench renders through. */
export function useRuntimeSchema(ontologyKey: string | undefined) {
  return useQuery({
    queryKey: qk.schema(ontologyKey ?? ''),
    queryFn: () => runtime.getSchema(ontologyKey!),
    enabled: ontologyKey !== undefined && ontologyKey !== '',
  })
}
