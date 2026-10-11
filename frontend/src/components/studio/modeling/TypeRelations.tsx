/**
 * The relation types touching an entity type, as jump links: direction
 * (out, in, self), key and the other endpoint. Navigation is the surface's
 * (`onSelectType`).
 */

import { ArrowLeft, ArrowRight, RefreshCw } from 'lucide-react'
import type { EntityType } from '@/api/types'
import { TypeDot } from '@/components/TypeChip'
import type { TypeRef } from './deleteContext'
import { findType, useModelSchema } from './useModelSchema'

interface TypeRelationsProps {
  ontologyKey: string
  entityTypeId: string
  /** `panel`: the graph inspector, whose empty state explains how to connect. */
  variant: 'panel' | 'page'
  onSelectType: (type: TypeRef) => void
}

export function TypeRelations({ ontologyKey, entityTypeId, variant, onSelectType }: TypeRelationsProps) {
  const schema = useModelSchema(ontologyKey)
  const entityType = findType(schema, 'entity-types', entityTypeId) as EntityType | undefined
  if (entityType === undefined) return null
  const related = schema.relationTypes.filter(
    (r) => r.sourceEntityTypeKey === entityType.key || r.targetEntityTypeKey === entityType.key,
  )

  return (
    <section className="grid gap-2">
      <div className="flex items-center gap-2">
        <h2 className="text-[13px] font-semibold">Relation types</h2>
        <span className="text-[13px] text-muted-foreground">{related.length}</span>
      </div>
      {related.length === 0 ? (
        <p className="text-[12px] text-muted-foreground">
          {variant === 'panel' ? (
            <>
              None yet — drag the <b>+</b> on the node onto another type to connect.
            </>
          ) : (
            'None yet.'
          )}
        </p>
      ) : (
        <ul className="grid gap-0.5">
          {related.map((r) => {
            const self = r.sourceEntityTypeKey === r.targetEntityTypeKey
            const outgoing = r.sourceEntityTypeKey === entityType.key
            const other = outgoing ? r.targetEntityTypeKey : r.sourceEntityTypeKey
            const Icon = self ? RefreshCw : outgoing ? ArrowRight : ArrowLeft
            return (
              <li key={r.relationTypeId}>
                <button
                  type="button"
                  onClick={() =>
                    onSelectType({ kind: 'relation-types', id: r.relationTypeId, key: r.key })
                  }
                  title={self ? 'Self-relation' : outgoing ? 'Outgoing' : 'Incoming'}
                  className="flex w-full cursor-pointer items-center gap-2 rounded-md px-2 py-1 text-left hover:bg-muted/60"
                >
                  <Icon className="size-3 shrink-0 text-muted-foreground" />
                  <span className="font-mono text-[12px]">{r.key}</span>
                  <span className="ml-auto flex items-center gap-1 font-mono text-[11px] text-muted-foreground">
                    <TypeDot typeKey={other} />
                    {other}
                  </span>
                </button>
              </li>
            )
          })}
        </ul>
      )}
    </section>
  )
}
