import { useParams } from 'react-router-dom'
import { TypeEditor } from '@/components/studio/TypeEditor'

/** `/studio/entity-types/:id` — entity type editor. */
export function EntityTypePage() {
  const { id } = useParams<{ id: string }>()
  if (id === undefined) return null
  return <TypeEditor kind="entity-types" typeId={id} />
}
