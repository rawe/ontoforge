/**
 * Ontology registry API client — `/api/ontologies`, addressed by KEY.
 */

import { request } from './http'
import type { Ontology, OntologyCreateInput, OntologyRenameInput } from './types'

export const listOntologies = () => request<Ontology[]>('/api/ontologies')

export const createOntology = (body: OntologyCreateInput) =>
  request<Ontology>('/api/ontologies', { method: 'POST', body })

export const renameOntology = (ontologyKey: string, body: OntologyRenameInput) =>
  request<Ontology>(`/api/ontologies/${ontologyKey}`, { method: 'PATCH', body })

/** Hard cascade — removes the ontology with its entire schema, lenses and data. */
export const deleteOntology = (ontologyKey: string) =>
  request<undefined>(`/api/ontologies/${ontologyKey}`, { method: 'DELETE' })
