/**
 * The old type page addresses (`…/studio/entity-types/{id}`,
 * `…/studio/relation-types/{id}`) lead to the classic type page by key. The
 * address is replaced once the type list has loaded, so no extra history
 * entry is left behind. An unknown id shows the classic not-found state.
 */

import { SearchX } from 'lucide-react'
import { Navigate } from 'react-router-dom'
import { EmptyState } from '@/components/EmptyState'
import { findType, useModelSchema, type TypeKind } from '../modeling/useModelSchema'
import { TypeNotFound, TypePageSkeleton } from './ClassicTypePage'
import { buildSchemaUrl } from './schemaUrl'

interface LegacyTypeRedirectProps {
  ontologyKey: string
  kind: TypeKind
  id: string
}

export function LegacyTypeRedirect({ ontologyKey, kind, id }: LegacyTypeRedirectProps) {
  const schema = useModelSchema(ontologyKey)
  const type = findType(schema, kind, id)
  if (schema.isPending) return <TypePageSkeleton />
  if (type !== undefined) {
    return <Navigate to={buildSchemaUrl(ontologyKey, 'classic', { kind, key: type.key })} replace />
  }
  if (schema.error !== null) {
    return (
      <EmptyState
        icon={SearchX}
        title="Failed to load schema"
        description={schema.error.message}
        className="py-24"
      />
    )
  }
  return <TypeNotFound ontologyKey={ontologyKey} kind={kind} />
}
