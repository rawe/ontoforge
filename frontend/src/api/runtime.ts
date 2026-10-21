/**
 * Runtime API client — `/api/ontologies/{ontologyKey}/runtime/lenses/{lensKey}/...`,
 * addressed by ontology, lens and type KEY.
 */

import {
  agentReader,
  assistantPath,
  postChat,
  readThread,
  type ChatEvent,
  type ChatRequest,
} from './chatStream'
import { buildQuery, request, type FilterMap } from './http'
import type {
  Anchor,
  AnchorView,
  AssistantKind,
  Changeset,
  ChangesetDetail,
  ChangesetListItem,
  CommitResult,
  DocumentContentResponse,
  EntityInstance,
  JsonValue,
  ListResponse,
  NeighborDirection,
  NeighborsResponse,
  ParentRelationInput,
  PathStep,
  QueryResult,
  RelationInstance,
  RuntimeAssistant,
  RuntimeSchema,
  SavedQuery,
  SavedQuerySearchHit,
  SchemaEntityType,
  SchemaRelationType,
  SearchCatalogEntry,
  SearchResponse,
  SearchStrategy,
  StagedAnswer,
  StageWritePayload,
} from './types'

const base = (ontologyKey: string, lensKey: string) =>
  `/api/ontologies/${ontologyKey}/runtime/lenses/${lensKey}`

/* ---------------------------------- schema ---------------------------------- */

export const getSchema = (ontologyKey: string, lensKey: string) =>
  request<RuntimeSchema>(`${base(ontologyKey, lensKey)}/schema`)

export const getSchemaEntityTypes = (ontologyKey: string, lensKey: string) =>
  request<SchemaEntityType[]>(`${base(ontologyKey, lensKey)}/schema/entity-types`)

export const getSchemaEntityType = (ontologyKey: string, lensKey: string, typeKey: string) =>
  request<SchemaEntityType>(`${base(ontologyKey, lensKey)}/schema/entity-types/${typeKey}`)

export const getSchemaRelationTypes = (ontologyKey: string, lensKey: string) =>
  request<SchemaRelationType[]>(`${base(ontologyKey, lensKey)}/schema/relation-types`)

export const getSchemaRelationType = (ontologyKey: string, lensKey: string, typeKey: string) =>
  request<SchemaRelationType>(`${base(ontologyKey, lensKey)}/schema/relation-types/${typeKey}`)

/* --------------------------------- entities --------------------------------- */

export interface ListEntitiesParams {
  limit?: number
  offset?: number
  sort?: string
  order?: 'asc' | 'desc'
  q?: string
  fields?: readonly string[]
  filter?: FilterMap
}

export const listEntities = (
  ontologyKey: string,
  lensKey: string,
  entityTypeKey: string,
  params?: ListEntitiesParams,
) =>
  request<ListResponse<EntityInstance>>(
    `${base(ontologyKey, lensKey)}/entities/${entityTypeKey}${buildQuery(params)}`,
  )

/** With `parentRelation`, the entity and its parent relation are written in one call. */
export const createEntity = (
  ontologyKey: string,
  lensKey: string,
  entityTypeKey: string,
  properties: Record<string, JsonValue>,
  parentRelation?: ParentRelationInput,
) =>
  request<EntityInstance>(`${base(ontologyKey, lensKey)}/entities/${entityTypeKey}`, {
    method: 'POST',
    body: parentRelation === undefined ? properties : { ...properties, parentRelation },
  })

export const getEntity = (ontologyKey: string, lensKey: string, entityTypeKey: string, id: string) =>
  request<EntityInstance>(`${base(ontologyKey, lensKey)}/entities/${entityTypeKey}/${id}`)

/** Root → … → the entity, through the lens: it starts below the nearest hidden ancestor. */
export const getPath = (ontologyKey: string, lensKey: string, entityTypeKey: string, id: string) =>
  request<PathStep[]>(`${base(ontologyKey, lensKey)}/entities/${entityTypeKey}/${id}/path`)

