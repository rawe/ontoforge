import type {
  RuntimeSchema,
  EntityInstance,
  RelationInstance,
  PaginatedResponse,
  FeaturesResponse,
  SemanticSearchResponse,
  AiQueryResponse,
  AiExtractResponse,
  AiChatMessage,
  AiChatResponse,
  AgentInfo,
} from '../types/runtime';
import { request as baseRequest } from './request';

const RUNTIME_BASE_URL = '/api/runtime';

function request<T>(path: string, options?: RequestInit): Promise<T> {
  return baseRequest<T>(RUNTIME_BASE_URL, path, options);
}

// Schema
export const getSchema = (ontologyKey: string) =>
  request<RuntimeSchema>(`/${ontologyKey}/schema`);

// Entities
export interface ListEntityParams {
  limit?: number;
  offset?: number;
  sort?: string;
  order?: 'asc' | 'desc';
  q?: string;
  filters?: Record<string, string>;
}

function buildEntityQuery(params?: ListEntityParams): string {
  if (!params) return '';
  const parts: string[] = [];
  if (params.limit != null) parts.push(`limit=${params.limit}`);
  if (params.offset != null) parts.push(`offset=${params.offset}`);
  if (params.sort) parts.push(`sort=${encodeURIComponent(params.sort)}`);
  if (params.order) parts.push(`order=${params.order}`);
  if (params.q) parts.push(`q=${encodeURIComponent(params.q)}`);
  if (params.filters) {
    for (const [key, value] of Object.entries(params.filters)) {
      parts.push(`filter.${encodeURIComponent(key)}=${encodeURIComponent(value)}`);
    }
  }
  return parts.length ? `?${parts.join('&')}` : '';
}

export const listEntities = (ontologyKey: string, entityTypeKey: string, params?: ListEntityParams) =>
  request<PaginatedResponse<EntityInstance>>(`/${ontologyKey}/entities/${entityTypeKey}${buildEntityQuery(params)}`);

export const createEntity = (ontologyKey: string, entityTypeKey: string, data: Record<string, unknown>) =>
  request<EntityInstance>(`/${ontologyKey}/entities/${entityTypeKey}`, { method: 'POST', body: JSON.stringify(data) });

export const getEntity = (ontologyKey: string, entityTypeKey: string, id: string) =>
  request<EntityInstance>(`/${ontologyKey}/entities/${entityTypeKey}/${id}`);

export const updateEntity = (ontologyKey: string, entityTypeKey: string, id: string, data: Record<string, unknown>) =>
  request<EntityInstance>(`/${ontologyKey}/entities/${entityTypeKey}/${id}`, { method: 'PATCH', body: JSON.stringify(data) });

export const deleteEntity = (ontologyKey: string, entityTypeKey: string, id: string) =>
  request<void>(`/${ontologyKey}/entities/${entityTypeKey}/${id}`, { method: 'DELETE' });

// Relations
export interface ListRelationParams {
  limit?: number;
  offset?: number;
  sort?: string;
  order?: 'asc' | 'desc';
  fromEntityId?: string;
  toEntityId?: string;
  filters?: Record<string, string>;
}

function buildRelationQuery(params?: ListRelationParams): string {
  if (!params) return '';
  const parts: string[] = [];
  if (params.limit != null) parts.push(`limit=${params.limit}`);
  if (params.offset != null) parts.push(`offset=${params.offset}`);
  if (params.sort) parts.push(`sort=${encodeURIComponent(params.sort)}`);
  if (params.order) parts.push(`order=${params.order}`);
  if (params.fromEntityId) parts.push(`fromEntityId=${encodeURIComponent(params.fromEntityId)}`);
  if (params.toEntityId) parts.push(`toEntityId=${encodeURIComponent(params.toEntityId)}`);
  if (params.filters) {
    for (const [key, value] of Object.entries(params.filters)) {
      parts.push(`filter.${encodeURIComponent(key)}=${encodeURIComponent(value)}`);
    }
  }
  return parts.length ? `?${parts.join('&')}` : '';
}

