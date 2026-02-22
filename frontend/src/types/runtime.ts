import type { DataType } from './models';

// Schema introspection types
export interface RuntimeSchema {
  ontology: {
    ontologyId: string;
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