/** Partial update; an explicit `null` removes a property. */
export const updateEntity = (
  ontologyKey: string,
  lensKey: string,
  entityTypeKey: string,
  id: string,
  properties: Record<string, JsonValue | null>,
) =>
  request<EntityInstance>(`${base(ontologyKey, lensKey)}/entities/${entityTypeKey}/${id}`, {
    method: 'PATCH',
    body: properties,
  })

export const deleteEntity = (ontologyKey: string, lensKey: string, entityTypeKey: string, id: string) =>
  request<undefined>(`${base(ontologyKey, lensKey)}/entities/${entityTypeKey}/${id}`, {
    method: 'DELETE',
  })

/* --------------------------------- documents -------------------------------- */

export interface GetDocumentParams {
  /** Character offset into the document (default 0). */
  offset?: number
  /** Max characters to return; omit for the rest of the document. */
  limit?: number
}

/** Full or sliced content of a document property (stubbed in entity reads). */
export const getDocument = (
  ontologyKey: string,
  lensKey: string,
  entityTypeKey: string,
  id: string,
  propertyKey: string,
  params?: GetDocumentParams,
) =>
  request<DocumentContentResponse>(
    `${base(ontologyKey, lensKey)}/entities/${entityTypeKey}/${id}/documents/${propertyKey}${buildQuery(params)}`,
  )

/* --------------------------------- neighbors -------------------------------- */

export interface NeighborsParams {
  relationTypeKey?: string
  direction?: NeighborDirection
  limit?: number
  fields?: readonly string[]
  relationFields?: readonly string[]
}

export const getNeighbors = (
  ontologyKey: string,
  lensKey: string,
  entityTypeKey: string,
  id: string,
  params?: NeighborsParams,
) =>
  request<NeighborsResponse>(
    `${base(ontologyKey, lensKey)}/entities/${entityTypeKey}/${id}/neighbors${buildQuery(params)}`,
  )

/* --------------------------------- relations -------------------------------- */

export interface ListRelationsParams {
  limit?: number
  offset?: number
  sort?: string
  order?: 'asc' | 'desc'
  fromEntityId?: string
  toEntityId?: string
  filter?: FilterMap
}

export const listRelations = (
  ontologyKey: string,
  lensKey: string,
  relationTypeKey: string,
  params?: ListRelationsParams,
) =>
  request<ListResponse<RelationInstance>>(
    `${base(ontologyKey, lensKey)}/relations/${relationTypeKey}${buildQuery(params)}`,
  )

export const createRelation = (
  ontologyKey: string,
  lensKey: string,
  relationTypeKey: string,
  body: { fromEntityId: string; toEntityId: string } & Record<string, JsonValue>,
) =>
  request<RelationInstance>(`${base(ontologyKey, lensKey)}/relations/${relationTypeKey}`, {
    method: 'POST',
    body,
  })

export const getRelation = (ontologyKey: string, lensKey: string, relationTypeKey: string, id: string) =>
  request<RelationInstance>(`${base(ontologyKey, lensKey)}/relations/${relationTypeKey}/${id}`)

/** Props only — endpoints are immutable. */
export const updateRelation = (
  ontologyKey: string,
  lensKey: string,
  relationTypeKey: string,
  id: string,
  properties: Record<string, JsonValue | null>,
) =>
  request<RelationInstance>(`${base(ontologyKey, lensKey)}/relations/${relationTypeKey}/${id}`, {
    method: 'PATCH',
    body: properties,
  })

export const deleteRelation = (
  ontologyKey: string,
  lensKey: string,
  relationTypeKey: string,
  id: string,
) =>
  request<undefined>(`${base(ontologyKey, lensKey)}/relations/${relationTypeKey}/${id}`, {
    method: 'DELETE',
  })

/* ---------------------------------- search ---------------------------------- */

export interface SearchParams {
  q: string
  type?: string
  in?: readonly ('properties' | 'document')[]
  strategy?: SearchStrategy
  'document.property'?: string
  limit?: number
  fields?: readonly string[]
  filter?: FilterMap
}
export const search = (ontologyKey: string, lensKey: string, params: SearchParams) =>
  request<SearchResponse>(`${base(ontologyKey, lensKey)}/search${buildQuery(params)}`)

