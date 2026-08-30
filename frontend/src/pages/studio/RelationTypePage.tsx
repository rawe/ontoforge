import { useParams } from 'react-router-dom'
import { TypeEditor } from '@/components/studio/TypeEditor'

/** `/o/:ontologyKey/studio/relation-types/:id` — relation type editor. */
export function RelationTypePage() {
  const { ontologyKey, id } = useParams<{ ontologyKey: string; id: string }>()
  if (ontologyKey === undefined || id === undefined) return null
  return <TypeEditor ontologyKey={ontologyKey} kind="relation-types" typeId={id} />
}
