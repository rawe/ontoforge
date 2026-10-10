import { useState } from 'react'
import { ArrowRight, Box, Check, ChevronLeft, Pencil, Plus, SearchX, Trash2 } from 'lucide-react'
import { Link } from 'react-router-dom'
import type { EntityType, PropertyDefinition, RelationType } from '@/api/types'
import { EmptyState } from '@/components/EmptyState'
import { TypeChip, TypeDot } from '@/components/TypeChip'
import { EntityTypeIndices } from '@/components/search/EntityTypeIndices'
import { Badge } from '@/components/ui/badge'
import { Button } from '@/components/ui/button'
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@/components/ui/select'
import { Skeleton } from '@/components/ui/skeleton'
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from '@/components/ui/table'
import { Tooltip, TooltipContent, TooltipTrigger } from '@/components/ui/tooltip'
import { PropertyDialog } from './PropertyDialog'
import { InlineText } from './shared'
import { DeleteTypeButton } from './modeling/DeleteDialog'
import { useRequestDelete } from './modeling/deleteContext'
import { useSetNameProperty, useUpdateType } from './modeling/mutations'
import { findType, useModelSchema, type TypeKind } from './modeling/useModelSchema'

interface TypeEditorProps {
  ontologyKey: string
  kind: TypeKind
  typeId: string
}

/**
 * Shared editor for entity and relation types: editable display name and
 * description, immutable key, delete, properties table. Entity types also
 * pick their name property among their string properties. Needs a
 * `DeleteProvider` above it.
 */
