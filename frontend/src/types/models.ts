export interface Ontology {
  ontologyId: string;
  name: string;
  key: string;
  description: string | null;
  createdAt: string;
  updatedAt: string;
}

export interface EntityType {
  entityTypeId: string;
  key: string;
  displayName: string;
  description: string | null;
  displayNameProperty: string | null;
  defaultSearchProperties: string[] | null;
  createdAt: string;
  updatedAt: string;
}

export interface RelationType {
  relationTypeId: string;
  key: string;
  displayName: string;
  description: string | null;
  sourceEntityTypeKey: string;
  targetEntityTypeKey: string;
  factTemplate: string | null;
  createdAt: string;
  updatedAt: string;
}

export type DataType = 'string' | 'integer' | 'float' | 'boolean' | 'date' | 'datetime';

export interface PropertyDefinition {
  propertyId: string;
  key: string;
  displayName: string;
  description: string | null;
  dataType: DataType;
  required: boolean;
  defaultValue: string | null;
  createdAt: string;
  updatedAt: string;
}

export interface ValidationResult {
  valid: boolean;
  errors: { path: string; message: string }[];
}

export interface IncludeTypeResponse {
  key: string;
  properties: string[] | null;
}

export interface AiAgentConfig {
  key: string;
  name: string;
  description: string | null;
  systemPrompt: string | null;
  tools: string[] | null;
  createdAt: string;
  updatedAt: string;
}

export interface SavedQueryParameter {
  name: string;
  description: string;
  dataType: DataType;
}

export type StepType = 'cypher' | 'semantic_search';

export interface SavedQueryStep {
  name: string;
  type: StepType;
  cypher?: string;
  entityTypeKey?: string;
  query?: string;
  limit?: number;
  minScore?: number;
  bindings?: Record<string, string>;
}

export interface SavedQuery {
  key: string;
  name: string;
  description: string;
  steps: SavedQueryStep[];
  parameters: SavedQueryParameter[];
  createdAt: string;
  updatedAt: string;
}
