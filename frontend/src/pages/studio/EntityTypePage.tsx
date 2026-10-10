import { useNavigate, useParams } from 'react-router-dom'
import { CascadeProvider } from '@/components/studio/modeling/CascadeProvider'
import { DeleteProvider } from '@/components/studio/modeling/DeleteDialog'
import type { TypeRef } from '@/components/studio/modeling/deleteContext'
import { ClassicTypePage } from '@/components/studio/schema/ClassicTypePage'

/** `/o/:ontologyKey/studio/entity-types/:id` — entity type editor. */
export function EntityTypePage() {
  const { ontologyKey, id } = useParams<{ ontologyKey: string; id: string }>()
  const navigate = useNavigate()
  if (ontologyKey === undefined || id === undefined) return null
  const showType = (type: TypeRef) => void navigate(`/o/${ontologyKey}/studio/${type.kind}/${type.id}`)
  return (
    <CascadeProvider>
      <DeleteProvider
        ontologyKey={ontologyKey}
        onDeleted={(target) => {
          if (target.what === 'type' && target.id === id) {
            void navigate(`/o/${ontologyKey}/studio`, { replace: true })
          }
        }}
        onShowType={showType}
      >
        <ClassicTypePage
          ontologyKey={ontologyKey}
          kind="entity-types"
          typeId={id}
          onSelectType={showType}
        />
      </DeleteProvider>
    </CascadeProvider>
  )
}
