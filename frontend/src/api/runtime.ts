/**
 * Runtime API client — `/api/runtime/...`, addressed by lens/type KEY.
 */

import { buildQuery, request, type FilterMap } from './http'
import type {
  AiAgent,
  AiQueryResponse,
  ChatMessage,
  ChatResponse,
  DocumentContentResponse,
  EntityInstance,
  ExtractResponse,
  Features,
  JsonValue,
  ListResponse,
  NeighborDirection,
  NeighborsResponse,
  QueryResult,
  RelationInstance,
  RuntimeSchema,
  SavedQuery,
  SavedQuerySearchHit,
  SchemaEntityType,
  SchemaRelationType,
  SemanticSearchResponse,
} from './types'

const base = (lensKey: string) => `/api/runtime/${lensKey}`

/* --------------------------------- features --------------------------------- */

export const getFeatures = () => request<Features>('/api/runtime/features')

/* ---------------------------------- schema ---------------------------------- */

export const getSchema = (lensKey: string) =>
  request<RuntimeSchema>(`${base(lensKey)}/schema`)

export const getSchemaEntityTypes = (lensKey: string) =>
  request<SchemaEntityType[]>(`${base(lensKey)}/schema/entity-types`)

export const getSchemaEntityType = (lensKey: string, typeKey: string) =>
  request<SchemaEntityType>(`${base(lensKey)}/schema/entity-types/${typeKey}`)

export const getSchemaRelationTypes = (lensKey: string) =>
  request<SchemaRelationType[]>(`${base(lensKey)}/schema/relation-types`)

export const getSchemaRelationType = (lensKey: string, typeKey: string) =>
  request<SchemaRelationType>(`${base(lensKey)}/schema/relation-types/${typeKey}`)

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
  lensKey: string,
  entityTypeKey: string,
  params?: ListEntitiesParams,
) =>
  request<ListResponse<EntityInstance>>(
    `${base(lensKey)}/entities/${entityTypeKey}${buildQuery(params)}`,
  )

export const createEntity = (
  lensKey: string,
  entityTypeKey: string,
  properties: Record<string, JsonValue>,
) =>
  request<EntityInstance>(`${base(lensKey)}/entities/${entityTypeKey}`, {
    method: 'POST',
    body: properties,
  })

export const getEntity = (lensKey: string, entityTypeKey: string, id: string) =>
  request<EntityInstance>(`${base(lensKey)}/entities/${entityTypeKey}/${id}`)

/** Partial update; an explicit `null` removes a property. */
export const updateEntity = (
  lensKey: string,
  entityTypeKey: string,
  id: string,
  properties: Record<string, JsonValue | null>,
) =>
  request<EntityInstance>(`${base(lensKey)}/entities/${entityTypeKey}/${id}`, {
    method: 'PATCH',
    body: properties,
  })

