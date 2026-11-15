import { AssistantTab } from '@/components/assistants/AssistantTab'
import { RetrieverChat } from './RetrieverChat'

/**
 * Workbench Assistants → Retrievers: chat with one of the lens's
 * retrievers.
 */
export function RetrieverTab({ ontologyKey, lensKey }: { ontologyKey: string; lensKey: string }) {
  return (
    <AssistantTab ontologyKey={ontologyKey} lensKey={lensKey} kind="retrievers">
      {(retriever, picker) => (
        <RetrieverChat
          key={retriever.key}
          ontologyKey={ontologyKey}
          lensKey={lensKey}
          retrieverKey={retriever.key}
          name={retriever.name}
          description={retriever.description}
          blockedReason={null}
          remember
          picker={picker}
        />
      )}
    </AssistantTab>
  )
}
