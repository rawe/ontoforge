import { useMemo } from 'react'
import { queryOptions, useQuery } from '@tanstack/react-query'
import { useParams } from 'react-router-dom'
import { displayLabel, nameProperties } from '@/lib/displayLabel'
import { matchedViaText } from '@/lib/matchedVia'
import * as auth from './auth'
import * as model from './model'
import * as registry from './registry'
import * as server from './server'
import * as runtime from './runtime'
import { listNavigators } from './navigators'
import { listRetrievers } from './retrievers'
import { qk } from './queryKeys'
import type { AssistantKind, EntityInstance, Matched } from './types'

/** The authentication mode and the signed-in user; refetched when a request answers 401. */
export function useAuthMe() {
  return useQuery({ queryKey: qk.auth.me, queryFn: auth.getMe })
}

/** Where clients reach the server, and its version — fetched once, never stale. */
export function useServerInfo() {
  return useQuery({
    queryKey: qk.serverInfo,
    queryFn: server.getServerInfo,
    staleTime: Infinity,
  })
}

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
 * this hook for scoped/unscoped decisions. The query options are shared
 * with the lens pick of the Studio ↔ Workbench switch.
 */
export function lensScopeQuery(ontologyKey: string, lensId: string) {
  return queryOptions({
    queryKey: qk.model(ontologyKey, 'lenses', lensId, 'includes'),
    queryFn: async () => {
      const [entityTypes, relationTypes] = await Promise.all([
        model.listScopeEntityTypes(ontologyKey, lensId),
        model.listScopeRelationTypes(ontologyKey, lensId),
      ])
      return {
        entityTypes,
        relationTypes,
        scoped: entityTypes.length + relationTypes.length > 0,
      }
    },
  })
}

export function useLensScope(ontologyKey: string | undefined, lensId: string | undefined) {
  return useQuery({
    ...lensScopeQuery(ontologyKey ?? '', lensId ?? ''),
    enabled:
      ontologyKey !== undefined &&
      ontologyKey !== '' &&
      lensId !== undefined &&
      lensId !== '',
  })
}

/** Runtime schema for one lens — the lens the workbench renders through. */
export function runtimeSchemaQuery(ontologyKey: string, lensKey: string) {
  return queryOptions({
    queryKey: qk.schema(ontologyKey, lensKey),
    queryFn: () => runtime.getSchema(ontologyKey, lensKey),
  })
}

export function useRuntimeSchema(
  ontologyKey: string | undefined,
  lensKey: string | undefined,
) {
  return useQuery({
    ...runtimeSchemaQuery(ontologyKey ?? '', lensKey ?? ''),
    enabled:
      ontologyKey !== undefined &&
      ontologyKey !== '' &&
      lensKey !== undefined &&
      lensKey !== '',
  })
}

/** The ontology's rulesets (lensless): the Rulesets page, its sidebar count, the entity chip. */
export function useRulesets(ontologyKey: string | undefined) {
  return useQuery({
    queryKey: qk.rulesets(ontologyKey ?? ''),
    queryFn: () => runtime.listRulesets(ontologyKey!),
    enabled: ontologyKey !== undefined && ontologyKey !== '',
  })
}

/** One ruleset seen through a lens: its mount's root, with the anchor's name and path. */
export function useRulesetView(ontologyKey: string, lensKey: string, rulesetKey: string) {
  return useQuery({
    queryKey: qk.rulesets(ontologyKey, lensKey, rulesetKey),
    queryFn: () => runtime.getRulesetView(ontologyKey, lensKey, rulesetKey),
  })
}

/** The lens's changesets: the Changesets page, its detail header and the sidebar count. */
export function useChangesets(ontologyKey: string | undefined, lensKey: string | undefined) {
  return useQuery({
    queryKey: qk.changesets(ontologyKey ?? '', lensKey ?? ''),
    queryFn: () => runtime.listChangesets(ontologyKey!, lensKey!),
    enabled: ontologyKey !== undefined && ontologyKey !== '' && lensKey !== undefined && lensKey !== '',
  })
}

/** One changeset's review read: a page of its staged objects by first touch, with names and markers. */
export function useChangeset(
  ontologyKey: string,
  lensKey: string,
  changesetId: string,
  page: { offset: number; limit: number },
  /** False once the changeset is gone (committed, discarded): no refetch into a 404. */
  enabled = true,
) {
  return useQuery({
    queryKey: qk.changesets(ontologyKey, lensKey, changesetId, page),
    queryFn: () => runtime.getChangeset(ontologyKey, lensKey, changesetId, page),
    enabled,
    // Keep the shown page while the next loads, but never another changeset's.
    placeholderData: (previous) => (previous?.id === changesetId ? previous : undefined),
  })
}

/**
 * One entity as the pinned changeset leaves it, with its staged object;
 * nothing pinned, nothing read. Under the changeset's key, so every change of
 * the changeset refreshes it.
 */
export function useStagedEntity(
  ontologyKey: string,
  lensKey: string,
  changesetId: string | null,
  typeKey: string,
  id: string,
) {
  return useQuery({
    queryKey: qk.changesets(ontologyKey, lensKey, changesetId ?? '', ['entity', typeKey, id]),
    queryFn: () => runtime.getStagedEntity(ontologyKey, lensKey, changesetId!, typeKey, id),
    enabled: changesetId !== null,
  })
}

/**
 * Search-index inclusions of a lens (modeling API). Separate from
 * `useLensScope`: index inclusions never make a lens scoped. The key sits
 * below the scope key, so invalidating the scope refreshes it too.
 */
export function useLensIndexInclusions(ontologyKey: string, lensId: string) {
  return useQuery({
    queryKey: qk.model(ontologyKey, 'lenses', lensId, 'includes', 'search-indices'),
    queryFn: () => model.listScopeSearchIndices(ontologyKey, lensId),
  })
}

/**
 * Runtime search catalog of a lens — the indices it can search. Keyed below
 * the runtime schema, so scope changes (which invalidate `['schema']`)
 * refresh it too.
 */
export function useSearchCatalog(ontologyKey: string, lensKey: string, enabled = true) {
  return useQuery({
    queryKey: [...qk.schema(ontologyKey, lensKey), 'search-indices'] as const,
    queryFn: () => runtime.listSearchCatalog(ontologyKey, lensKey),
    enabled,
    staleTime: 60_000,
  })
}

/** Retrievers of a lens (modeling API, by lens key) with configuration and validation — the Studio's list. */
export function useRetrievers(ontologyKey: string, lensKey: string) {
  return useQuery({
    queryKey: qk.retrievers(ontologyKey, lensKey),
    queryFn: () => listRetrievers(ontologyKey, lensKey),
    enabled: ontologyKey !== '' && lensKey !== '',
    retry: false,
  })
}

/** Navigators of a lens (modeling API, by lens key) with configuration and validation — the Studio's list. */
export function useNavigators(ontologyKey: string, lensKey: string) {
  return useQuery({
    queryKey: qk.navigators(ontologyKey, lensKey),
    queryFn: () => listNavigators(ontologyKey, lensKey),
    enabled: ontologyKey !== '' && lensKey !== '',
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
 * route's lens (see `matchedViaText`). The catalog supplies group labels
 * and document properties.
 */
export function useMatchedVia(): (matched: Matched | undefined) => string | null {
  const { ontologyKey = '', lensKey = '' } = useParams<{
    ontologyKey: string
    lensKey: string
  }>()
  const schema = useRuntimeSchema(ontologyKey, lensKey).data
  const catalog = useSearchCatalog(ontologyKey, lensKey, ontologyKey !== '' && lensKey !== '').data
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
