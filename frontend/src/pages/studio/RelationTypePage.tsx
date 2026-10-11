import { useParams } from 'react-router-dom'
import { LegacyTypeRedirect } from '@/components/studio/schema/LegacyTypeRedirect'

/** `/o/:ontologyKey/studio/relation-types/:id` — old address, leads to the classic page by key. */
export function RelationTypePage() {
  const { ontologyKey, id } = useParams<{ ontologyKey: string; id: string }>()
  if (ontologyKey === undefined || id === undefined) return null
  return <LegacyTypeRedirect ontologyKey={ontologyKey} kind="relation-types" id={id} />
}
