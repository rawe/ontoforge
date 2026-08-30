/**
 * Zod schemas for the ontology registry REST surface. Same conventions
 * as the modeling surface: camelCase field names, internal identifiers
 * exposed by design, nullable optionals serialized as explicit `null`.
 */

import { z } from "zod";

import { KEY_PATTERN, MAX_ONTOLOGY_KEY_LENGTH } from "../core/schemas.js";

export const OntologyCreate = z.object({
  key: z.string().regex(KEY_PATTERN).max(MAX_ONTOLOGY_KEY_LENGTH),
  // Absent means no display name — an ontology starts nameless unless
  // one is chosen at creation.
  displayName: z.string().nullable().optional(),
});

/** Rename touches the display name only; the key is immutable and
 * absent from this surface. */
export const OntologyRename = z.object({
  displayName: z.string(),
});

export const OntologyResponse = z.object({
  ontologyId: z.string(),
  key: z.string(),
  displayName: z.string().nullable(),
  createdAt: z.iso.datetime(),
  updatedAt: z.iso.datetime(),
});

export type OntologyCreateInput = z.infer<typeof OntologyCreate>;
export type OntologyRenameInput = z.infer<typeof OntologyRename>;
export type OntologyResponseBody = z.infer<typeof OntologyResponse>;
