/**
 * Runtime API client — `/api/ontologies/{ontologyKey}/runtime/lenses/{lensKey}/...`,
 * addressed by ontology, lens and type KEY.
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

export const createEntity = (
  ontologyKey: string,
  lensKey: string,
  entityTypeKey: string,
  properties: Record<string, JsonValue>,
) =>
  request<EntityInstance>(`${base(ontologyKey, lensKey)}/entities/${entityTypeKey}`, {
    method: 'POST',
    body: properties,
  })

export const getEntity = (ontologyKey: string, lensKey: string, entityTypeKey: string, id: string) =>
  request<EntityInstance>(`${base(ontologyKey, lensKey)}/entities/${entityTypeKey}/${id}`)

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
  ontologyKey: string,
  lensKey: string,
  { minScore, ...params }: SemanticSearchParams,
) =>
  request<SemanticSearchResponse>(
    `${base(ontologyKey, lensKey)}/search/semantic${buildQuery({ ...params, min_score: minScore })}`,
  )

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

/* ------------------------------------- AI ------------------------------------ */

export const aiQuery = (ontologyKey: string, lensKey: string, question: string) =>
  request<AiQueryResponse>(`${base(ontologyKey, lensKey)}/ai/query`, {
    method: 'POST',
    body: { question },
  })

export const aiExtract = (
  ontologyKey: string,
  lensKey: string,
  body: { text: string; entityTypes?: string[]; create?: boolean },
) =>
  request<ExtractResponse>(`${base(ontologyKey, lensKey)}/ai/extract`, {
    method: 'POST',
    body,
  })

export const aiChat = (
  ontologyKey: string,
  lensKey: string,
  body: { message: string; history?: ChatMessage[]; includeToolCalls?: boolean },
) =>
  request<ChatResponse>(`${base(ontologyKey, lensKey)}/ai/chat`, {
    method: 'POST',
    body,
  })

export const listAiAgents = (ontologyKey: string, lensKey: string) =>
  request<AiAgent[]>(`${base(ontologyKey, lensKey)}/ai/agents`)

export const aiAgentChat = (
  ontologyKey: string,
  lensKey: string,
  agentKey: string,
  body: { message: string; history?: ChatMessage[]; includeToolCalls?: boolean },
) =>
  request<ChatResponse>(`${base(ontologyKey, lensKey)}/ai/agents/${agentKey}/chat`, {
    method: 'POST',
    body,
  })