export const listRelations = (ontologyKey: string, relationTypeKey: string, params?: ListRelationParams) =>
  request<PaginatedResponse<RelationInstance>>(`/${ontologyKey}/relations/${relationTypeKey}${buildRelationQuery(params)}`);

export const createRelation = (ontologyKey: string, relationTypeKey: string, data: Record<string, unknown>) =>
  request<RelationInstance>(`/${ontologyKey}/relations/${relationTypeKey}`, { method: 'POST', body: JSON.stringify(data) });

export const getRelation = (ontologyKey: string, relationTypeKey: string, id: string) =>
  request<RelationInstance>(`/${ontologyKey}/relations/${relationTypeKey}/${id}`);

export const updateRelation = (ontologyKey: string, relationTypeKey: string, id: string, data: Record<string, unknown>) =>
  request<RelationInstance>(`/${ontologyKey}/relations/${relationTypeKey}/${id}`, { method: 'PATCH', body: JSON.stringify(data) });

export const deleteRelation = (ontologyKey: string, relationTypeKey: string, id: string) =>
  request<void>(`/${ontologyKey}/relations/${relationTypeKey}/${id}`, { method: 'DELETE' });

// Features
export const getFeatures = () =>
  request<FeaturesResponse>('/features');

// Semantic search
export interface SemanticSearchParams {
  q: string;
  type: string;
  limit?: number;
  min_score?: number;
  filters?: Record<string, string>;
}

function buildSemanticSearchQuery(params: SemanticSearchParams): string {
  const parts: string[] = [];
  parts.push(`q=${encodeURIComponent(params.q)}`);
  parts.push(`type=${encodeURIComponent(params.type)}`);
  if (params.limit != null) parts.push(`limit=${params.limit}`);
  if (params.min_score != null) parts.push(`min_score=${params.min_score}`);
  if (params.filters) {
    for (const [key, value] of Object.entries(params.filters)) {
      parts.push(`filter.${encodeURIComponent(key)}=${encodeURIComponent(value)}`);
    }
  }
  return `?${parts.join('&')}`;
}

export const semanticSearch = (ontologyKey: string, params: SemanticSearchParams) =>
  request<SemanticSearchResponse>(`/${ontologyKey}/search/semantic${buildSemanticSearchQuery(params)}`);

// AI
export const aiQuery = (ontologyKey: string, question: string) =>
  request<AiQueryResponse>(`/${ontologyKey}/ai/query`, {
    method: 'POST',
    body: JSON.stringify({ question }),
  });

export const aiExtract = (
  ontologyKey: string,
  text: string,
  entityTypes?: string[],
  create?: boolean,
) =>
  request<AiExtractResponse>(`/${ontologyKey}/ai/extract`, {
    method: 'POST',
    body: JSON.stringify({ text, entityTypes, create }),
  });

export const aiChat = (
  ontologyKey: string,
  message: string,
  history?: AiChatMessage[],
) =>
  request<AiChatResponse>(`/${ontologyKey}/ai/chat`, {
    method: 'POST',
    body: JSON.stringify({ message, history, includeToolCalls: true }),
  });

// Saved Queries
export const runSavedQuery = (
  ontologyKey: string,
  queryKey: string,
  params: Record<string, unknown>,
) =>
  request<{ columns: string[]; results: Record<string, unknown>[] }>(
    `/${ontologyKey}/saved-queries/${queryKey}/run`,
    { method: 'POST', body: JSON.stringify({ params }) },
  );

// Agent discovery and chat
export const listAgents = (ontologyKey: string) =>
  request<AgentInfo[]>(`/${ontologyKey}/ai/agents`);

export const aiAgentChat = (
  ontologyKey: string,
  agentKey: string,
  message: string,
  history?: AiChatMessage[],
) =>
  request<AiChatResponse>(`/${ontologyKey}/ai/agents/${agentKey}/chat`, {
    method: 'POST',
    body: JSON.stringify({ message, history, includeToolCalls: true }),
  });

