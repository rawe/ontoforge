import { useParams } from 'react-router-dom'
import { TypeEditor } from '@/components/studio/TypeEditor'

/** `/o/:ontologyKey/studio/entity-types/:id` — entity type editor. */
export function EntityTypePage() {
  const { ontologyKey, id } = useParams<{ ontologyKey: string; id: string }>()
  if (ontologyKey === undefined || id === undefined) return null
  return <TypeEditor ontologyKey={ontologyKey} kind="entity-types" typeId={id} />
}
