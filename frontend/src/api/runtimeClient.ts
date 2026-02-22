import type {
  RuntimeSchema,
  EntityInstance,
  RelationInstance,
  PaginatedResponse,
} from '../types/runtime';
import { request as baseRequest } from './request';

const RUNTIME_BASE_URL = 'http://localhost:8000/api/runtime';

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

// Data management
export interface WipeDataResponse {
  ontologyKey: string;
  entitiesDeleted: number;
  relationsDeleted: number;
}

export const wipeData = (ontologyKey: string) =>
  request<WipeDataResponse>(`/${ontologyKey}/data`, { method: 'DELETE' });
