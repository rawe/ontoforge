/**
 * Server API client — `/api/server`, the one phase-neutral surface:
 * read-only reads describing the deployment.
 */

import { request } from './http'
import type { Features, ServerInfo } from './types'

export const getServerInfo = () => request<ServerInfo>('/api/server/info')

export const getFeatures = () => request<Features>('/api/server/features')
