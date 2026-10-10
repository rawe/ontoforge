/**
 * Classic page of one entity or relation type, built from the shared modeling
 * components: `TypeHeader` (page), `PropertiesEditor` (comfortable), the
 * relation types of an entity type, its search indices, and delete. Needs a
 * `CascadeProvider` and a `DeleteProvider` above it. Navigation is the
 * surface's (`onSelectType`).
 */

import { Box, ChevronLeft, SearchX } from 'lucide-react'
import { Link } from 'react-router-dom'
import { EmptyState } from '@/components/EmptyState'
import { EntityTypeIndices } from '@/components/search/EntityTypeIndices'
import { Button } from '@/components/ui/button'
import { Skeleton } from '@/components/ui/skeleton'
import { DeleteTypeButton } from '../modeling/DeleteDialog'
import type { TypeRef } from '../modeling/deleteContext'
import { PropertiesEditor } from '../modeling/PropertiesEditor'
import { TypeHeader } from '../modeling/TypeHeader'
import { TypeRelations } from '../modeling/TypeRelations'
import { findType, useModelSchema, type TypeKind } from '../modeling/useModelSchema'

interface ClassicTypePageProps {
  ontologyKey: string
  kind: TypeKind
  typeId: string
  onSelectType: (type: TypeRef) => void
}

export function ClassicTypePage({ ontologyKey, kind, typeId, onSelectType }: ClassicTypePageProps) {
  const schema = useModelSchema(ontologyKey)
  const type = findType(schema, kind, typeId)
  const schemaPath = `/o/${ontologyKey}/studio`

  if (schema.isPending) {
    return (
      <div className="space-y-4 p-6">
        <Skeleton className="h-8 w-64" />
        <Skeleton className="h-40 rounded-xl" />
      </div>
    )
  }

  if (type === undefined && schema.error !== null) {
    return (
      <EmptyState
        icon={SearchX}
        title="Failed to load schema"
        description={schema.error.message}
        className="py-24"
      />
    )
  }

  if (type === undefined) {
    return (
      <EmptyState
        icon={Box}
        title={`${kind === 'entity-types' ? 'Entity' : 'Relation'} type not found`}
        description="It may have been deleted."
        action={
          <Button variant="outline" asChild>
            <Link to={schemaPath}>Back to schema</Link>
          </Button>
        }
      />
    )
  }

  return (
    <div>
      <header className="border-b px-6 py-4">
        <Link
          to={schemaPath}
          className="mb-2 inline-flex items-center gap-1 text-xs text-muted-foreground transition-colors hover:text-foreground"
        >
          <ChevronLeft className="size-3.5" /> Schema
        </Link>
        <TypeHeader
          key={typeId}
          ontologyKey={ontologyKey}
          kind={kind}
          typeId={typeId}
          variant="page"
          onSelectType={onSelectType}
        />
      </header>
      <div className="grid max-w-5xl gap-8 p-6">
        <PropertiesEditor
          key={typeId}
          ontologyKey={ontologyKey}
          kind={kind}
          typeId={typeId}
          density="comfortable"
        />
        {kind === 'entity-types' && (
          <TypeRelations
            ontologyKey={ontologyKey}
            entityTypeId={typeId}
            variant="page"
            onSelectType={onSelectType}
          />
        )}
        {kind === 'entity-types' && (
          <EntityTypeIndices ontologyKey={ontologyKey} entityTypeKey={type.key} />
        )}
        <div>
          <DeleteTypeButton kind={kind} id={typeId} />
        </div>
      </div>
    </div>
  )
}
