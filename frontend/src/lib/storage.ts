/**
 * Tiny localStorage helpers. All persisted UI state lives under `of.*` keys:
 *
 *   of.lastOntology          — key of the last-used ontology
 *   of.theme                 — managed by next-themes (light|dark|system)
 *   of.sidebar               — "expanded" | "collapsed"
 *   of.explore.{ontologyKey} — Explorer canvas working set (later slice)
 *   of.chat.{ontologyKey}    — AI chat history (later slice)
 *   of.recents.{ontologyKey} — last 10 opened entities (see `lib/recents.ts`)
 *   of.queryHistory.{ontologyKey} — last 10 run Cypher queries (Query console)
 */

export const storageKeys = {
  lastOntology: 'of.lastOntology',
  theme: 'of.theme',
  sidebar: 'of.sidebar',
  explore: (ontologyKey: string) => `of.explore.${ontologyKey}`,
  chat: (ontologyKey: string) => `of.chat.${ontologyKey}`,
  recents: (ontologyKey: string) => `of.recents.${ontologyKey}`,
  queryHistory: (ontologyKey: string) => `of.queryHistory.${ontologyKey}`,
} as const

export function readString(key: string): string | null {
  try {
    return localStorage.getItem(key)
  } catch {
    return null
  }
}

export function writeString(key: string, value: string): void {
  try {
    localStorage.setItem(key, value)
  } catch {
    /* storage unavailable — ignore */
  }
}

export function remove(key: string): void {
  try {
    localStorage.removeItem(key)
  } catch {
    /* ignore */
  }
}

export function readJson<T>(key: string): T | null {
  const raw = readString(key)
  if (raw === null) return null
  try {
    return JSON.parse(raw) as T
  } catch {
    return null
  }
}

export function writeJson(key: string, value: unknown): void {
  writeString(key, JSON.stringify(value))
}
