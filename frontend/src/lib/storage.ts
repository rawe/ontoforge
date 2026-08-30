/**
 * Tiny localStorage helpers. All persisted UI state lives under `of.*` keys.
 * Lens keys are unique only within their ontology, so every per-lens key is
 * qualified by ontology + lens:
 *
 *   of.lastLens.{ontologyKey} — key of that ontology's last-used lens; feeds
 *                               the ontology switcher's workbench landing
 *   of.theme                  — managed by next-themes (light|dark|system)
 *   of.sidebar                — "expanded" | "collapsed"
 *   of.explore.{ontologyKey}.{lensKey} — Explorer canvas working set
 *   of.chat.{ontologyKey}.{lensKey}    — AI chat history
 *   of.recents.{ontologyKey}.{lensKey} — last 10 opened entities (`lib/recents.ts`)
 *   of.queryHistory.{ontologyKey}.{lensKey} — last 10 run OQL queries
 */

export const storageKeys = {
  lastLens: (ontologyKey: string) => `of.lastLens.${ontologyKey}`,
  theme: 'of.theme',
  sidebar: 'of.sidebar',
  explore: (ontologyKey: string, lensKey: string) =>
    `of.explore.${ontologyKey}.${lensKey}`,
  chat: (ontologyKey: string, lensKey: string) => `of.chat.${ontologyKey}.${lensKey}`,
  recents: (ontologyKey: string, lensKey: string) =>
    `of.recents.${ontologyKey}.${lensKey}`,
  queryHistory: (ontologyKey: string, lensKey: string) =>
    `of.queryHistory.${ontologyKey}.${lensKey}`,
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
