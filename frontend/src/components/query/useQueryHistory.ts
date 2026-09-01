import { useCallback, useState } from 'react'
import { readJson, storageKeys, writeJson } from '@/lib/storage'

const MAX_HISTORY = 10

/**
 * Last 10 run query strings for one lens, persisted under
 * `of.queryHistory.{ontologyKey}.{lensKey}`. Mount the consuming component
 * keyed by ontology + lens so the initial read matches the active lens.
 */
export function useQueryHistory(ontologyKey: string, lensKey: string) {
  const [history, setHistory] = useState<string[]>(
    () => readJson<string[]>(storageKeys.queryHistory(ontologyKey, lensKey)) ?? [],
  )

  const push = useCallback(
    (query: string) => {
      const trimmed = query.trim()
      if (trimmed === '') return
      setHistory((prev) => {
        const next = [trimmed, ...prev.filter((c) => c !== trimmed)].slice(0, MAX_HISTORY)
        writeJson(storageKeys.queryHistory(ontologyKey, lensKey), next)
        return next
      })
    },
    [ontologyKey, lensKey],
  )

  return { history, push }
}
