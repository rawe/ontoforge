/**
 * Ontology registry domain logic, shared by every interface that manages
 * ontologies. The registry — not any storage catalog — is the
 * authoritative list of ontologies.
 *
 * Identity rules (`docs/decisions.md`): immutable `lower_snake_case`
 * key, unique server-wide; mutable display name, also unique
 * server-wide, optional at creation. Create starts the ontology bare and
 * provisions its physical home atomically in the adapter; delete is a
 * hard full cascade with no API-level guard.
 */

import { randomUUID } from "node:crypto";

import { getEmbeddingProvider } from "../core/embedding.js";
import { ConflictError, NotFoundError } from "../core/exceptions.js";
import type { OntologyRegistry } from "../core/ports.js";
import { invalidateLoadedSchemaCache } from "../runtime/schemaCache.js";
import type { OntologyCreateInput, OntologyRenameInput, OntologyResponseBody } from "./schemas.js";

type Row = Record<string, unknown>;

function toIso(value: unknown): string {
  if (value instanceof Date) {
    return value.toISOString();
  }
  return String(value);
}

function toOntologyResponse(data: Row): OntologyResponseBody {
  return {
    ontologyId: data.ontologyId as string,
    key: data.key as string,
    displayName: data.displayName === null || data.displayName === undefined
      ? null
      : String(data.displayName),
    createdAt: toIso(data.createdAt),
    updatedAt: toIso(data.updatedAt),
  };
}

export async function createOntology(
  body: OntologyCreateInput,
  registry: OntologyRegistry,
): Promise<OntologyResponseBody> {
  const displayName = body.displayName ?? null;
  const existingKey = await registry.getOntology(body.key);
  if (existingKey) {
    throw new ConflictError(`Ontology with key '${body.key}' already exists`);
  }
  if (displayName !== null) {
    const existingName = await registry.getOntologyByDisplayName(displayName);
    if (existingName) {
      throw new ConflictError(`Ontology with display name '${displayName}' already exists`);
    }
  }
  const dimensions = getEmbeddingProvider()?.dimensions ?? null;
  const data = await registry.createOntology(randomUUID(), body.key, displayName, dimensions);
  return toOntologyResponse(data);
}

export async function listOntologies(
  registry: OntologyRegistry,
): Promise<OntologyResponseBody[]> {
  const rows = await registry.listOntologies();
  return rows.map(toOntologyResponse);
}

export async function getOntology(
  key: string,
  registry: OntologyRegistry,
): Promise<OntologyResponseBody> {
  const data = await registry.getOntology(key);
  if (!data) {
    throw new NotFoundError(`Ontology '${key}' not found`);
  }
  return toOntologyResponse(data);
}

export async function renameOntology(
  key: string,
  body: OntologyRenameInput,
  registry: OntologyRegistry,
): Promise<OntologyResponseBody> {
  const existing = await registry.getOntologyByDisplayName(body.displayName);
  if (existing && existing.key !== key) {
    throw new ConflictError(
      `Ontology with display name '${body.displayName}' already exists`,
    );
  }
  const data = await registry.renameOntology(key, body.displayName);
  if (!data) {
    throw new NotFoundError(`Ontology '${key}' not found`);
  }
  return toOntologyResponse(data);
}

export async function deleteOntology(
  key: string,
  registry: OntologyRegistry,
): Promise<void> {
  const deleted = await registry.deleteOntology(key);
  if (!deleted) {
    throw new NotFoundError(`Ontology '${key}' not found`);
  }
  // The cascade destroyed the ontology's lenses; cached runtime schemas
  // built over them must not survive it (wholesale, like every modeling
  // mutation).
  invalidateLoadedSchemaCache();
}
