import { request } from './http.ts'
import { readRetrievalStream, type RetrievalConfig, type RetrievalEvent, type RetrievalPreparation } from './retrievalPrototype.ts'
import type { ChatMessage } from './types'

export interface RetrieverInput {
  name: string
  description: string | null
  configVersion: 1
  config: RetrievalConfig
}
export interface RetrieverProfile extends Omit<RetrieverInput, 'configVersion'> {
  retrieverConfigId: string
  key: string
  configVersion: number
  createdAt: string
  updatedAt: string
  validation: { valid: boolean; errors: string[] }
}
export interface RetrieverExport extends RetrieverInput { key: string }

const modelBase = (ontologyKey: string, lensKey: string) =>
  `/api/ontologies/${encodeURIComponent(ontologyKey)}/model/lenses/${encodeURIComponent(lensKey)}/retrievers`
const modelProfile = (ontologyKey: string, lensKey: string, key: string) => `${modelBase(ontologyKey, lensKey)}/${encodeURIComponent(key)}`
const runtimeProfile = (ontologyKey: string, lensKey: string, key: string) =>
  `/api/ontologies/${encodeURIComponent(ontologyKey)}/runtime/lenses/${encodeURIComponent(lensKey)}/retrievers/${encodeURIComponent(key)}`

export const listRetrievers = (ontologyKey: string, lensKey: string) => request<RetrieverProfile[]>(modelBase(ontologyKey, lensKey))
export const saveRetriever = (ontologyKey: string, lensKey: string, key: string, body: RetrieverInput, signal?: AbortSignal) =>
  request<RetrieverProfile>(modelProfile(ontologyKey, lensKey, key), {
    method: 'PUT', signal,
    body: { name: body.name, description: body.description, configVersion: body.configVersion, config: body.config },
  })
export const deleteRetriever = (ontologyKey: string, lensKey: string, key: string, signal?: AbortSignal) =>
  request<void>(modelProfile(ontologyKey, lensKey, key), { method: 'DELETE', signal })
export const transferRetriever = (ontologyKey: string, lensKey: string, key: string, mode: 'copy' | 'move', body: { targetLensKey: string; targetKey: string }, signal?: AbortSignal) =>
  request<RetrieverProfile>(`${modelProfile(ontologyKey, lensKey, key)}/${mode}`, { method: 'POST', body, signal })
export const exportRetriever = (ontologyKey: string, lensKey: string, key: string, signal?: AbortSignal) =>
  request<RetrieverExport>(`${modelProfile(ontologyKey, lensKey, key)}/export`, { signal })
export const importRetriever = (ontologyKey: string, lensKey: string, body: RetrieverExport, signal?: AbortSignal) =>
  request<RetrieverProfile>(`${modelBase(ontologyKey, lensKey)}/import`, { method: 'POST', body, signal })
export const prepareSavedRetriever = (ontologyKey: string, lensKey: string, key: string, signal: AbortSignal) =>
  request<RetrievalPreparation>(`${runtimeProfile(ontologyKey, lensKey, key)}/prepare`, { method: 'POST', signal })

export async function chatSavedRetriever(
  ontologyKey: string, lensKey: string, key: string,
  body: { message: string; history: ChatMessage[]; turnToken?: string; diagnostics?: boolean },
  onEvent: (event: RetrievalEvent) => void, signal: AbortSignal,
) {
  const response = await fetch(`${runtimeProfile(ontologyKey, lensKey, key)}/chat`, {
    method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body), signal,
  })
  await readRetrievalStream(response, onEvent, signal)
}
