/**
 * The assistant module's shared nouns: where an assistant answers (its
 * binding), what a Studio page has in view (its focus), and what the module
 * needs to know to show one assistant kind (its presentation adapter).
 */

import type { LucideIcon } from 'lucide-react'
import type { ReactNode } from 'react'
import type { ToolCall } from '@/api/types'
import type { Turn, TurnModel } from './conversation/chatModel.ts'
import type { ChatRequest, SharedEvent } from './stream/chatStream.ts'

/** Where an assistant answers: one lens, or (`lensKey: null`) the whole ontology — the Studio helper. */
export interface Binding {
  ontologyKey: string
  lensKey: string | null
}

/**
 * What a Studio page has in view, sent with a message as structured data,
 * never as text. A property names its type in `typeKey`, an agent its lens
 * in `lensKey`.
 */
export interface Focus {
  kind: 'entityType' | 'relationType' | 'property' | 'lens' | 'agent'
  key: string
  typeKey?: string
  lensKey?: string
}

/** How the module shows one assistant kind, the same on every surface. */
export interface PresentationAdapter<E extends { type: string }, I> {
  kind: string
  nouns: { one: string; many: string }
  icon: LucideIcon
  /** One message to an assistant of the kind; refusals before the stream throw. */
  send(at: Binding, assistantKey: string, body: ChatRequest, onEvent: (event: SharedEvent | E) => void, signal: AbortSignal): Promise<void>
  model: TurnModel<E, I>
  /** Its answers cite entities they met: the ask dock's auto-add has something to put on the canvas. */
  cites: boolean
  /** What the kind did for an answer, a collapsible section under it; null for none. */
  details: null | {
    /** The section's button; null while the answer has nothing to show there. */
    label: (turn: Turn<I>) => ReactNode
    content: (turn: Turn<I>, at: Binding) => ReactNode
  }
  /**
   * Cards under an answer, each from one of its tool results (a draft to
   * fill, a proposal to review); none when omitted.
   */
  cards?: (turn: Turn<I>, at: Binding) => ReactNode
}

/** An adapter without its own types: a surface hands it only turns its own model built. */
export type AnyAdapter = PresentationAdapter<{ type: string }, unknown>

/** A card a completed tool call puts under its answer. */
export type ToolCard = (call: ToolCall, turn: Turn<ToolCall[]>, at: Binding) => ReactNode
