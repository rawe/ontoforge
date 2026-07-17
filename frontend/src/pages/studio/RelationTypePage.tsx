import { useParams } from 'react-router-dom'
import { TypeEditor } from '@/components/studio/TypeEditor'

/** `/studio/relation-types/:id` — relation type editor. */
export function RelationTypePage() {
  const { id } = useParams<{ id: string }>()
  if (id === undefined) return null
  return <TypeEditor kind="relation-types" typeId={id} />
}
