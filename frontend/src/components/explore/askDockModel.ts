/**
 * The ask dock's pure parts: what the browser remembers of it, read back
 * from an earlier shape too, and which assistant answers — the chosen one,
 * else its kind's `Default`, else the first assistant the lens has.
 *
 * No React, no I/O — unit-tested with `node --test`.
 */
import type { AssistantKind } from '@/api/types'
import { DEFAULT_ASSISTANT } from '../assistants/chat/chatModel.ts'

/** The kinds in the picker, in its order. */
export const ASK_KIND_ORDER: readonly AssistantKind[] = ['navigators', 'retrievers', 'agents']

/** One assistant of the lens: its kind and key. */
export interface AssistantChoice {
  kind: AssistantKind
  key: string
}

/** What the browser remembers of the dock per ontology + lens. */
export interface DockSettings {
  open: boolean
  width: number
  /** The kind of the assistant chosen in the picker. */
  kind: AssistantKind
  /** The chosen assistant's key. */
  assistant: string
  /** Add every answer's cited entities to the canvas when it completes. */
  autoAdd: boolean
}

export const MIN_WIDTH = 300
export const MAX_WIDTH = 640
export const DEFAULT_SETTINGS: DockSettings = {
  open: false, width: 380, kind: 'navigators', assistant: DEFAULT_ASSISTANT, autoAdd: false,
}

export const clampWidth = (width: number) => Math.min(MAX_WIDTH, Math.max(MIN_WIDTH, width))

/**
 * The remembered settings; anything missing or malformed takes its
 * default. A setting without a kind names an assistant of the default kind.
 */
export function parseSettings(raw: unknown): DockSettings {
  if (raw === null || typeof raw !== 'object' || Array.isArray(raw)) return DEFAULT_SETTINGS
  const value = raw as Partial<Record<keyof DockSettings, unknown>>
  const kind = ASK_KIND_ORDER.find((k) => k === value.kind) ?? (value.kind === undefined ? DEFAULT_SETTINGS.kind : null)
  return {
    open: value.open === true,
    width: typeof value.width === 'number' ? clampWidth(value.width) : DEFAULT_SETTINGS.width,
    // An unknown kind drops its assistant too: the key belonged to it.
    kind: kind ?? DEFAULT_SETTINGS.kind,
    assistant: kind !== null && typeof value.assistant === 'string' ? value.assistant : DEFAULT_SETTINGS.assistant,
    autoAdd: value.autoAdd === true,
  }
}

/**
 * The assistant that answers, from the lens's assistants per kind (absent
 * when the list could not be read): the chosen one, else the `Default` or
 * first of its kind, else of the first kind that has any. Null when the
 * lens has none.
 */
export function chooseAssistant(
  lists: Partial<Record<AssistantKind, readonly { key: string }[]>>,
  chosen: AssistantChoice,
): AssistantChoice | null {
  const own = lists[chosen.kind]
  if (own?.some((a) => a.key === chosen.key)) return chosen
  for (const kind of [chosen.kind, ...ASK_KIND_ORDER.filter((k) => k !== chosen.kind)]) {
    const list = lists[kind] ?? []
    const first = list.find((a) => a.key === DEFAULT_ASSISTANT) ?? list[0]
    if (first !== undefined) return { kind, key: first.key }
  }
  return null
}

/** A choice as one picker value, and back; kinds hold no `:`, keys may. */
export const choiceValue = (choice: AssistantChoice) => `${choice.kind}:${choice.key}`
export function parseChoice(value: string): AssistantChoice | null {
  const at = value.indexOf(':')
  const kind = ASK_KIND_ORDER.find((k) => k === value.slice(0, at))
  return at === -1 || kind === undefined ? null : { kind, key: value.slice(at + 1) }
}
