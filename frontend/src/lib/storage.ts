/**
 * Tiny localStorage helpers. All persisted UI state lives under `of.*` keys:
 *
 *   of.lastLens          — key of the last-used lens
 *   of.theme                 — managed by next-themes (light|dark|system)
 *   of.sidebar               — "expanded" | "collapsed"
 *   of.explore.{lensKey} — Explorer canvas working set (later slice)
 *   of.chat.{lensKey}    — AI chat history (later slice)
 *   of.recents.{lensKey} — last 10 opened entities (see `lib/recents.ts`)
 *   of.queryHistory.{lensKey} — last 10 run OQL queries (Query console)
 */

export const storageKeys = {
  lastLens: 'of.lastLens',
  theme: 'of.theme',
  sidebar: 'of.sidebar',
  explore: (lensKey: string) => `of.explore.${lensKey}`,
  chat: (lensKey: string) => `of.chat.${lensKey}`,
  recents: (lensKey: string) => `of.recents.${lensKey}`,
  queryHistory: (lensKey: string) => `of.queryHistory.${lensKey}`,
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
