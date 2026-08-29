import { useCallback, useState } from 'react'
import { readJson, storageKeys, writeJson } from '@/lib/storage'

const MAX_HISTORY = 10

/**
 * Last 10 run query strings for one lens, persisted under
 * `of.queryHistory.{lensKey}`. Mount the consuming component keyed by
 * lens so the initial read matches the active lens.
 */
export function useQueryHistory(lensKey: string) {
  const [history, setHistory] = useState<string[]>(
    () => readJson<string[]>(storageKeys.queryHistory(lensKey)) ?? [],
  )

  const push = useCallback(
    (query: string) => {
      const trimmed = query.trim()
      if (trimmed === '') return
      setHistory((prev) => {
        const next = [trimmed, ...prev.filter((c) => c !== trimmed)].slice(0, MAX_HISTORY)
        writeJson(storageKeys.queryHistory(lensKey), next)
        return next
      })
    },
    [lensKey],
  )

  return { history, push }
}
