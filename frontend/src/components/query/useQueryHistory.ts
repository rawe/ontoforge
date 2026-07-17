import { useCallback, useState } from 'react'
import { readJson, storageKeys, writeJson } from '@/lib/storage'

const MAX_HISTORY = 10

/**
 * Last 10 run Cypher strings for one ontology, persisted under
 * `of.queryHistory.{ontologyKey}`. Mount the consuming component keyed by
 * ontology so the initial read matches the active ontology.
 */
export function useQueryHistory(ontologyKey: string) {
  const [history, setHistory] = useState<string[]>(
    () => readJson<string[]>(storageKeys.queryHistory(ontologyKey)) ?? [],
  )

  const push = useCallback(
    (cypher: string) => {
      const trimmed = cypher.trim()
      if (trimmed === '') return
      setHistory((prev) => {
        const next = [trimmed, ...prev.filter((c) => c !== trimmed)].slice(0, MAX_HISTORY)
        writeJson(storageKeys.queryHistory(ontologyKey), next)
        return next
      })
    },
    [ontologyKey],
  )

  return { history, push }
}