export function TypeEditor({ ontologyKey, kind, typeId }: TypeEditorProps) {
  const isEntity = kind === 'entity-types'
  const requestDelete = useRequestDelete()

  const [propertyDialogOpen, setPropertyDialogOpen] = useState(false)
  const [editingProperty, setEditingProperty] = useState<PropertyDefinition | null>(null)

  const schema = useModelSchema(ontologyKey)
  const type = findType(schema, kind, typeId)
  const properties = schema.properties[typeId]

  const update = useUpdateType(ontologyKey, kind, typeId)
  const setNameProperty = useSetNameProperty(ontologyKey, typeId)

  if (schema.isPending) {
    return (
      <div className="space-y-4 p-6">
        <Skeleton className="h-8 w-64" />
        <Skeleton className="h-40 rounded-xl" />
      </div>
    )
  }

  if (type === undefined && schema.error !== null) {
    return (
      <EmptyState
        icon={SearchX}
        title="Failed to load schema"
        description={schema.error.message}
        className="py-24"
      />
    )
  }

  if (type === undefined) {
    return (
      <EmptyState
        icon={Box}
        title={`${isEntity ? 'Entity' : 'Relation'} type not found`}
        description="It may have been deleted."
        action={
          <Button variant="outline" asChild>
            <Link to={`/o/${ontologyKey}/studio`}>Back to schema</Link>
          </Button>
        }
      />
    )
  }

  const relation = isEntity ? null : (type as RelationType)
  const nameProperty = isEntity ? (type as EntityType).nameProperty : null
  const stringProperties = (properties ?? []).filter((p) => p.dataType === 'string')

  return (
    <div>
      <header className="border-b px-6 py-4">
        <Link
          to={`/o/${ontologyKey}/studio`}
          className="mb-2 inline-flex items-center gap-1 text-xs text-muted-foreground transition-colors hover:text-foreground"
        >
          <ChevronLeft className="size-3.5" /> Schema
        </Link>
        <div className="flex flex-wrap items-center gap-3">
          <TypeChip typeKey={type.key} displayName={type.displayName} />
          <InlineText
            aria-label="Display name"
            value={type.displayName}
            onSave={(v) => {
              if (v !== '') update.mutate({ displayName: v })
            }}
            className="text-[15px] font-semibold tracking-tight"
            inputClassName="h-8 w-64 text-[15px] font-semibold"
          />
          <Badge variant="outline" className="font-mono text-[11px]" title="Immutable key">
            {type.key}
          </Badge>
          {relation !== null && (
            <span className="flex items-center gap-1.5 text-[12px]">
              <TypeDot typeKey={relation.sourceEntityTypeKey} />
              <span className="font-mono text-muted-foreground">
                {relation.sourceEntityTypeKey}
              </span>
              <ArrowRight className="size-3 text-muted-foreground/60" />
              <TypeDot typeKey={relation.targetEntityTypeKey} />
              <span className="font-mono text-muted-foreground">
                {relation.targetEntityTypeKey}
              </span>
              <span className="ml-1 text-[11px] text-muted-foreground/70">(immutable)</span>
            </span>
          )}
          <DeleteTypeButton kind={kind} id={typeId} className="ml-auto" />
        </div>
        <div className="mt-1 max-w-2xl">
          <InlineText
            aria-label="Description"
            value={type.description ?? ''}
            placeholder="Add a description…"
            multiline
            onSave={(v) => {
              // The API cannot clear a description, only replace it.
              if (v !== '') update.mutate({ description: v })
            }}
            className="block w-full text-[13px] text-muted-foreground"
          />
        </div>
      </header>

      <div className="p-6">
        <div className="mb-3 flex items-center gap-2">
          <h2 className="text-[13px] font-semibold">Properties</h2>
          <span className="text-[13px] text-muted-foreground">{properties?.length ?? 0}</span>
          {nameProperty !== null && (
            <label className="ml-auto flex items-center gap-2 text-[12px] text-muted-foreground">
              Name property
              <Select
                value={nameProperty}
                onValueChange={(v) => {
                  if (v !== nameProperty) setNameProperty.mutate(v)
                }}
                disabled={setNameProperty.isPending}
              >
                <SelectTrigger size="sm" className="min-w-36 font-mono text-xs">
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  {stringProperties.map((p) => (
                    <SelectItem key={p.propertyId} value={p.key}>
                      <span className="font-mono text-xs">{p.key}</span>
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </label>
          )}
          <Button
            size="sm"
            className={nameProperty === null ? 'ml-auto' : undefined}
            onClick={() => {
              setEditingProperty(null)
              setPropertyDialogOpen(true)
            }}
          >
            <Plus className="size-3.5" /> Add property
          </Button>
        </div>

        {properties === undefined &&
          (schema.error === null ? (
            <Skeleton className="h-32 rounded-xl" />
          ) : (
            <p className="rounded-xl border border-dashed p-6 text-center text-[13px] text-muted-foreground">
              Failed to load: {schema.error.message}
            </p>
          ))}

        {properties !== undefined && properties.length === 0 && (
          <p className="rounded-xl border border-dashed p-6 text-center text-[13px] text-muted-foreground">
            No properties yet — instances of this type carry no fields.
          </p>
        )}

        {properties !== undefined && properties.length > 0 && (
          <div className="overflow-hidden rounded-xl border">
            <Table>
              <TableHeader>
                <TableRow>
                  <TableHead>Key</TableHead>
                  <TableHead>Display name</TableHead>
                  <TableHead>Type</TableHead>
                  <TableHead>Required</TableHead>
                  <TableHead>Default</TableHead>
                  <TableHead>Description</TableHead>
                  <TableHead className="w-20" />
                </TableRow>
              </TableHeader>
              <TableBody>
                {properties.map((p) => (
                  <TableRow key={p.propertyId}>
                    <TableCell className="font-mono text-xs">
                      <span className="flex items-center gap-1.5">
                        {p.key}
                        {p.key === nameProperty && (
                          <Badge
                            variant="outline"
                            className="font-sans text-[10px]"
                            title="Name property — its value labels instances of this type"
                          >
                            Name
                          </Badge>
                        )}
                      </span>
                    </TableCell>
                    <TableCell className="text-[13px]">{p.displayName}</TableCell>
                    <TableCell>
                      <Badge variant="secondary" className="font-mono text-[11px]">
                        {p.dataType}
                      </Badge>
                    </TableCell>
                    <TableCell>
                      {p.required ? (
                        <Check className="size-4 text-(--tc-emerald)" aria-label="Required" />
                      ) : (
                        <span className="text-muted-foreground/50">—</span>
                      )}
                    </TableCell>
                    <TableCell className="font-mono text-xs text-muted-foreground">
                      {p.defaultValue === null ? '—' : String(p.defaultValue)}
                    </TableCell>
                    <TableCell className="max-w-56 truncate text-[13px] text-muted-foreground">
                      {p.description ?? ''}
                    </TableCell>
                    <TableCell>
                      <div className="flex justify-end gap-0.5">
                        <Button
                          variant="ghost"
                          size="icon-sm"
                          aria-label={`Edit ${p.key}`}
                          onClick={() => {
                            setEditingProperty(p)
                            setPropertyDialogOpen(true)
                          }}
                        >
                          <Pencil className="size-3.5" />
                        </Button>
                        {p.key === nameProperty ? (
                          <Tooltip>
                            <TooltipTrigger asChild>
                              {/* A disabled button gets no pointer events — the span carries the tooltip. */}
                              <span tabIndex={0}>
                                <Button
                                  variant="ghost"
                                  size="icon-sm"
                                  aria-label={`Delete ${p.key}`}
                                  disabled
                                >
                                  <Trash2 className="size-3.5 text-destructive" />
                                </Button>
                              </span>
                            </TooltipTrigger>
                            <TooltipContent>Choose another name property first</TooltipContent>
                          </Tooltip>
                        ) : (
                          <Button
                            variant="ghost"
                            size="icon-sm"
                            aria-label={`Delete ${p.key}`}
                            onClick={() =>
                              requestDelete({
                                what: 'property',
                                kind,
                                typeId,
                                propertyId: p.propertyId,
                              })
                            }
                          >
                            <Trash2 className="size-3.5 text-destructive" />
                          </Button>
                        )}
                      </div>
                    </TableCell>
                  </TableRow>
                ))}
              </TableBody>
            </Table>
          </div>
        )}

        {isEntity && <EntityTypeIndices ontologyKey={ontologyKey} entityTypeKey={type.key} />}
      </div>

      <PropertyDialog
        ontologyKey={ontologyKey}
        kind={kind}
        typeId={typeId}
        property={editingProperty}
        open={propertyDialogOpen}
        onOpenChange={setPropertyDialogOpen}
      />
    </div>
  )
}
