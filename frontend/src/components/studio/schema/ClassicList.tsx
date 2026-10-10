/**
 * Classic list of the schema: entity type and relation type cards in two
 * sections. A card selects its type, which opens its classic page.
 */

import { ArrowRight, Box, Workflow } from 'lucide-react'
import { Link } from 'react-router-dom'
import type { EntityType, RelationType } from '@/api/types'
import { TypeChip, TypeDot } from '@/components/TypeChip'
import { useModelSchema } from '../modeling/useModelSchema'
import { buildSchemaUrl } from './schemaUrl'
import { useSchemaWorkspace } from './workspaceContext'

const CARD =
  'block rounded-xl border bg-card p-3.5 transition-colors duration-150 hover:border-ring/40 focus-visible:outline-2 focus-visible:outline-ring/60'

function propCountLabel(count: number | undefined) {
  if (count === undefined) return null
  return (
    <span className="text-xs text-muted-foreground">
      {count} {count === 1 ? 'property' : 'properties'}
    </span>
  )
}

function EntityTypeCard({ to, type, propCount }: { to: string; type: EntityType; propCount?: number }) {
  return (
    <Link to={to} replace className={CARD}>
      <div className="flex items-center gap-2">
        <TypeChip typeKey={type.key} displayName={type.displayName} size="sm" />
        <span className="truncate font-mono text-[11px] text-muted-foreground">{type.key}</span>
        <span className="ml-auto shrink-0">{propCountLabel(propCount)}</span>
      </div>
      <p className="mt-1.5 line-clamp-2 text-[13px] text-muted-foreground">
        {type.description ?? 'No description.'}
      </p>
    </Link>
  )
}

function RelationTypeCard({ to, type, propCount }: { to: string; type: RelationType; propCount?: number }) {
  return (
    <Link to={to} replace className={CARD}>
      <div className="flex items-center gap-2">
        <TypeChip typeKey={type.key} displayName={type.displayName} size="sm" />
        <span className="truncate font-mono text-[11px] text-muted-foreground">{type.key}</span>
        <span className="ml-auto shrink-0">{propCountLabel(propCount)}</span>
      </div>
      <div className="mt-1.5 flex items-center gap-1.5 text-[12px]">
        <TypeDot typeKey={type.sourceEntityTypeKey} />
        <span className="font-mono text-muted-foreground">{type.sourceEntityTypeKey}</span>
        <ArrowRight className="size-3 text-muted-foreground/60" />
        <TypeDot typeKey={type.targetEntityTypeKey} />
        <span className="font-mono text-muted-foreground">{type.targetEntityTypeKey}</span>
      </div>
      {type.description !== null && (
        <p className="mt-1 line-clamp-1 text-[13px] text-muted-foreground">{type.description}</p>
      )}
    </Link>
  )
}

/** The loaded, non-empty schema as cards. Loading, error and empty states are the page's. */
export function ClassicList() {
  const { ontologyKey } = useSchemaWorkspace()
  const { entityTypes, relationTypes, properties } = useModelSchema(ontologyKey)
  // A card is a link to the selected address, so it also opens in a new tab.
  const to = (kind: 'entity-types' | 'relation-types', key: string) =>
    buildSchemaUrl(ontologyKey, 'classic', { kind, key })

  return (
    <div className="grid items-start gap-6 p-6 lg:grid-cols-2">
      <section className="space-y-2.5">
        <h2 className="flex items-center gap-2 text-[13px] font-semibold">
          <Box className="size-4 text-muted-foreground" />
          Entity types
          <span className="font-normal text-muted-foreground">{entityTypes.length}</span>
        </h2>
        {entityTypes.map((t) => (
          <EntityTypeCard
            key={t.entityTypeId}
            to={to('entity-types', t.key)}
            type={t}
            propCount={properties[t.entityTypeId]?.length}
          />
        ))}
        {entityTypes.length === 0 && (
          <p className="rounded-xl border border-dashed p-4 text-[13px] text-muted-foreground">
            No entity types yet.
          </p>
        )}
      </section>
      <section className="space-y-2.5">
        <h2 className="flex items-center gap-2 text-[13px] font-semibold">
          <Workflow className="size-4 text-muted-foreground" />
          Relation types
          <span className="font-normal text-muted-foreground">{relationTypes.length}</span>
        </h2>
        {relationTypes.map((t) => (
          <RelationTypeCard
            key={t.relationTypeId}
            to={to('relation-types', t.key)}
            type={t}
            propCount={properties[t.relationTypeId]?.length}
          />
        ))}
        {relationTypes.length === 0 && (
          <p className="rounded-xl border border-dashed p-4 text-[13px] text-muted-foreground">
            No relation types yet. Relations connect two entity types.
          </p>
        )}
      </section>
    </div>
  )
}
