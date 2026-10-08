import { useIndexSchema, useSearchIndex, useSearchIndexPreview } from '@/api/searchIndexHooks'
import { EntryPreview } from '@/components/search/EntryPreview'
import { partTypes } from '@/components/search/entryOutline'
import { Skeleton } from '@/components/ui/skeleton'
import { cn } from '@/lib/utils'

/**
 * What one index lets a retriever agent match: its entries per entity,
 * composed from the schema by the index preview. Relation entries of
 * groups the agent leaves out are shown dimmed — the agent never searches them.
 */
export function IndexAnatomy({ ontologyKey, indexKey, relations }: {
  ontologyKey: string
  indexKey: string
  /** The relation groups the agent searches; undefined: all of them. */
  relations: string[] | undefined
}) {
  const record = useSearchIndex(ontologyKey, indexKey).data
  const schema = useIndexSchema(ontologyKey)
  // A managed key holds `~`, which a draft may not: outline the definition keyless.
  const input = record === undefined ? null : { ...record.definition, key: undefined }
  const outline = useSearchIndexPreview(ontologyKey, input).data?.outline
  if (record === undefined || schema === undefined || outline == null) return <Skeleton className="h-24 w-full" />

  const { definition } = record
  const root = schema.entityTypes.find((t) => t.key === definition.entityType)
  const rootName = root?.displayName ?? definition.entityType
  const documentName = root?.properties.find((p) => definition.fields.includes(p.key) && p.dataType === 'document')?.displayName
  if (outline.length === 0) return <p className="text-xs text-muted-foreground">This index composes no entries against the current schema.</p>

  return <div className="grid gap-2">
    <p className="text-xs text-muted-foreground">
      Every entry below is ranked on its own; a {rootName} is found by its best entry, and that entry is reported as what matched.
    </p>
    {outline.map((part) => {
      const relationName = schema.relationTypes.find((r) => r.key === part.relationType)?.displayName ?? part.relationType
      const label = part.groupNo === null ? null : (definition.relations[part.groupNo]?.label ?? relationName)
      const searched = part.partKind !== 'relation' || relations === undefined || relations.includes(part.relationType ?? '')
      const caption = part.partKind === 'self' ? <>One own entry per {rootName}</>
        : part.partKind === 'passage' ? <>One passage entry per chunk of {documentName ?? 'the document'}</>
        : <>One “{label}” entry per {relationName} relation{searched ? '' : ' — not searched by this agent'}</>
      return <div key={`${part.partKind}-${part.groupNo}`} className={cn(!searched && 'opacity-50')}>
        <EntryPreview part={part} types={root && partTypes(schema, root.key, part)} caption={caption}
          semantic={definition.semantic.enabled} keyword={definition.keyword.enabled} stale={false} />
      </div>
    })}
  </div>
}
