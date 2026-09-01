/**
 * Server API client — `/api/server`, the one phase-neutral surface:
 * read-only server-capability reads.
 */

import { request } from './http'
import type { Features } from './types'

export const getFeatures = () => request<Features>('/api/server/features')
