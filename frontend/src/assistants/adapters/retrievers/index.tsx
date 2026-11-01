import { ScanSearch } from 'lucide-react'
import { chatRetriever, type RetrieverKindEvent } from '@/api/retrievers'
import { retrieverTurns, type RetrieverInsight } from '@/components/assistants/retrievers/retrieverModel'
import type { PresentationAdapter } from '../../types'
import { lensOf } from '../lens'

/** Retrievers: a fixed pipeline that finds entities and answers from them. */
export const retrievers: PresentationAdapter<RetrieverKindEvent, RetrieverInsight> = {
  kind: 'retrievers',
  nouns: { one: 'Retriever', many: 'retrievers' },
  icon: ScanSearch,
  // Diagnostics are the Workbench's own chat; asked from elsewhere, a retriever shows its running phase only.
  send: (at, key, body, onEvent, signal) =>
    chatRetriever(at.ontologyKey, lensOf(at), key, { ...body, diagnostics: false }, onEvent, signal),
  model: retrieverTurns,
  cites: false,
  details: null,
}
