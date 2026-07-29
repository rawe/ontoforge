/**
 * Zod schemas for the modeling REST surface. Wire shapes mirror the Python
 * reference models (`backend/src/ontoforge_server/modeling/schemas.py`):
 * camelCase field names, internal identifiers exposed by design, nullable
 * optionals serialized as explicit `null`.
 */

import { z } from "zod";

import { DATA_TYPES, KEY_PATTERN } from "../core/schemas.js";

// --- Entity Type ---

export const EntityTypeCreate = z.object({
  key: z.string().regex(KEY_PATTERN),
  displayName: z.string(),
  description: z.string().nullable().optional(),
});

export const EntityTypeUpdate = z.object({
  displayName: z.string().nullable().optional(),
  description: z.string().nullable().optional(),
});

export const EntityTypeResponse = z.object({
  entityTypeId: z.string(),
  key: z.string(),
  displayName: z.string(),
  description: z.string().nullable(),
  createdAt: z.iso.datetime(),
  updatedAt: z.iso.datetime(),
});

// --- Relation Type ---

export const RelationTypeCreate = z.object({
  key: z.string().regex(KEY_PATTERN),
  displayName: z.string(),
  description: z.string().nullable().optional(),
  sourceEntityTypeKey: z.string(),
  targetEntityTypeKey: z.string(),
});

export const RelationTypeUpdate = z.object({
  displayName: z.string().nullable().optional(),
  description: z.string().nullable().optional(),
});

export const RelationTypeResponse = z.object({
  relationTypeId: z.string(),
  key: z.string(),
  displayName: z.string(),
  description: z.string().nullable(),
  sourceEntityTypeKey: z.string(),
  targetEntityTypeKey: z.string(),
  createdAt: z.iso.datetime(),
  updatedAt: z.iso.datetime(),
});

// --- Property Definition ---

export const PropertyDefinitionCreate = z.object({
  key: z.string().regex(KEY_PATTERN),
  displayName: z.string(),
  description: z.string().nullable().optional(),
  dataType: z.enum(DATA_TYPES),
  required: z.boolean().default(false),
  // Defaults are stored as strings and NOT validated against the data type
  // at definition time — a bad default is legal to store.
  defaultValue: z.string().nullable().optional(),
});

/**
 * Sparse update: an omitted field is left unchanged, so a description can
 * never be cleared. `defaultValue` is the single exception — an explicit
 * `null` clears the default (see the service's clear-default handling).
 */
export const PropertyDefinitionUpdate = z.object({
  displayName: z.string().nullable().optional(),
  description: z.string().nullable().optional(),
  required: z.boolean().nullable().optional(),
  defaultValue: z.string().nullable().optional(),
});

export const PropertyDefinitionResponse = z.object({
  propertyId: z.string(),
  key: z.string(),
  displayName: z.string(),
  description: z.string().nullable(),
  dataType: z.string(),
  required: z.boolean(),
  defaultValue: z.string().nullable(),
  createdAt: z.iso.datetime(),
  updatedAt: z.iso.datetime(),
});

export type EntityTypeCreateInput = z.infer<typeof EntityTypeCreate>;
export type EntityTypeUpdateInput = z.infer<typeof EntityTypeUpdate>;
export type EntityTypeResponseBody = z.infer<typeof EntityTypeResponse>;
export type RelationTypeCreateInput = z.infer<typeof RelationTypeCreate>;
export type RelationTypeUpdateInput = z.infer<typeof RelationTypeUpdate>;
export type RelationTypeResponseBody = z.infer<typeof RelationTypeResponse>;
export type PropertyDefinitionCreateInput = z.infer<typeof PropertyDefinitionCreate>;
export type PropertyDefinitionUpdateInput = z.infer<typeof PropertyDefinitionUpdate>;
export type PropertyDefinitionResponseBody = z.infer<typeof PropertyDefinitionResponse>;
