export interface Ontology {
  ontologyId: string;
  name: string;
  description: string | null;
  createdAt: string;
  updatedAt: string;
}

export interface EntityType {
  entityTypeId: string;
  key: string;
  displayName: string;
  description: string | null;
  createdAt: string;
  updatedAt: string;
}

export interface RelationType {
  relationTypeId: string;
  key: string;
  displayName: string;
  description: string | null;
  sourceEntityTypeId: string;
  targetEntityTypeId: string;
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
