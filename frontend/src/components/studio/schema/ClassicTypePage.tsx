/**
 * Classic page of one entity or relation type, addressed by key and built from
 * the shared modeling components: `TypeHeader` (page), `PropertiesEditor`
 * (comfortable), the relation types of an entity type, its search indices, and
 * delete. Lives in the schema workspace, below its `CascadeProvider` and
 * `DeleteProvider`; jump links select through the workspace.
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
import { findTypeByKey, useModelSchema, type TypeKind } from '../modeling/useModelSchema'
import { buildSchemaUrl } from './schemaUrl'
import { addRequestOf, openRequestOf, useSchemaWorkspace } from './workspaceContext'

interface ClassicTypePageProps {
  kind: TypeKind
  typeKey: string
}

export function ClassicTypePage({ kind, typeKey }: ClassicTypePageProps) {
  const { ontologyKey, propertyRequest, addPropertyRequest, select } = useSchemaWorkspace()
  const schema = useModelSchema(ontologyKey)
  const type = findTypeByKey(schema, kind, typeKey)
  const listPath = buildSchemaUrl(ontologyKey, 'classic', null)
  const selectType = (t: TypeRef) => select({ kind: t.kind, key: t.key })

  if (schema.isPending) return <TypePageSkeleton />

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

  if (type === undefined) return <TypeNotFound ontologyKey={ontologyKey} kind={kind} />

  const typeId = 'entityTypeId' in type ? type.entityTypeId : type.relationTypeId

  return (
    <div>
      <header className="border-b px-6 py-4">
        <Link
          to={listPath}
          replace
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
          onSelectType={selectType}
        />
      </header>
      <div className="grid max-w-5xl gap-8 p-6">
        <PropertiesEditor
          key={typeId}
          ontologyKey={ontologyKey}
          kind={kind}
          typeId={typeId}
          density="comfortable"
          openRequest={openRequestOf(propertyRequest, schema.properties[typeId])}
          addRequest={addRequestOf(addPropertyRequest, { kind, key: typeKey })}
        />
        {kind === 'entity-types' && (
          <TypeRelations
            ontologyKey={ontologyKey}
            entityTypeId={typeId}
            variant="page"
            onSelectType={selectType}
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

export function TypePageSkeleton() {
  return (
    <div className="space-y-4 p-6">
      <Skeleton className="h-8 w-64" />
      <Skeleton className="h-40 rounded-xl" />
    </div>
  )
}

/** A type address (key or legacy id) that names no type. */
export function TypeNotFound({ ontologyKey, kind }: { ontologyKey: string; kind: TypeKind }) {
  return (
    <EmptyState
      icon={Box}
      title={`${kind === 'entity-types' ? 'Entity' : 'Relation'} type not found`}
      description="It may have been deleted."
      action={
        <Button variant="outline" asChild>
          <Link to={buildSchemaUrl(ontologyKey, 'classic', null)} replace>
            All types
          </Link>
        </Button>
      }
    />
  )
}
