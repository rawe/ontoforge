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

/** Modeling lens list (has `lensId` for Studio cross-links). */
export function useLenses() {
  return useQuery({
    queryKey: qk.lenses,
    queryFn: model.listLenses,
  })
}

/**
 * Scope includes of a lens (modeling API). `scoped` is true when any
 * include exists. NOTE: the runtime schema's `lens.includes` field is not
 * populated by the backend — use this hook for scoped/unscoped decisions.
 */
export function useLensScope(lensId: string | undefined) {
  return useQuery({
    queryKey: qk.model('lenses', lensId ?? '', 'includes'),
    queryFn: async () => {
      const [entityTypes, relationTypes] = await Promise.all([
        model.listScopeEntityTypes(lensId!),
        model.listScopeRelationTypes(lensId!),
      ])
      return {
        entityTypes,
        relationTypes,
        scoped: entityTypes.length + relationTypes.length > 0,
      }
    },
    enabled: lensId !== undefined && lensId !== '',
  })
}

/** Runtime schema for one lens — the lens the workbench renders through. */
export function useRuntimeSchema(lensKey: string | undefined) {
  return useQuery({
    queryKey: qk.schema(lensKey ?? ''),
    queryFn: () => runtime.getSchema(lensKey!),
    enabled: lensKey !== undefined && lensKey !== '',
  })
}
