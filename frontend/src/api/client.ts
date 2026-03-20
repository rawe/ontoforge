import type {
  Ontology,
  EntityType,
  RelationType,
  PropertyDefinition,
  ValidationResult,
  IncludeTypeResponse,
  AiAgentConfig,
  SavedQuery,
  SavedQueryStep,
} from '../types/models';
import { ApiError, request as baseRequest } from './request';

export { ApiError };

const BASE_URL = '/api/model';

function request<T>(path: string, options?: RequestInit): Promise<T> {
  return baseRequest<T>(BASE_URL, path, options);
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

// Entity Types (global)
export const listEntityTypes = () =>
  request<EntityType[]>('/entity-types');
export const createEntityType = (
  data: { key: string; displayName: string; description?: string },
) => request<EntityType>('/entity-types', { method: 'POST', body: JSON.stringify(data) });
export const getEntityType = (entityTypeId: string) =>
  request<EntityType>(`/entity-types/${entityTypeId}`);
export const updateEntityType = (
  entityTypeId: string,
  data: { displayName?: string; description?: string },
) => request<EntityType>(`/entity-types/${entityTypeId}`, { method: 'PUT', body: JSON.stringify(data) });
export const deleteEntityType = (entityTypeId: string, cascade = false) =>
  request<void>(`/entity-types/${entityTypeId}${cascade ? '?cascade=true' : ''}`, { method: 'DELETE' });

// Relation Types (global)
export const listRelationTypes = () =>
  request<RelationType[]>('/relation-types');
export const createRelationType = (
  data: { key: string; displayName: string; description?: string; sourceEntityTypeKey: string; targetEntityTypeKey: string },
) => request<RelationType>('/relation-types', { method: 'POST', body: JSON.stringify(data) });
export const getRelationType = (relationTypeId: string) =>
  request<RelationType>(`/relation-types/${relationTypeId}`);
export const updateRelationType = (
  relationTypeId: string,
  data: { displayName?: string; description?: string },
) => request<RelationType>(`/relation-types/${relationTypeId}`, { method: 'PUT', body: JSON.stringify(data) });
export const deleteRelationType = (relationTypeId: string, cascade = false) =>
  request<void>(`/relation-types/${relationTypeId}${cascade ? '?cascade=true' : ''}`, { method: 'DELETE' });

// Properties (works for both entity-types and relation-types)
type OwnerType = 'entity-types' | 'relation-types';

export const listProperties = (ownerType: OwnerType, ownerId: string) =>
  request<PropertyDefinition[]>(`/${ownerType}/${ownerId}/properties`);
export const createProperty = (
  ownerType: OwnerType,
  ownerId: string,
  data: { key: string; displayName: string; description?: string; dataType: string; required?: boolean; defaultValue?: string },
  cascade = false,
) => request<PropertyDefinition>(`/${ownerType}/${ownerId}/properties${cascade ? '?cascade=true' : ''}`, { method: 'POST', body: JSON.stringify(data) });
export const updateProperty = (
  ownerType: OwnerType,
  ownerId: string,
  propertyId: string,
  data: { displayName?: string; description?: string; required?: boolean; defaultValue?: string | null },
) => request<PropertyDefinition>(`/${ownerType}/${ownerId}/properties/${propertyId}`, { method: 'PUT', body: JSON.stringify(data) });
export const deleteProperty = (ownerType: OwnerType, ownerId: string, propertyId: string, cascade = false) =>
  request<void>(`/${ownerType}/${ownerId}/properties/${propertyId}${cascade ? '?cascade=true' : ''}`, { method: 'DELETE' });

// Scope Management
export const listIncludesEntityTypes = (ontologyId: string) =>
  request<IncludeTypeResponse[]>(`/ontologies/${ontologyId}/includes/entity-types`);
export const addIncludesEntityType = (ontologyId: string, data: { key: string; properties?: string[] | null }) =>
  request<IncludeTypeResponse>(`/ontologies/${ontologyId}/includes/entity-types`, { method: 'POST', body: JSON.stringify(data) });
export const updateIncludesEntityType = (ontologyId: string, typeId: string, data: { properties?: string[] | null }) =>
  request<IncludeTypeResponse>(`/ontologies/${ontologyId}/includes/entity-types/${typeId}`, { method: 'PUT', body: JSON.stringify(data) });
export const removeIncludesEntityType = (ontologyId: string, typeId: string) =>
  request<void>(`/ontologies/${ontologyId}/includes/entity-types/${typeId}`, { method: 'DELETE' });
export const listIncludesRelationTypes = (ontologyId: string) =>
  request<IncludeTypeResponse[]>(`/ontologies/${ontologyId}/includes/relation-types`);
export const addIncludesRelationType = (ontologyId: string, data: { key: string; properties?: string[] | null }) =>
  request<IncludeTypeResponse>(`/ontologies/${ontologyId}/includes/relation-types`, { method: 'POST', body: JSON.stringify(data) });
export const updateIncludesRelationType = (ontologyId: string, typeId: string, data: { properties?: string[] | null }) =>
  request<IncludeTypeResponse>(`/ontologies/${ontologyId}/includes/relation-types/${typeId}`, { method: 'PUT', body: JSON.stringify(data) });
export const removeIncludesRelationType = (ontologyId: string, typeId: string) =>
  request<void>(`/ontologies/${ontologyId}/includes/relation-types/${typeId}`, { method: 'DELETE' });

// Validation
export const validateSchema = () =>
  request<ValidationResult>('/schema/validate', { method: 'POST' });
export const validateOntology = (ontologyId: string) =>
  request<ValidationResult>(`/ontologies/${ontologyId}/validate`, { method: 'POST' });

// Export/Import (global)
export const exportSchema = () =>
  request<unknown>('/export');
export const importSchema = (data: unknown) =>
  request<unknown>('/import', { method: 'POST', body: JSON.stringify(data) });

// AI Agent Config
export const listAiAgents = (ontologyKey: string) =>
  request<AiAgentConfig[]>(`/ontologies/${ontologyKey}/ai-agents`);
export const upsertAiAgent = (
  ontologyKey: string,
  agentKey: string,
  data: { name: string; description?: string | null; systemPrompt?: string | null; tools?: string[] | null },
) => request<AiAgentConfig>(`/ontologies/${ontologyKey}/ai-agents/${agentKey}`, { method: 'PUT', body: JSON.stringify(data) });
export const deleteAiAgent = (ontologyKey: string, agentKey: string) =>
  request<void>(`/ontologies/${ontologyKey}/ai-agents/${agentKey}`, { method: 'DELETE' });

// Saved Query Config
export const listSavedQueries = (ontologyKey: string) =>
  request<SavedQuery[]>(`/ontologies/${ontologyKey}/saved-queries`);
export const upsertSavedQuery = (
  ontologyKey: string,
  queryKey: string,
  data: { name: string; description: string; steps: SavedQueryStep[]; parameters?: { name: string; description: string; dataType: string }[] },
) => request<SavedQuery>(`/ontologies/${ontologyKey}/saved-queries/${queryKey}`, { method: 'PUT', body: JSON.stringify(data) });
export const deleteSavedQuery = (ontologyKey: string, queryKey: string) =>
  request<void>(`/ontologies/${ontologyKey}/saved-queries/${queryKey}`, { method: 'DELETE' });
