/**
 * Query hooks for search indices (modeling API). Keys live under
 * `['model', ontologyKey, …]`, so every modeling mutation
 * (`invalidateModeling`) refreshes them too.
 *
 * Build status is asynchronous: while any shown index is building or
 * stale, its query polls every few seconds; otherwise nothing polls.
 */

import {
  keepPreviousData,
  useMutation,
  useQueries,
  useQuery,
  useQueryClient,
} from '@tanstack/react-query'
import {
  anyBusy,
  isBusyState,
  toggleDisabledIndex,
  type IndexSchema,
} from '@/components/search/searchIndexModel'
import * as model from './model'
import { qk } from './queryKeys'
import type { PropertyDefinition, SearchIndexDraftInput, SearchSettings } from './types'

/** Status refresh interval while an index is building or stale (D18). */
export const STATUS_POLL_MS = 3_000

export const searchKeys = {
  list: (ontologyKey: string) => qk.model(ontologyKey, 'search-indices'),
  index: (ontologyKey: string, key: string) => qk.model(ontologyKey, 'search-indices', key),
  status: (ontologyKey: string, key: string) =>
    qk.model(ontologyKey, 'search-indices', key, 'status'),
  settings: (ontologyKey: string) => qk.model(ontologyKey, 'search-settings'),
  preview: (ontologyKey: string, input: SearchIndexDraftInput | null) =>
    qk.model(ontologyKey, 'search-index-preview', input),
}

/** Managed + custom indices; polls while any of them is building or stale. */
export function useSearchIndices(ontologyKey: string, enabled = true) {
  return useQuery({
    queryKey: searchKeys.list(ontologyKey),
    queryFn: () => model.listSearchIndices(ontologyKey),
    enabled,
    refetchInterval: (query) => (anyBusy(query.state.data) ? STATUS_POLL_MS : false),
  })
}

export function useSearchIndex(ontologyKey: string, key: string | undefined) {
  return useQuery({
    queryKey: searchKeys.index(ontologyKey, key ?? ''),
    queryFn: () => model.getSearchIndex(ontologyKey, key!),
    enabled: key !== undefined,
  })
}

/** Status of one index; polls while it is building or stale. */
export function useSearchIndexStatus(ontologyKey: string, key: string | undefined) {
  return useQuery({
    queryKey: searchKeys.status(ontologyKey, key ?? ''),
    queryFn: () => model.getSearchIndexStatus(ontologyKey, key!),
    enabled: key !== undefined,
    refetchInterval: (query) =>
      query.state.data !== undefined && isBusyState(query.state.data.state)
        ? STATUS_POLL_MS
        : false,
  })
}

export function useSearchSettings(ontologyKey: string, enabled = true) {
  return useQuery({
    queryKey: searchKeys.settings(ontologyKey),
    queryFn: () => model.getSearchSettings(ontologyKey),
    enabled,
  })
}

/** Cost preview + validation issues of a draft; `null` input → no request. */
export function useSearchIndexPreview(
  ontologyKey: string,
  input: SearchIndexDraftInput | null,
) {
  return useQuery({
    queryKey: searchKeys.preview(ontologyKey, input),
    queryFn: () => model.previewSearchIndex(ontologyKey, input!),
    enabled: input !== null,
    placeholderData: keepPreviousData,
  })
}

/**
 * Write search settings. The answer replaces the cached settings; index
 * statuses change with it (languages → new keyword generations, switches →
 * on/off), so index queries are refetched.
 */
export function useUpdateSearchSettings(ontologyKey: string) {
  const queryClient = useQueryClient()
  return useMutation({
    mutationFn: (patch: Partial<SearchSettings>) =>
      model.updateSearchSettings(ontologyKey, patch),
    onSuccess: (saved) => {
      queryClient.setQueryData(searchKeys.settings(ontologyKey), saved)
      void queryClient.invalidateQueries({ queryKey: searchKeys.list(ontologyKey) })
    },
  })
}

/** Switch a managed index on or off through `disabledIndices`. */
export function useSwitchManagedIndex(ontologyKey: string) {
  const settings = useSearchSettings(ontologyKey)
  const update = useUpdateSearchSettings(ontologyKey)
  return {
    pending: update.isPending,
    ready: settings.data !== undefined,
    switchIndex: (key: string, enabled: boolean) => {
      const current = settings.data
      if (current === undefined) return Promise.resolve(undefined)
      return update.mutateAsync({
        disabledIndices: toggleDisabledIndex(current.disabledIndices, key, enabled),
      })
    },
  }
}

/** Start a rebuild; the returned status seeds the status cache (and its polling). */
export function useRebuildSearchIndex(ontologyKey: string) {
  const queryClient = useQueryClient()
  return useMutation({
    mutationFn: (key: string) => model.rebuildSearchIndex(ontologyKey, key),
    onSuccess: (status, key) => {
      queryClient.setQueryData(searchKeys.status(ontologyKey, key), status)
      void queryClient.invalidateQueries({ queryKey: searchKeys.list(ontologyKey) })
    },
  })
}

/**
 * The modeling schema an index designer reads: entity and relation types
 * with their properties. Shares the type editor's cache keys.
 */
export function useIndexSchema(ontologyKey: string): IndexSchema | undefined {
  const entityTypes = useQuery({
    queryKey: qk.model(ontologyKey, 'entity-types'),
    queryFn: () => model.listEntityTypes(ontologyKey),
  }).data
  const relationTypes = useQuery({
    queryKey: qk.model(ontologyKey, 'relation-types'),
    queryFn: () => model.listRelationTypes(ontologyKey),
  }).data
  const entityProps = useQueries({
    queries: (entityTypes ?? []).map((t) => ({
      queryKey: qk.model(ontologyKey, 'entity-types', t.entityTypeId, 'properties'),
      queryFn: () => model.listProperties(ontologyKey, 'entity-types', t.entityTypeId),
    })),
  })
  const relationProps = useQueries({
    queries: (relationTypes ?? []).map((t) => ({
      queryKey: qk.model(ontologyKey, 'relation-types', t.relationTypeId, 'properties'),
      queryFn: () => model.listProperties(ontologyKey, 'relation-types', t.relationTypeId),
    })),
  })

  const entityData = entityProps.map((q) => q.data)
  const relationData = relationProps.map((q) => q.data)
  if (
    entityTypes === undefined ||
    relationTypes === undefined ||
    entityData.some((d) => d === undefined) ||
    relationData.some((d) => d === undefined)
  ) {
    return undefined
  }
  const pick = ({ key, displayName, dataType }: PropertyDefinition) => ({
    key,
    displayName,
    dataType,
  })
  return {
    entityTypes: entityTypes.map((t, i) => ({
      key: t.key,
      displayName: t.displayName,
      nameProperty: t.nameProperty,
      properties: (entityData[i] ?? []).map(pick),
    })),
    relationTypes: relationTypes.map((t, i) => ({
      key: t.key,
      displayName: t.displayName,
      sourceEntityTypeKey: t.sourceEntityTypeKey,
      targetEntityTypeKey: t.targetEntityTypeKey,
      properties: (relationData[i] ?? []).map(pick),
    })),
  }
}
