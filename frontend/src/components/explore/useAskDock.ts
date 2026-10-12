import { useMemo, useState } from 'react'
import { DEFAULT_ASSISTANT } from '@/components/assistants/chat/chatModel'
import { readJson, storageKeys, writeJson } from '@/lib/storage'

/** What the browser remembers of the dock per ontology + lens. */
interface DockSettings {
  open: boolean
  width: number
  /** The assistant chosen in the picker. */
  assistant: string
  /** Add every answer's cited entities to the canvas when it completes. */
  autoAdd: boolean
}

export const MIN_WIDTH = 300
export const MAX_WIDTH = 640
const DEFAULTS: DockSettings = { open: false, width: 380, assistant: DEFAULT_ASSISTANT, autoAdd: false }

function readSettings(ontologyKey: string, lensKey: string): DockSettings {
  const raw = readJson<Partial<DockSettings>>(storageKeys.exploreAsk(ontologyKey, lensKey))
  if (raw === null || typeof raw !== 'object') return DEFAULTS
  return {
    open: raw.open === true,
    width: typeof raw.width === 'number' ? Math.min(MAX_WIDTH, Math.max(MIN_WIDTH, raw.width)) : DEFAULTS.width,
    assistant: typeof raw.assistant === 'string' ? raw.assistant : DEFAULTS.assistant,
    autoAdd: raw.autoAdd === true,
  }
}

/** The dock's remembered state; its width leaves the canvas some room in a narrow window. */
export function useAskDock(ontologyKey: string, lensKey: string, available: number) {
  const [settings, setSettings] = useState(() => readSettings(ontologyKey, lensKey))
  const width = Math.max(MIN_WIDTH, Math.min(settings.width, available - 48))
  const actions = useMemo(() => {
    const update = (patch: (current: DockSettings) => Partial<DockSettings>) => setSettings((current) => {
      const next = { ...current, ...patch(current) }
      writeJson(storageKeys.exploreAsk(ontologyKey, lensKey), next)
      return next
    })
    return {
      /** The toolbar button and its key. */
      toggle: () => update((current) => ({ open: !current.open })),
      close: () => update(() => ({ open: false })),
      setWidth: (w: number) => update(() => ({ width: Math.min(MAX_WIDTH, Math.max(MIN_WIDTH, Math.round(w))) })),
      setAssistant: (assistant: string) => update(() => ({ assistant })),
      setAutoAdd: (autoAdd: boolean) => update(() => ({ autoAdd })),
    }
  }, [ontologyKey, lensKey])
  return useMemo(() => ({ settings, width, ...actions }), [settings, width, actions])
}
