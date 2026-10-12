import { useMemo, useState } from 'react'
import { DEFAULT_ASSISTANT } from '@/components/assistants/chat/chatModel'
import { readJson, storageKeys, writeJson } from '@/lib/storage'

export type DockView = 'open' | 'collapsed' | 'closed'

/** What the browser remembers of the dock per ontology + lens. */
interface DockSettings {
  view: DockView
  width: number
  /** The assistant chosen in the picker. */
  assistant: string
  /** Add every answer's cited entities to the canvas when it completes. */
  autoAdd: boolean
}

export const MIN_WIDTH = 300
export const MAX_WIDTH = 640
/** Below this canvas width an open dock shows as its rail until opened explicitly. */
const NARROW = 720
const DEFAULTS: DockSettings = { view: 'closed', width: 380, assistant: DEFAULT_ASSISTANT, autoAdd: false }

function readSettings(ontologyKey: string, lensKey: string): DockSettings {
  const raw = readJson<Partial<DockSettings>>(storageKeys.exploreAsk(ontologyKey, lensKey))
  if (raw === null || typeof raw !== 'object') return DEFAULTS
  return {
    view: raw.view === 'open' || raw.view === 'collapsed' ? raw.view : 'closed',
    width: typeof raw.width === 'number' ? Math.min(MAX_WIDTH, Math.max(MIN_WIDTH, raw.width)) : DEFAULTS.width,
    assistant: typeof raw.assistant === 'string' ? raw.assistant : DEFAULTS.assistant,
    autoAdd: raw.autoAdd === true,
  }
}

/**
 * The dock's remembered state and how it is shown: an open dock in a
 * narrow window shows as its rail until it is opened in this session.
 */
export function useAskDock(ontologyKey: string, lensKey: string, available: number) {
  const [settings, setSettings] = useState(() => readSettings(ontologyKey, lensKey))
  // Opened explicitly in this session: an open dock stays open in a narrow window.
  const [expanded, setExpanded] = useState(false)
  const narrow = available > 0 && available < NARROW
  const view: DockView = settings.view === 'open' && narrow && !expanded ? 'collapsed' : settings.view
  const width = Math.max(MIN_WIDTH, Math.min(settings.width, available - 48))
  const actions = useMemo(() => {
    const update = (patch: Partial<DockSettings>) => setSettings((current) => {
      const next = { ...current, ...patch }
      writeJson(storageKeys.exploreAsk(ontologyKey, lensKey), next)
      return next
    })
    return {
      open: () => {
        setExpanded(true)
        update({ view: 'open' })
      },
      collapse: () => {
        setExpanded(false)
        update({ view: 'collapsed' })
      },
      close: () => update({ view: 'closed' }),
      setWidth: (w: number) => update({ width: Math.min(MAX_WIDTH, Math.max(MIN_WIDTH, Math.round(w))) }),
      setAssistant: (assistant: string) => update({ assistant }),
      setAutoAdd: (autoAdd: boolean) => update({ autoAdd }),
    }
  }, [ontologyKey, lensKey])
  return useMemo(() => ({
    settings,
    view,
    width,
    ...actions,
    /** The toolbar button and its key: open it, or close an open one. */
    toggle: () => (view === 'open' ? actions.close() : actions.open()),
  }), [settings, view, width, actions])
}
