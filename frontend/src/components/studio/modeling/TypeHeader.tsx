/**
 * Header of an entity or relation type: display name and description edited
 * inline, the permanent key, a relation type's endpoints (jump links) and
 * parent end (`ParentField`), and an entity type's name property. `variant="page"` lays it out in a row for the
 * classic type page; `variant="panel"` stacks it for the graph inspector.
 * Navigation is the surface's: endpoint chips call `onSelectType`.
 */

import { ArrowRight, Lock, Workflow } from 'lucide-react'
import type { EntityType, RelationType } from '@/api/types'
import { TypeChip } from '@/components/TypeChip'
import { Badge } from '@/components/ui/badge'
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@/components/ui/select'
import { cn } from '@/lib/utils'
import { InlineText } from '../shared'
import type { TypeRef } from './deleteContext'
import { DescriptionText } from './DescriptionText'
import { useSetNameProperty, useUpdateType } from './mutations'
import { ParentField } from './ParentField'
import { findType, useModelSchema, type TypeKind } from './useModelSchema'

interface TypeHeaderProps {
  ontologyKey: string
  kind: TypeKind
  typeId: string
  variant: 'panel' | 'page'
  onSelectType: (type: TypeRef) => void
}

export function TypeHeader({ ontologyKey, kind, typeId, variant, onSelectType }: TypeHeaderProps) {
  const schema = useModelSchema(ontologyKey)
  const type = findType(schema, kind, typeId)
  const update = useUpdateType(ontologyKey, kind, typeId)
  if (type === undefined) return null
  const page = variant === 'page'
  const relation = kind === 'relation-types' ? (type as RelationType) : null
  const entity = kind === 'entity-types' ? (type as EntityType) : null

  const displayName = (
    <InlineText
      aria-label="Display name"
      value={type.displayName}
      onSave={(v) => {
        if (v !== '') update.mutate({ displayName: v })
      }}
      className={cn('text-[15px] font-semibold tracking-tight', !page && '-mx-1 px-1')}
      inputClassName={cn('h-8 text-[15px] font-semibold', page && 'w-64')}
    />
  )
  const endpoints = relation !== null && (
    <Endpoints ontologyKey={ontologyKey} relation={relation} onSelectType={onSelectType} />
  )
  const parent = relation !== null && (
    <ParentField ontologyKey={ontologyKey} relation={relation} variant={variant} />
  )
  const nameProperty = entity !== null && (
    <label
      className={cn(
        'flex items-center gap-2 text-[12px] text-muted-foreground',
        page ? 'ml-auto' : 'justify-between pt-1',
      )}
    >
      Name property
      <NamePropertySelect ontologyKey={ontologyKey} entityType={entity} />
    </label>
  )

  return (
    <div className={cn('grid', page ? 'gap-1' : 'gap-2')}>
      <div className={cn('flex flex-wrap items-center', page ? 'gap-3' : 'gap-2')}>
        {entity !== null ? (
          <TypeChip
            typeKey={type.key}
            displayName={page ? type.displayName : 'Entity type'}
            size={page ? 'md' : 'sm'}
          />
        ) : (
          <span className="inline-flex items-center gap-1 rounded-md border px-1.5 py-px text-[11px] font-medium text-muted-foreground">
            <Workflow className="size-3" /> Relation type
          </span>
        )}
        {page && displayName}
        <Badge variant="outline" className="gap-1 font-mono text-[11px]" title="The key is permanent">
          <Lock className="size-2.5 opacity-60" />
          {type.key}
        </Badge>
        {page && endpoints}
        {page && parent}
        {page && nameProperty}
      </div>

      {!page && displayName}

      <DescriptionText
        value={type.description}
        onSave={(v) => update.mutate({ description: v })}
        className={cn(
          'block w-full text-[13px] text-muted-foreground',
          page ? 'max-w-2xl' : '-mx-1 px-1',
        )}
      />

      {!page && endpoints}
      {!page && parent}
      {!page && nameProperty}
    </div>
  )
}

/** Source → target, read-only; the chips jump to the endpoint types. */
function Endpoints({
  ontologyKey,
  relation,
  onSelectType,
}: {
  ontologyKey: string
  relation: RelationType
  onSelectType: (type: TypeRef) => void
}) {
  const schema = useModelSchema(ontologyKey)
  const chip = (key: string) => {
    const target = schema.entityTypes.find((t) => t.key === key)
    const label = <TypeChip typeKey={key} displayName={target?.displayName ?? key} size="sm" />
    if (target === undefined) return label
    return (
      <button
        type="button"
        title={`Show ${target.displayName}`}
        className="cursor-pointer"
        onClick={() => onSelectType({ kind: 'entity-types', id: target.entityTypeId, key })}
      >
        {label}
      </button>
    )
  }
  return (
    <span className="flex flex-wrap items-center gap-1.5 text-[12px]">
      {chip(relation.sourceEntityTypeKey)}
      <ArrowRight className="size-3 text-muted-foreground/60" />
      {chip(relation.targetEntityTypeKey)}
      <span
        className="ml-1 text-[11px] text-muted-foreground/70"
        title="Endpoints are fixed at creation. To change them, create a new relation type and delete this one."
      >
        (immutable)
      </span>
    </span>
  )
}

/** The entity type's name property, chosen among its `string` properties. */
function NamePropertySelect({
  ontologyKey,
  entityType,
}: {
  ontologyKey: string
  entityType: EntityType
}) {
  const schema = useModelSchema(ontologyKey)
  const setNameProperty = useSetNameProperty(ontologyKey, entityType.entityTypeId)
  const strings = (schema.properties[entityType.entityTypeId] ?? []).filter(
    (p) => p.dataType === 'string',
  )
  return (
    <Select
      value={entityType.nameProperty}
      onValueChange={(v) => {
        if (v !== entityType.nameProperty) setNameProperty.mutate(v)
      }}
      disabled={setNameProperty.isPending}
    >
      <SelectTrigger
        size="sm"
        title="Name property — its value labels instances of this type"
        className="min-w-36 font-mono text-xs"
      >
        <SelectValue />
      </SelectTrigger>
      <SelectContent>
        {strings.map((p) => (
          <SelectItem key={p.propertyId} value={p.key}>
            <span className="font-mono text-xs">{p.key}</span>
          </SelectItem>
        ))}
      </SelectContent>
    </Select>
  )
}
