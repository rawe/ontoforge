/**
 * Ontology registry API client — `/api/ontologies`, addressed by KEY.
 */

import { request } from './http'
import type { Ontology } from './types'

export const listOntologies = () => request<Ontology[]>('/api/ontologies')
