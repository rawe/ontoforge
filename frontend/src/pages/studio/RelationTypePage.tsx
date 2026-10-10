import { useNavigate, useParams } from 'react-router-dom'
import { TypeEditor } from '@/components/studio/TypeEditor'
import { CascadeProvider } from '@/components/studio/modeling/CascadeProvider'
import { DeleteProvider } from '@/components/studio/modeling/DeleteDialog'

/** `/o/:ontologyKey/studio/relation-types/:id` — relation type editor. */
export function RelationTypePage() {
  const { ontologyKey, id } = useParams<{ ontologyKey: string; id: string }>()
  const navigate = useNavigate()
  if (ontologyKey === undefined || id === undefined) return null
  return (
    <CascadeProvider>
      <DeleteProvider
        ontologyKey={ontologyKey}
        onDeleted={(target) => {
          if (target.what === 'type' && target.id === id) {
            void navigate(`/o/${ontologyKey}/studio`, { replace: true })
          }
        }}
        onShowType={(type) => void navigate(`/o/${ontologyKey}/studio/${type.kind}/${type.id}`)}
      >
        <TypeEditor ontologyKey={ontologyKey} kind="relation-types" typeId={id} />
      </DeleteProvider>
    </CascadeProvider>
  )
}
