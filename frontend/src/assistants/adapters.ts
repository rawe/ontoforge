/**
 * The one presentation-adapter registry: every assistant kind's nouns,
 * icon, request, turn model and answer details, the same on every surface
 * (Workbench chats, the ask dock, the Studio's test panels and its
 * assistant panel). A new presentation is one entry here; a new persisted
 * kind still needs its server routes, storage and editor.
 */

import { agents } from './adapters/agents'
import { navigators } from './adapters/navigators'
import { retrievers } from './adapters/retrievers'
import { studio } from './adapters/studio'
import type { AnyAdapter, PresentationAdapter } from './types'

const entry = <E extends { type: string }, I>(adapter: PresentationAdapter<E, I>) => adapter as unknown as AnyAdapter

export const adapters = {
  agents: entry(agents),
  retrievers: entry(retrievers),
  navigators: entry(navigators),
  studio: entry(studio),
} satisfies Record<string, AnyAdapter>

export type AdapterKind = keyof typeof adapters

export const adapterOf = (kind: AdapterKind): AnyAdapter => adapters[kind]
