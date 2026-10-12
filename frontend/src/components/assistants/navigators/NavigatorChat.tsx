import type { ReactNode } from 'react'
import { chatNavigator } from '@/api/navigators'
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
  picker?: ReactNode
  /** Where "New conversation" goes instead of a toolbar (the Studio test panel's header). */
  actions?: HTMLElement | null
}

/**
 * The navigator kind of the assistant chat — the Workbench Navigators tab
 * and the Studio test panel.
 */
export function NavigatorChat({ ontologyKey, lensKey, navigatorKey, name, description, blockedReason, remember, picker, actions }: NavigatorChatProps) {
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
