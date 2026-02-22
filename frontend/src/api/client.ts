import type {
  Ontology,
  EntityType,
  RelationType,
  PropertyDefinition,
  ValidationResult,
} from '../types/models';

const BASE_URL = 'http://localhost:8000/api/model';

export class ApiError extends Error {
  status: number;
  code: string;

  constructor(message: string, status: number, code: string) {
    super(message);
    this.status = status;
    this.code = code;
  }
}

async function request<T>(path: string, options?: RequestInit): Promise<T> {
  const res = await fetch(`${BASE_URL}${path}`, {
    headers: { 'Content-Type': 'application/json', ...options?.headers },
    ...options,
  });
  if (!res.ok) {
    const body = await res.json().catch(() => ({ error: { message: 'Request failed', code: 'UNKNOWN' } }));
    throw new ApiError(
      body.error?.message || 'Request failed',
      res.status,
      body.error?.code || 'UNKNOWN',
    );
  }
  if (res.status === 204) return undefined as T;
  return res.json();
}

// Ontologies
export const listOntologies = () => request<Ontology[]>('/ontologies');
export const createOntology = (data: { name: string; key: string; description?: string }) =>
  request<Ontology>('/ontologies', { method: 'POST', body: JSON.stringify(data) });
export const getOntology = (id: string) => request<Ontology>(`/ontologies/${id}`);
export const updateOntology = (id: string, data: { name?: string; description?: string }) =>
  request<Ontology>(`/ontologies/${id}`, { method: 'PUT', body: JSON.stringify(data) });
export const deleteOntology = (id: string) =>
  request<void>(`/ontologies/${id}`, { method: 'DELETE' });

// Entity Types
export const listEntityTypes = (ontologyId: string) =>
  request<EntityType[]>(`/ontologies/${ontologyId}/entity-types`);
export const createEntityType = (
  ontologyId: string,
  data: { key: string; displayName: string; description?: string },
) => request<EntityType>(`/ontologies/${ontologyId}/entity-types`, { method: 'POST', body: JSON.stringify(data) });
export const getEntityType = (ontologyId: string, entityTypeId: string) =>
  request<EntityType>(`/ontologies/${ontologyId}/entity-types/${entityTypeId}`);
export const updateEntityType = (
  ontologyId: string,
  entityTypeId: string,
  data: { displayName?: string; description?: string },
) => request<EntityType>(`/ontologies/${ontologyId}/entity-types/${entityTypeId}`, { method: 'PUT', body: JSON.stringify(data) });
export const deleteEntityType = (ontologyId: string, entityTypeId: string) =>
  request<void>(`/ontologies/${ontologyId}/entity-types/${entityTypeId}`, { method: 'DELETE' });

// Relation Types
export const listRelationTypes = (ontologyId: string) =>
  request<RelationType[]>(`/ontologies/${ontologyId}/relation-types`);
export const createRelationType = (
  ontologyId: string,
  data: { key: string; displayName: string; description?: string; sourceEntityTypeId: string; targetEntityTypeId: string },
) => request<RelationType>(`/ontologies/${ontologyId}/relation-types`, { method: 'POST', body: JSON.stringify(data) });
export const getRelationType = (ontologyId: string, relationTypeId: string) =>
  request<RelationType>(`/ontologies/${ontologyId}/relation-types/${relationTypeId}`);
export const updateRelationType = (
  ontologyId: string,
  relationTypeId: string,
  data: { displayName?: string; description?: string },
) => request<RelationType>(`/ontologies/${ontologyId}/relation-types/${relationTypeId}`, { method: 'PUT', body: JSON.stringify(data) });
export const deleteRelationType = (ontologyId: string, relationTypeId: string) =>
  request<void>(`/ontologies/${ontologyId}/relation-types/${relationTypeId}`, { method: 'DELETE' });

// Properties (works for both entity-types and relation-types)
type OwnerType = 'entity-types' | 'relation-types';

export const listProperties = (ontologyId: string, ownerType: OwnerType, ownerId: string) =>
  request<PropertyDefinition[]>(`/ontologies/${ontologyId}/${ownerType}/${ownerId}/properties`);
export const createProperty = (
  ontologyId: string,
  ownerType: OwnerType,
  ownerId: string,
  data: { key: string; displayName: string; description?: string; dataType: string; required?: boolean; defaultValue?: string },
) => request<PropertyDefinition>(`/ontologies/${ontologyId}/${ownerType}/${ownerId}/properties`, { method: 'POST', body: JSON.stringify(data) });
export const updateProperty = (
  ontologyId: string,
  ownerType: OwnerType,
  ownerId: string,
  propertyId: string,
  data: { displayName?: string; description?: string; required?: boolean; defaultValue?: string | null },
) => request<PropertyDefinition>(`/ontologies/${ontologyId}/${ownerType}/${ownerId}/properties/${propertyId}`, { method: 'PUT', body: JSON.stringify(data) });
export const deleteProperty = (ontologyId: string, ownerType: OwnerType, ownerId: string, propertyId: string) =>
  request<void>(`/ontologies/${ontologyId}/${ownerType}/${ownerId}/properties/${propertyId}`, { method: 'DELETE' });

// Validation & Export/Import
export const validateSchema = (ontologyId: string) =>
  request<ValidationResult>(`/ontologies/${ontologyId}/validate`, { method: 'POST' });
export const exportSchema = (ontologyId: string) =>
  request<unknown>(`/ontologies/${ontologyId}/export`);
export const importSchema = (data: unknown, overwrite = false) =>
  request<Ontology>(`/import?overwrite=${overwrite}`, { method: 'POST', body: JSON.stringify(data) });
