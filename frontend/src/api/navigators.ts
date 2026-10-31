/**
 * Navigators: lens-local saved configurations of the Navigator assistant
 * kind, which answers multi-hop questions by anchoring the entities a
 * question names, walking their relations and answering from the cards it
 * found. Modeling CRUD by lens key + navigator key under
 * `assistants/navigators`, the runtime chat on a thread with the graph
 * kind's stream events (`navigator.*`) beside the shared ones. Every lens
 * also has the built-in `_default`, derived from the lens: first in the runtime list
 * (`runtime.ts` → `listAssistants`), never a modeling resource.
 */
import { assistantPath, postChat, type ChatRequest, type SharedEvent } from '../assistants/stream/chatStream.ts'
import { graphKindReader, type GraphEvent } from './graphEvents.ts'
import { request } from './http.ts'

export interface NavigatorConfig {
  /** Integer 1..3: how far the walk goes from an anchor. */
  hops: number
  /** Relation type keys the walk may follow; null = every one the lens shows. */
  relationTypes: string[] | null
  /** Entity type keys a mention may resolve to; null = every one the lens shows. */
  anchorTypes: string[] | null
  /** Integer 10..80: evidence cards handed to the answer model. */
  maxEntities: number
  /** Extra guidance for the answer (tone, focus, format). */
  instructions: string | null
}

export interface NavigatorWrite {
  name: string
  description: string | null
  configVersion: 1
  config: NavigatorConfig
}

/** A stored navigator, checked against the lens on every read. */
export interface Navigator extends NavigatorWrite {
  key: string
  lensKey: string
  validation: { valid: boolean; errors: string[]; warnings: string[] }
  createdAt: string
  updatedAt: string
}

/** The limits and defaults of a configuration. */
export const NAVIGATOR_LIMITS = {
  hops: { min: 1, max: 3, default: 2 },
  maxEntities: { min: 10, max: 80, default: 40 },
  name: 200,
  description: 4000,
  instructions: 4000,
} as const

/** The kind's stream events are namespaced `navigator.*`. */
const reader = () => graphKindReader('navigator')

/* ---------------------------------- routes --------------------------------- */

const modelBase = (ontologyKey: string, lensKey: string) =>
  `/api/ontologies/${encodeURIComponent(ontologyKey)}/model/lenses/${encodeURIComponent(lensKey)}/assistants/navigators`
const modelNavigator = (ontologyKey: string, lensKey: string, key: string) =>
  `${modelBase(ontologyKey, lensKey)}/${encodeURIComponent(key)}`

/** The modeling list: stored navigators with configuration and validation (Studio). */
export const listNavigators = (ontologyKey: string, lensKey: string) =>
  request<Navigator[]>(modelBase(ontologyKey, lensKey))
export const getNavigator = (ontologyKey: string, lensKey: string, key: string, signal?: AbortSignal) =>
  request<Navigator>(modelNavigator(ontologyKey, lensKey, key), { signal })
/** Create (201) or replace (200); an invalid configuration answers 422 with `details.errors`. */
export const saveNavigator = (ontologyKey: string, lensKey: string, key: string, body: NavigatorWrite, signal?: AbortSignal) =>
  request<Navigator>(modelNavigator(ontologyKey, lensKey, key), {
    method: 'PUT', signal,
    body: { name: body.name, description: body.description, configVersion: body.configVersion, config: body.config },
  })
export const deleteNavigator = (ontologyKey: string, lensKey: string, key: string, signal?: AbortSignal) =>
  request<void>(modelNavigator(ontologyKey, lensKey, key), { method: 'DELETE', signal })

/** One message to the saved (or default) navigator on a thread. */
export async function chatNavigator(
  ontologyKey: string, lensKey: string, key: string,
  body: ChatRequest,
  onEvent: (event: SharedEvent | GraphEvent) => void, signal: AbortSignal,
) {
  await postChat(assistantPath(ontologyKey, lensKey, 'navigators', key), body, reader(), onEvent, signal)
}