/** The search indices this lens can search. */
export const listSearchCatalog = (ontologyKey: string, lensKey: string) =>
  request<SearchCatalogEntry[]>(`${base(ontologyKey, lensKey)}/search-indices`)

/* ----------------------------------- query ----------------------------------- */

/** Run a read-only OQL query against the lens. */
export const runQuery = (ontologyKey: string, lensKey: string, query: string) =>
  request<QueryResult>(`${base(ontologyKey, lensKey)}/query`, {
    method: 'POST',
    body: { query },
  })

/* -------------------------------- saved queries ------------------------------ */

export const listSavedQueries = (ontologyKey: string, lensKey: string) =>
  request<SavedQuery[]>(`${base(ontologyKey, lensKey)}/saved-queries`)

export const searchSavedQueries = (
  ontologyKey: string,
  lensKey: string,
  params: { q: string; limit?: number; minScore?: number },
) =>
  request<SavedQuerySearchHit[]>(
    `${base(ontologyKey, lensKey)}/saved-queries/search${buildQuery({
      q: params.q,
      limit: params.limit,
      min_score: params.minScore,
    })}`,
  )

export const runSavedQuery = (
  ontologyKey: string,
  lensKey: string,
  queryKey: string,
  params: Record<string, JsonValue>,
) =>
  request<QueryResult>(`${base(ontologyKey, lensKey)}/saved-queries/${queryKey}/run`, {
    method: 'POST',
    body: { params },
  })

/* ---------------------------------- anchors ---------------------------------- */

// Maintenance is lensless: anchors belong to the ontology.
const anchorsBase = (ontologyKey: string) => `/api/ontologies/${ontologyKey}/runtime/anchors`

export const listAnchors = (ontologyKey: string) => request<Anchor[]>(anchorsBase(ontologyKey))

/**
 * Create or re-point (200 both); `null` unanchors. A missing entity answers 422.
 * Without `stagedOnly` the stored flag stays.
 */
export const putAnchor = (
  ontologyKey: string,
  anchorKey: string,
  entity: { type: string; id: string } | null,
  stagedOnly?: boolean,
) =>
  request<Anchor>(`${anchorsBase(ontologyKey)}/${anchorKey}`, {
    method: 'PUT',
    body: stagedOnly === undefined ? { entity } : { entity, stagedOnly },
  })

export const deleteAnchor = (ontologyKey: string, anchorKey: string) =>
  request<undefined>(`${anchorsBase(ontologyKey)}/${anchorKey}`, { method: 'DELETE' })

/** The anchored mount's root: the anchor with its entity's name and path through the lens. */
export const getAnchorView = (ontologyKey: string, lensKey: string, anchorKey: string) =>
  request<AnchorView>(`${base(ontologyKey, lensKey)}/anchors/${anchorKey}`)

/* ------------------------------------- AI ------------------------------------ */

/** A kind's runtime list: every assistant of the lens, the built-in default (`_default`) first. */
export const listAssistants = (ontologyKey: string, lensKey: string, kind: AssistantKind) =>
  request<RuntimeAssistant[]>(assistantPath(ontologyKey, lensKey, kind))

/** One message to an agent (`_default` included); without `threadId` it starts a new thread. */
export const agentChat = (
  ontologyKey: string,
  lensKey: string,
  agentKey: string,
  body: ChatRequest,
  onEvent: (event: ChatEvent) => void,
  signal: AbortSignal,
) =>
  postChat(assistantPath(ontologyKey, lensKey, 'agents', agentKey), body, agentReader(), onEvent, signal)

/** A thread of one assistant read back. */
export const readAssistantThread = (
  ontologyKey: string,
  lensKey: string,
  kind: AssistantKind,
  assistantKey: string,
  threadId: string,
  signal?: AbortSignal,
) => readThread(assistantPath(ontologyKey, lensKey, kind, assistantKey), threadId, signal)

