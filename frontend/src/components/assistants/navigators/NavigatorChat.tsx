import type { ReactNode } from 'react'
import { useQuery } from '@tanstack/react-query'
import { chatNavigator } from '@/api/navigators'
import { listEntities } from '@/api/runtime'
import type { RuntimeSchema } from '@/api/types'
import { GraphChat } from '@/components/assistants/graph/GraphChat'

interface NavigatorChatProps {
  ontologyKey: string
  lensKey: string
  /** The navigator's key; null = nothing to ask yet (an unsaved draft). */
  navigatorKey: string | null
  name: string
  description: string | null
  /** Why questions are blocked (unsaved, invalid); null = they run. */
  blockedReason: string | null
  /** Remember the thread in the browser and restore it on open (the Workbench); else each mount starts a new one. */
  remember: boolean
  /** The lens's schema, for the example questions. */
  schema: RuntimeSchema | undefined
  picker?: ReactNode
  /** Where "New conversation" goes instead of a toolbar (the Studio test panel's header). */
  actions?: HTMLElement | null
}

/** A relation to start from — one leading on to a second where the lens has such a chain — and its follower. */
function chain(schema: RuntimeSchema | undefined) {
  const named = new Set((schema?.entityTypes ?? []).filter((t) => t.nameProperty !== null).map((t) => t.key))
  const relations = (schema?.relationTypes ?? []).filter((r) => named.has(r.fromEntityTypeKey))
  for (const first of relations) {
    const next = schema!.relationTypes.find((r) => r.key !== first.key && r.fromEntityTypeKey === first.toEntityTypeKey)
    if (next !== undefined) return { first, next }
  }
  return relations[0] === undefined ? null : { first: relations[0], next: undefined }
}

/** Questions to start from, in the lens's words and about one of its entities; `…` when it has none yet. */
function examples(start: string | null, route: ReturnType<typeof chain>): string[] {
  const at = start === null ? '…' : `“${start}”`
  const lower = (name: string) => name.toLowerCase()
  return [
    `What is ${at} connected to?`,
    ...(route === null ? [] : [`Follow “${lower(route.first.displayName)}” from ${at} — what do you find?`]),
    ...(route?.next === undefined
      ? [`How are ${at} and … related?`]
      : [`Starting at ${at}: ${lower(route.first.displayName)}, then ${lower(route.next.displayName)} — what is at the end?`]),
  ]
}

/**
 * The navigator kind of the assistant chat — the Workbench Navigators tab
 * and the Studio test panel.
 */
export function NavigatorChat({ ontologyKey, lensKey, navigatorKey, name, description, blockedReason, remember, schema, picker, actions }: NavigatorChatProps) {
  const route = chain(schema)
  const startType = schema?.entityTypes.find((t) => t.key === route?.first.fromEntityTypeKey)
  // One entity of the route's start type, so the examples name something real.
  const { data: sample } = useQuery({
    queryKey: ['navigator-example', ontologyKey, lensKey, startType?.key],
    queryFn: () => listEntities(ontologyKey, lensKey, startType!.key, { limit: 1 }),
    enabled: startType !== undefined,
    staleTime: Infinity,
  })
  const first = sample?.items[0]
  const start = first !== undefined && startType?.nameProperty ? String(first[startType.nameProperty] ?? '') || null : null
  return (
    <GraphChat
      ontologyKey={ontologyKey}
      lensKey={lensKey}
      kind="navigators"
      assistantKey={navigatorKey}
      name={name}
      description={description}
      intro="Finds the entities your question names, follows their relations and answers only from what it found, citing each entity. The steps and the evidence appear on the side as it works."
      placeholder="Ask how things are connected…"
      examples={examples(start, route)}
      blockedReason={blockedReason}
      remember={remember}
      // The Workbench may hide the sidebar; the Studio test panel always shows it.
      sidebar={remember ? 'toggle' : 'always'}
      send={(body, onEvent, signal) =>
        navigatorKey === null ? Promise.resolve() : chatNavigator(ontologyKey, lensKey, navigatorKey, body, onEvent, signal)}
      picker={picker}
      actions={actions}
    />
  )
}
