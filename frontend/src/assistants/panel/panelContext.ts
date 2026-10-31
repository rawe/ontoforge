/** The context of `AssistantPanelHost`: what pages publish into the panel, and the calls that open it. */

import { createContext, useContext, useEffect } from 'react'
import type { DraftEditor } from '../draft/draftFillModel'
import type { Focus } from '../types'
import { focusFromId, focusId } from './panelModel'

export interface AssistantPanel {
  /** The server has a language model: the panel and its entry points show. */
  available: boolean
  isOpen: boolean
  /** Open the panel; with a focus, the chip shows it. The input stays as it is. */
  open: (options?: { focus?: Focus }) => void
  close: () => void
  toggle: () => void
  /** The page's focus changed to this one (null: nothing in view). */
  publish: (focus: Focus | null) => void
  /** The page no longer shows this focus. */
  unpublish: (focus: Focus) => void
  /** An editor with a draft the helper may fill opened; the call returned withdraws it. */
  publishDraft: (editor: DraftEditor) => () => void
  /** The open draft editor, if any: its draft goes with each message, its cards fill it. */
  draftEditor: () => DraftEditor | null
}

export const AssistantPanelContext = createContext<AssistantPanel | null>(null)

const NONE: AssistantPanel = {
  available: false, isOpen: false, open: () => {}, close: () => {}, toggle: () => {}, publish: () => {}, unpublish: () => {},
  publishDraft: () => () => {}, draftEditor: () => null,
}

/** The panel of the layout; outside one (no host), an unavailable panel whose calls do nothing. */
export function useAssistantPanel(): AssistantPanel {
  return useContext(AssistantPanelContext) ?? NONE
}

/**
 * A page tells the panel what it has in view; the chip follows each change,
 * and the focus is withdrawn when the page unmounts.
 */
export function usePublishFocus(focus: Focus | null): void {
  const { publish, unpublish } = useAssistantPanel()
  // The id stands for the focus, so a new object with the same content publishes nothing new.
  const id = focusId(focus)
  useEffect(() => {
    const published = id === null ? null : focusFromId(id)
    publish(published)
    return () => {
      if (published !== null) unpublish(published)
    }
  }, [id, publish, unpublish])
}

