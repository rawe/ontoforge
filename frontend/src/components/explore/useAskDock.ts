import { useMemo, useState } from 'react'
import { readJson, storageKeys, writeJson } from '@/lib/storage'
import { clampWidth, MIN_WIDTH, parseSettings, type AssistantChoice, type DockSettings } from './askDockModel'

/** The dock's remembered state; its width leaves the canvas some room in a narrow window. */
export function useAskDock(ontologyKey: string, lensKey: string, available: number) {
  const [settings, setSettings] = useState(() => parseSettings(readJson<unknown>(storageKeys.exploreAsk(ontologyKey, lensKey))))
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
      setWidth: (w: number) => update(() => ({ width: clampWidth(Math.round(w)) })),
      setAssistant: ({ kind, key }: AssistantChoice) => update(() => ({ kind, assistant: key })),
      setAutoAdd: (autoAdd: boolean) => update(() => ({ autoAdd })),
    }
  }, [ontologyKey, lensKey])
  return useMemo(() => ({ settings, width, ...actions }), [settings, width, actions])
}
