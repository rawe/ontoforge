import type { DataType } from './models';

// Schema introspection types
export interface RuntimeSchema {
  ontology: {
    name: string;
    key: string;
    description: string | null;
  };
  entityTypes: RuntimeEntityType[];
  relationTypes: RuntimeRelationType[];
}

export interface RuntimeEntityType {
  key: string;
  displayName: string;
  description: string | null;
  properties: RuntimePropertyDef[];
}

export interface RuntimeRelationType {
  key: string;
  displayName: string;
  description: string | null;
  fromEntityTypeKey: string;
  toEntityTypeKey: string;
  properties: RuntimePropertyDef[];
}

export interface RuntimePropertyDef {
  key: string;
  displayName: string;
  description: string | null;
  dataType: DataType;
  required: boolean;
  defaultValue: string | null;
}

// Instance types
export interface EntityInstance {
  _id: string;
  _entityTypeKey: string;
  _createdAt: string;
  _updatedAt: string;
  [key: string]: unknown;
}

export interface RelationInstance {
  _id: string;
  _relationTypeKey: string;
  _createdAt: string;
  _updatedAt: string;
  fromEntityId: string;
  toEntityId: string;
  [key: string]: unknown;
}

export interface PaginatedResponse<T> {
  items: T[];
  total: number;
  limit: number;
  offset: number;
}

// Feature detection
export interface FeaturesResponse {
  semanticSearch: boolean;
  ai: boolean;
}

// AI types
export interface AiQueryResponse {
  answer: string;
  cypher: string | null;
  results: Record<string, unknown> | null;
}

export interface ExtractedEntity {
  entityTypeKey: string;
  properties: Record<string, unknown>;
}

export interface ExtractedRelation {
  relationTypeKey: string;
  source: { entityTypeKey: string; match: Record<string, unknown> };
  target: { entityTypeKey: string; match: Record<string, unknown> };
  properties?: Record<string, unknown>;
}

export interface AiExtractResponse {
  entities: ExtractedEntity[];
  relations: ExtractedRelation[];
  created: boolean;
}

export interface AiChatMessage {
  role: 'user' | 'assistant';
  content: string;
}

export interface AiChatToolCall {
  tool: string;
  args: Record<string, unknown>;
}

export interface AiChatResponse {
  reply: string;
  toolCalls: AiChatToolCall[] | null;
}

// Agent discovery
export interface AgentInfo {
  key: string;
  name: string;
  description: string | null;
}

// Semantic search
export interface SemanticSearchResult {
  entity: EntityInstance;
  score: number;
}

export interface SemanticSearchResponse {
  results: SemanticSearchResult[];
  query: string;
  total: number;
}
