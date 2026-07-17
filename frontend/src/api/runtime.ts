/**
 * Runtime API client — `/api/runtime/...`, addressed by ontology/type KEY.
 */

import { buildQuery, request, type FilterMap } from './http'
import type {
  AiAgent,
  AiQueryResponse,
  ChatMessage,
  ChatResponse,
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
  SchemaEntityType,
  SchemaRelationType,
  SemanticSearchResponse,
} from './types'

const base = (ontologyKey: string) => `/api/runtime/${ontologyKey}`

/* --------------------------------- features --------------------------------- */

export const getFeatures = () => request<Features>('/api/runtime/features')

/* ---------------------------------- schema ---------------------------------- */

export const getSchema = (ontologyKey: string) =>
  request<RuntimeSchema>(`${base(ontologyKey)}/schema`)

export const getSchemaEntityTypes = (ontologyKey: string) =>
  request<SchemaEntityType[]>(`${base(ontologyKey)}/schema/entity-types`)

export const getSchemaEntityType = (ontologyKey: string, typeKey: string) =>
  request<SchemaEntityType>(`${base(ontologyKey)}/schema/entity-types/${typeKey}`)

export const getSchemaRelationTypes = (ontologyKey: string) =>
  request<SchemaRelationType[]>(`${base(ontologyKey)}/schema/relation-types`)

export const getSchemaRelationType = (ontologyKey: string, typeKey: string) =>
  request<SchemaRelationType>(`${base(ontologyKey)}/schema/relation-types/${typeKey}`)

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
  entityTypeKey: string,
  params?: ListEntitiesParams,
) =>
  request<ListResponse<EntityInstance>>(
    `${base(ontologyKey)}/entities/${entityTypeKey}${buildQuery(params)}`,
  )

export const createEntity = (
  ontologyKey: string,
  entityTypeKey: string,
  properties: Record<string, JsonValue>,
) =>
  request<EntityInstance>(`${base(ontologyKey)}/entities/${entityTypeKey}`, {
    method: 'POST',
    body: properties,
  })

export const getEntity = (ontologyKey: string, entityTypeKey: string, id: string) =>
  request<EntityInstance>(`${base(ontologyKey)}/entities/${entityTypeKey}/${id}`)

/** Partial update; an explicit `null` removes a property. */
export const updateEntity = (
  ontologyKey: string,
  entityTypeKey: string,
  id: string,
  properties: Record<string, JsonValue | null>,
) =>
  request<EntityInstance>(`${base(ontologyKey)}/entities/${entityTypeKey}/${id}`, {
    method: 'PATCH',
    body: properties,
  })

export const deleteEntity = (ontologyKey: string, entityTypeKey: string, id: string) =>
  request<undefined>(`${base(ontologyKey)}/entities/${entityTypeKey}/${id}`, {
    method: 'DELETE',
  })

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
  entityTypeKey: string,
  id: string,
  params?: NeighborsParams,
) =>
  request<NeighborsResponse>(
    `${base(ontologyKey)}/entities/${entityTypeKey}/${id}/neighbors${buildQuery(params)}`,
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
  relationTypeKey: string,
  params?: ListRelationsParams,
) =>
  request<ListResponse<RelationInstance>>(
    `${base(ontologyKey)}/relations/${relationTypeKey}${buildQuery(params)}`,
  )

export const createRelation = (
  ontologyKey: string,
  relationTypeKey: string,
  body: { fromEntityId: string; toEntityId: string } & Record<string, JsonValue>,
) =>
  request<RelationInstance>(`${base(ontologyKey)}/relations/${relationTypeKey}`, {
    method: 'POST',
    body,
  })

export const getRelation = (ontologyKey: string, relationTypeKey: string, id: string) =>
  request<RelationInstance>(`${base(ontologyKey)}/relations/${relationTypeKey}/${id}`)

/** Props only — endpoints are immutable. */
export const updateRelation = (
  ontologyKey: string,
  relationTypeKey: string,
  id: string,
  properties: Record<string, JsonValue | null>,
) =>
  request<RelationInstance>(`${base(ontologyKey)}/relations/${relationTypeKey}/${id}`, {
    method: 'PATCH',
    body: properties,
  })

export const deleteRelation = (
  ontologyKey: string,
  relationTypeKey: string,
  id: string,
) =>
  request<undefined>(`${base(ontologyKey)}/relations/${relationTypeKey}/${id}`, {
    method: 'DELETE',
  })

/* ------------------------------ semantic search ------------------------------ */

export interface SemanticSearchParams {
  q: string
  /** Omit for cross-type search (results carry `_entityTypeKey`). */
  type?: string
  limit?: number
  /** 0–1; serialized snake_case per the contract. */
  minScore?: number
  fields?: readonly string[]
  /** Requires `type`; `contains` is rejected on semantic search. */
  filter?: FilterMap
}

export const semanticSearch = (
  ontologyKey: string,
  { minScore, ...params }: SemanticSearchParams,
) =>
  request<SemanticSearchResponse>(
    `${base(ontologyKey)}/search/semantic${buildQuery({ ...params, min_score: minScore })}`,
  )

/* ---------------------------------- cypher ----------------------------------- */

export const cypherQuery = (ontologyKey: string, cypher: string) =>
  request<QueryResult>(`${base(ontologyKey)}/query`, {
    method: 'POST',
    body: { cypher },
  })

/* -------------------------------- saved queries ------------------------------ */

export const listSavedQueries = (ontologyKey: string) =>
  request<SavedQuery[]>(`${base(ontologyKey)}/saved-queries`)

export const searchSavedQueries = (
  ontologyKey: string,
  params: { q: string; limit?: number; minScore?: number },
) =>
  request<SavedQuery[]>(
    `${base(ontologyKey)}/saved-queries/search${buildQuery({
      q: params.q,
      limit: params.limit,
      min_score: params.minScore,
    })}`,
  )

export const runSavedQuery = (
  ontologyKey: string,
  queryKey: string,
  params: Record<string, JsonValue>,
) =>
  request<QueryResult>(`${base(ontologyKey)}/saved-queries/${queryKey}/run`, {
    method: 'POST',
    body: { params },
  })

/* ------------------------------------- AI ------------------------------------ */

export const aiQuery = (ontologyKey: string, question: string) =>
  request<AiQueryResponse>(`${base(ontologyKey)}/ai/query`, {
    method: 'POST',
    body: { question },
  })

export const aiExtract = (
  ontologyKey: string,
  body: { text: string; entityTypes?: string[]; create?: boolean },
) =>
  request<ExtractResponse>(`${base(ontologyKey)}/ai/extract`, {
    method: 'POST',
    body,
  })

export const aiChat = (
  ontologyKey: string,
  body: { message: string; history?: ChatMessage[]; includeToolCalls?: boolean },
) =>
  request<ChatResponse>(`${base(ontologyKey)}/ai/chat`, {
    method: 'POST',
    body,
  })

export const listAiAgents = (ontologyKey: string) =>
  request<AiAgent[]>(`${base(ontologyKey)}/ai/agents`)

export const aiAgentChat = (
  ontologyKey: string,
  agentKey: string,
  body: { message: string; history?: ChatMessage[]; includeToolCalls?: boolean },
) =>
  request<ChatResponse>(`${base(ontologyKey)}/ai/agents/${agentKey}/chat`, {
    method: 'POST',
    body,
  })
