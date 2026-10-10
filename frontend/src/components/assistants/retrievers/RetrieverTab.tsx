import { useFeatures, useRuntimeSchema, useSearchCatalog } from '@/api/hooks'
import { AssistantTab } from '@/components/assistants/chat/AssistantTab'
import { RetrieverChat } from './RetrieverChat'

/**
 * Workbench Assistants → Retrievers: chat with one of the lens's
 * retrievers; only on a server with search indices.
 */
export function RetrieverTab({ ontologyKey, lensKey }: { ontologyKey: string; lensKey: string }) {
  const features = useFeatures().data
  const supported = features?.searchIndices === true
  const catalog = useSearchCatalog(ontologyKey, lensKey, supported)
  const schema = useRuntimeSchema(ontologyKey, lensKey)

  if (features?.searchIndices === false) {
    return <div className="p-6 text-sm text-muted-foreground">Retrievers answer over search indices, which this server's storage adapter does not support.</div>
  }
  return (
    <AssistantTab ontologyKey={ontologyKey} lensKey={lensKey} kind="retrievers" enabled={supported}>
      {(retriever, picker) => (
        <RetrieverChat
          key={retriever.key}
          ontologyKey={ontologyKey}
          lensKey={lensKey}
          retrieverKey={retriever.key}
          name={retriever.name}
          description={retriever.description}
          blockedReason={null}
          diagnostics="toggle"
          remember
          catalog={catalog.data}
          schema={schema.data}
          picker={picker}
        />
      )}
    </AssistantTab>
  )
}
