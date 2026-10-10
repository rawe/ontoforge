import { useMemo } from 'react'
import { useQuery } from '@tanstack/react-query'
import { useParams } from 'react-router-dom'
import { displayLabel, nameProperties } from '@/lib/displayLabel'
import { matchedViaText } from '@/lib/matchedVia'
import * as model from './model'
import * as registry from './registry'
import * as server from './server'
import * as runtime from './runtime'
import { listRetrievers } from './retrievers'
import { qk } from './queryKeys'
import type { AssistantKind, EntityInstance, Matched } from './types'

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
 * include exists. The runtime schema carries no scope information — use
 * this hook for scoped/unscoped decisions.
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

/**
 * Search-index inclusions of a lens (modeling API). Separate from
 * `useLensScope`: index inclusions never make a lens scoped, and only
 * servers with search indices answer this endpoint. The key sits below
 * the scope key, so invalidating the scope refreshes it too.
 */
export function useLensIndexInclusions(
  ontologyKey: string,
  lensId: string,
  enabled: boolean,
) {
  return useQuery({
    queryKey: qk.model(ontologyKey, 'lenses', lensId, 'includes', 'search-indices'),
    queryFn: () => model.listScopeSearchIndices(ontologyKey, lensId),
    enabled,
  })
}

/**
 * Runtime search catalog of a lens — the indices it can search. Keyed below
 * the runtime schema, so scope changes (which invalidate `['schema']`)
 * refresh it too.
 */
export function useSearchCatalog(ontologyKey: string, lensKey: string, enabled: boolean) {
  return useQuery({
    queryKey: [...qk.schema(ontologyKey, lensKey), 'search-indices'] as const,
    queryFn: () => runtime.listSearchCatalog(ontologyKey, lensKey),
    enabled,
    staleTime: 60_000,
  })
}

/** Retrievers of a lens (modeling API, by lens key) with configuration and validation — the Studio's list. */
export function useRetrievers(ontologyKey: string, lensKey: string, enabled = true) {
  return useQuery({
    queryKey: qk.retrievers(ontologyKey, lensKey),
    queryFn: () => listRetrievers(ontologyKey, lensKey),
    enabled: enabled && ontologyKey !== '' && lensKey !== '',
    retry: false,
  })
}

/**
 * A kind's runtime assistant list of a lens — the built-in default first,
 * no configuration or validation. The Workbench pickers and the palette.
 */
export function useAssistants(ontologyKey: string, lensKey: string, kind: AssistantKind, enabled = true) {
  return useQuery({
    queryKey: qk.assistants(ontologyKey, lensKey, kind),
    queryFn: () => runtime.listAssistants(ontologyKey, lensKey, kind),
    enabled: enabled && ontologyKey !== '' && lensKey !== '',
    retry: false,
  })
}

/**
 * "Matched via" text function for search hits in the current workbench
 * route's lens (see `matchedViaText`). The catalog (group labels,
 * document properties) is fetched only from servers with search indices.
 */
export function useMatchedVia(): (matched: Matched | undefined) => string | null {
  const { ontologyKey = '', lensKey = '' } = useParams<{
    ontologyKey: string
    lensKey: string
  }>()
  const supported = useFeatures().data?.searchIndices === true
  const schema = useRuntimeSchema(ontologyKey, lensKey).data
  const catalog = useSearchCatalog(
    ontologyKey,
    lensKey,
    supported && ontologyKey !== '' && lensKey !== '',
  ).data
  return useMemo(
    () => (matched: Matched | undefined) => matchedViaText(matched, schema, catalog),
    [schema, catalog],
  )
}

/**
 * Entity label function for the current workbench route's lens: the entity
 * type's name property value, else the truncated `_id` (see `displayLabel`).
 * Reads the ontology and lens keys from `/o/:ontologyKey/w/:lensKey`.
 */
export function useDisplayLabel(): (entity: EntityInstance) => string {
  const { ontologyKey, lensKey } = useParams<{ ontologyKey: string; lensKey: string }>()
  const schema = useRuntimeSchema(ontologyKey, lensKey).data
  return useMemo(() => {
    const names = nameProperties(schema)
    return (entity: EntityInstance) => displayLabel(entity, names.get(entity._entityTypeKey))
  }, [schema])
}
