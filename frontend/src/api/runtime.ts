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
  AssistantKind,
  Changeset,
  ChangesetDetail,
  ChangesetListItem,
  CheckResult,
  CommitResult,
  DocumentContentResponse,
  EntityInstance,
  EntitySearchBody,
  EntitySearchResponse,
  JsonValue,
  ListResponse,
  NeighborDirection,
  NeighborsResponse,
  ParentRelationInput,
  PassageSearchBody,
  PassageSearchResponse,
  PathStep,
  QueryResult,
  RelationInstance,
  Ruleset,
  RulesetPatch,
  RulesetView,
  RuntimeAssistant,
  RuntimeSchema,
  SavedQuery,
  SavedQuerySearchHit,
  SchemaEntityType,
  SchemaRelationType,
  SearchCatalogEntry,
  StagedAnswer,
  StagedEntity,
  StagedObjectView,
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

/** The search indices this lens can search. */
export const listSearchCatalog = (ontologyKey: string, lensKey: string) =>
  request<SearchCatalogEntry[]>(`${base(ontologyKey, lensKey)}/search-indices`)

/** Rank entities for a query text through a scope of search indices. */
export const searchEntities = (ontologyKey: string, lensKey: string, body: EntitySearchBody) =>
  request<EntitySearchResponse>(`${base(ontologyKey, lensKey)}/search/entities`, {
    method: 'POST',
    body,
  })

/** Rank passages of documents for a query text through a scope of search indices. */
export const searchPassages = (ontologyKey: string, lensKey: string, body: PassageSearchBody) =>
  request<PassageSearchResponse>(`${base(ontologyKey, lensKey)}/search/passages`, {
    method: 'POST',
    body,
  })

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
  // The last step's output: OQL rows, or an entity search response.
  request<QueryResult | EntitySearchResponse>(`${base(ontologyKey, lensKey)}/saved-queries/${queryKey}/run`, {
    method: 'POST',
    body: { params },
  })

/* ---------------------------------- rulesets --------------------------------- */

// Maintenance is lensless: rulesets belong to the ontology.
const rulesetsBase = (ontologyKey: string) => `/api/ontologies/${ontologyKey}/runtime/rulesets`

export const listRulesets = (ontologyKey: string) => request<Ruleset[]>(rulesetsBase(ontologyKey))

/** Create or change (200 both): the patch names only the rules that change. A missing entity answers 422. */
export const putRuleset = (ontologyKey: string, rulesetKey: string, patch: RulesetPatch) =>
  request<Ruleset>(`${rulesetsBase(ontologyKey)}/${rulesetKey}`, { method: 'PUT', body: patch })

export const deleteRuleset = (ontologyKey: string, rulesetKey: string) =>
  request<undefined>(`${rulesetsBase(ontologyKey)}/${rulesetKey}`, { method: 'DELETE' })

/** The ruleset mount's root: the rules, with the anchor's name and path through the lens. */
export const getRulesetView = (ontologyKey: string, lensKey: string, rulesetKey: string) =>
  request<RulesetView>(`${base(ontologyKey, lensKey)}/rulesets/${rulesetKey}`)

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

// The plain lens URL: every changeset of the lens, those started through a ruleset included.
const changesetsBase = (ontologyKey: string, lensKey: string) =>
  `${base(ontologyKey, lensKey)}/changesets`

/** A new draft changeset on the plain lens, so started through no ruleset. */
export const startChangeset = (ontologyKey: string, lensKey: string, note?: string) =>
  request<Changeset>(changesetsBase(ontologyKey, lensKey), {
    method: 'POST',
    body: note === undefined ? {} : { note },
  })

/** The lens's changesets, by number, lowest first. */
export const listChangesets = (ontologyKey: string, lensKey: string) =>
  request<ChangesetListItem[]>(changesetsBase(ontologyKey, lensKey))

/** The review read: the changeset and a page of its staged objects by first touch, `limit` at most 500. */
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
 * Applies every staged object or none. A changed version answers 409; a
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
 * Runs the commit and rolls it back, draft or submitted: nothing changes. A
 * rejection answers 422 as the commit's, with `details.version` added.
 */
export const checkChangeset = (ontologyKey: string, lensKey: string, changesetId: string) =>
  request<CheckResult>(`${changesetsBase(ontologyKey, lensKey)}/${changesetId}/check`, { method: 'POST' })

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

/** The text a commit would leave in a document property: its staged value;
 * 404 when the changeset stages none. */
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

/** One entity as a commit would leave it, with its staged object; 404
 * when the changeset is gone or the entity is neither stored nor created by it. */
export const getStagedEntity = (
  ontologyKey: string,
  lensKey: string,
  changesetId: string,
  entityTypeKey: string,
  id: string,
) =>
  request<StagedEntity>(
    `${changesetsBase(ontologyKey, lensKey)}/${changesetId}/entities/${entityTypeKey}/${id}`,
  )

/** Draft only; a submitted changeset answers 409. */
export const discardChangeset = (ontologyKey: string, lensKey: string, changesetId: string) =>
  request<undefined>(`${changesetsBase(ontologyKey, lensKey)}/${changesetId}`, {
    method: 'DELETE',
  })

const objectPath = (ontologyKey: string, lensKey: string, changesetId: string, objectId: string) =>
  `${changesetsBase(ontologyKey, lensKey)}/${changesetId}/objects/${objectId}`

/** Removes one staged object with its values, draft only. */
export const unstageObject = (ontologyKey: string, lensKey: string, changesetId: string, objectId: string) =>
  request<undefined>(objectPath(ontologyKey, lensKey, changesetId, objectId), { method: 'DELETE' })

/** Cuts one staged value of an object, draft only; an update left with none is removed. */
export const cutValue = (
  ontologyKey: string,
  lensKey: string,
  changesetId: string,
  objectId: string,
  propertyKey: string,
) =>
  request<undefined>(`${objectPath(ontologyKey, lensKey, changesetId, objectId)}/properties/${propertyKey}`, {
    method: 'DELETE',
  })

/** Accepts the stored values now as the befores of an update's values (all, or `properties`); draft only. */
export const rebaseObject = (
  ontologyKey: string,
  lensKey: string,
  changesetId: string,
  objectId: string,
  properties?: string[],
) =>
  request<StagedObjectView>(`${objectPath(ontologyKey, lensKey, changesetId, objectId)}/rebase`, {
    method: 'POST',
    body: properties === undefined ? {} : { properties },
  })

/** Stages one call into a draft: it merges into the object it touches. A busy changeset answers 409. */
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
