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
  send: (at, key, body, onEvent, signal) => chatRetriever(at.ontologyKey, lensOf(at), key, body, onEvent, signal),
  model: retrieverTurns,
  cites: false,
  details: null,
}