export const deleteEntity = (lensKey: string, entityTypeKey: string, id: string) =>
  request<undefined>(`${base(lensKey)}/entities/${entityTypeKey}/${id}`, {
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
  lensKey: string,
  entityTypeKey: string,
  id: string,
  propertyKey: string,
  params?: GetDocumentParams,
) =>
  request<DocumentContentResponse>(
    `${base(lensKey)}/entities/${entityTypeKey}/${id}/documents/${propertyKey}${buildQuery(params)}`,
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
  lensKey: string,
  entityTypeKey: string,
  id: string,
  params?: NeighborsParams,
) =>
  request<NeighborsResponse>(
    `${base(lensKey)}/entities/${entityTypeKey}/${id}/neighbors${buildQuery(params)}`,
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
  lensKey: string,
  relationTypeKey: string,
  params?: ListRelationsParams,
) =>
  request<ListResponse<RelationInstance>>(
    `${base(lensKey)}/relations/${relationTypeKey}${buildQuery(params)}`,
  )

export const createRelation = (
  lensKey: string,
  relationTypeKey: string,
  body: { fromEntityId: string; toEntityId: string } & Record<string, JsonValue>,
) =>
  request<RelationInstance>(`${base(lensKey)}/relations/${relationTypeKey}`, {
    method: 'POST',
    body,
  })

export const getRelation = (lensKey: string, relationTypeKey: string, id: string) =>
  request<RelationInstance>(`${base(lensKey)}/relations/${relationTypeKey}/${id}`)

/** Props only — endpoints are immutable. */
export const updateRelation = (
  lensKey: string,
  relationTypeKey: string,
  id: string,
  properties: Record<string, JsonValue | null>,
) =>
  request<RelationInstance>(`${base(lensKey)}/relations/${relationTypeKey}/${id}`, {
    method: 'PATCH',
    body: properties,
  })

export const deleteRelation = (
  lensKey: string,
  relationTypeKey: string,
  id: string,
) =>
  request<undefined>(`${base(lensKey)}/relations/${relationTypeKey}/${id}`, {
    method: 'DELETE',
  })

/* ------------------------------ semantic search ------------------------------ */

export interface SemanticSearchParams {
  q: string
  /** Omit for cross-type search (results carry `_entityTypeKey`). */
  type?: string
  limit?: number
  /** 0–1 raw similarity; serialized snake_case per the contract. */
  minScore?: number
  fields?: readonly string[]
  /** Requires `type`; `contains` is rejected on semantic search. */
  filter?: FilterMap
  /** What to rank: entity embeddings, document chunks, or both (default `all`). */
  searchIn?: 'entities' | 'documents' | 'all'
  /** Include ~200-char snippets on document matches (default true). */
  snippets?: boolean
}

export const semanticSearch = (
  lensKey: string,
  { minScore, ...params }: SemanticSearchParams,
) =>
  request<SemanticSearchResponse>(
    `${base(lensKey)}/search/semantic${buildQuery({ ...params, min_score: minScore })}`,
  )

/* ----------------------------------- query ----------------------------------- */

/** Run a read-only OQL query against the lens. */
export const runQuery = (lensKey: string, query: string) =>
  request<QueryResult>(`${base(lensKey)}/query`, {
    method: 'POST',
    body: { query },
  })

/* -------------------------------- saved queries ------------------------------ */

export const listSavedQueries = (lensKey: string) =>
  request<SavedQuery[]>(`${base(lensKey)}/saved-queries`)

export const searchSavedQueries = (
  lensKey: string,
  params: { q: string; limit?: number; minScore?: number },
) =>
  request<SavedQuerySearchHit[]>(
    `${base(lensKey)}/saved-queries/search${buildQuery({
      q: params.q,
      limit: params.limit,
      min_score: params.minScore,
    })}`,
  )

export const runSavedQuery = (
  lensKey: string,
  queryKey: string,
  params: Record<string, JsonValue>,
) =>
  request<QueryResult>(`${base(lensKey)}/saved-queries/${queryKey}/run`, {
    method: 'POST',
    body: { params },
  })

/* ------------------------------------- AI ------------------------------------ */

export const aiQuery = (lensKey: string, question: string) =>
  request<AiQueryResponse>(`${base(lensKey)}/ai/query`, {
    method: 'POST',
    body: { question },
  })

export const aiExtract = (
  lensKey: string,
  body: { text: string; entityTypes?: string[]; create?: boolean },
) =>
  request<ExtractResponse>(`${base(lensKey)}/ai/extract`, {
    method: 'POST',
    body,
  })

export const aiChat = (
  lensKey: string,
  body: { message: string; history?: ChatMessage[]; includeToolCalls?: boolean },
) =>
  request<ChatResponse>(`${base(lensKey)}/ai/chat`, {
    method: 'POST',
    body,
  })

export const listAiAgents = (lensKey: string) =>
  request<AiAgent[]>(`${base(lensKey)}/ai/agents`)

export const aiAgentChat = (
  lensKey: string,
  agentKey: string,
  body: { message: string; history?: ChatMessage[]; includeToolCalls?: boolean },
) =>
  request<ChatResponse>(`${base(lensKey)}/ai/agents/${agentKey}/chat`, {
    method: 'POST',
    body,
  })