/* -------------------------------- changesets -------------------------------- */

// The plain lens URL: every changeset of the lens, anchored ones included.
const changesetsBase = (ontologyKey: string, lensKey: string) =>
  `${base(ontologyKey, lensKey)}/changesets`

/** A new draft changeset on the plain lens, so never held to an anchor. */
export const startChangeset = (ontologyKey: string, lensKey: string, note?: string) =>
  request<Changeset>(changesetsBase(ontologyKey, lensKey), {
    method: 'POST',
    body: note === undefined ? {} : { note },
  })

/** The lens's changesets, submitted first. */
export const listChangesets = (ontologyKey: string, lensKey: string) =>
  request<ChangesetListItem[]>(changesetsBase(ontologyKey, lensKey))

/** The review read: the changeset and its writes by seq, `limit` at most 500. */
export const getChangeset = (
  ontologyKey: string,
  lensKey: string,
  changesetId: string,
  params: { offset: number; limit: number },
) =>
  request<ChangesetDetail>(
    `${changesetsBase(ontologyKey, lensKey)}/${changesetId}${buildQuery(params)}`,
  )

/**
 * Persists every staged write or none. A changed version answers 409; a
 * rejection answers 422 with `details.violations` and `details.total`.
 */
export const commitChangeset = (
  ontologyKey: string,
  lensKey: string,
  changesetId: string,
  expectedVersion: number,
) =>
  request<CommitResult>(`${changesetsBase(ontologyKey, lensKey)}/${changesetId}/commit`, {
    method: 'POST',
    body: { expectedVersion },
  })

/**
 * Freezes a draft for review; a fault answers 422 with `details.violations`.
 * A note replaces the stored one; without it the stored one stays.
 */
export const submitChangeset = (
  ontologyKey: string,
  lensKey: string,
  changesetId: string,
  note?: string,
) =>
  request<Changeset>(`${changesetsBase(ontologyKey, lensKey)}/${changesetId}/submit`, {
    method: 'POST',
    body: note === undefined ? {} : { note },
  })

/** Back to draft; the note is required and replaces the stored one. */
export const unsubmitChangeset = (
  ontologyKey: string,
  lensKey: string,
  changesetId: string,
  note: string,
) =>
  request<Changeset>(`${changesetsBase(ontologyKey, lensKey)}/${changesetId}/unsubmit`, {
    method: 'POST',
    body: { note },
  })

/** The text a commit would leave in a document property: from the last
 * staged write of the changeset that sets it; 404 when none does. */
export const getStagedDocument = (
  ontologyKey: string,
  lensKey: string,
  changesetId: string,
  entityTypeKey: string,
  id: string,
  propertyKey: string,
  params?: GetDocumentParams,
) =>
  request<DocumentContentResponse>(
    `${changesetsBase(ontologyKey, lensKey)}/${changesetId}/documents/${entityTypeKey}/${id}/${propertyKey}${buildQuery(params)}`,
  )

/** Draft only; a submitted changeset answers 409. */
export const discardChangeset = (ontologyKey: string, lensKey: string, changesetId: string) =>
  request<undefined>(`${changesetsBase(ontologyKey, lensKey)}/${changesetId}`, {
    method: 'DELETE',
  })

/** Takes one staged write out, draft only. */
export const unstageWrite = (
  ontologyKey: string,
  lensKey: string,
  changesetId: string,
  seq: number,
) =>
  request<undefined>(`${changesetsBase(ontologyKey, lensKey)}/${changesetId}/writes/${seq}`, {
    method: 'DELETE',
  })

/** Appends one write to a draft; a busy changeset (another call staging) answers 409. */
export const stageWrite = (
  ontologyKey: string,
  lensKey: string,
  changesetId: string,
  payload: StageWritePayload,
) =>
  request<StagedAnswer>(`${changesetsBase(ontologyKey, lensKey)}/${changesetId}/writes`, {
    method: 'POST',
    body: payload,
  })
