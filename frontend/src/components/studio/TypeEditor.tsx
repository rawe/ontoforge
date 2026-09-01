import { useState } from 'react'
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import { ArrowRight, Box, Check, ChevronLeft, Pencil, Plus, Trash2 } from 'lucide-react'
import { Link, useNavigate } from 'react-router-dom'
import { toast } from 'sonner'
import * as model from '@/api/model'
import { qk } from '@/api/queryKeys'
import type { EntityType, PropertyDefinition, RelationType } from '@/api/types'
import { EmptyState } from '@/components/EmptyState'
import { TypeChip, TypeDot } from '@/components/TypeChip'
import {
  AlertDialog,
  AlertDialogAction,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
} from '@/components/ui/alert-dialog'
import { Badge } from '@/components/ui/badge'
import { Button } from '@/components/ui/button'
import { Skeleton } from '@/components/ui/skeleton'
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from '@/components/ui/table'
import { CascadeDialog } from './CascadeDialog'
import { useCascade } from './useCascade'
import { PropertyDialog } from './PropertyDialog'
import { invalidateModeling, toastError } from './lib'
import { InlineText } from './shared'

type Kind = 'entity-types' | 'relation-types'

interface TypeEditorProps {
  ontologyKey: string
  kind: Kind
  typeId: string
}

/**
 * Shared editor for entity and relation types: editable display name and
 * description, immutable key, delete with cascade flow, properties table.
 */
export function TypeEditor({ ontologyKey, kind, typeId }: TypeEditorProps) {
  const isEntity = kind === 'entity-types'
  const queryClient = useQueryClient()
  const navigate = useNavigate()
  const { cascade, guard, clear } = useCascade()

  const [propertyDialogOpen, setPropertyDialogOpen] = useState(false)
  const [editingProperty, setEditingProperty] = useState<PropertyDefinition | null>(null)
  const [deleteTypeOpen, setDeleteTypeOpen] = useState(false)
  const [propertyToDelete, setPropertyToDelete] = useState<PropertyDefinition | null>(null)

  const typesQuery = useQuery<(EntityType | RelationType)[]>({
    queryKey: qk.model(ontologyKey, kind),
    queryFn: () =>
      isEntity
        ? (model.listEntityTypes(ontologyKey) as Promise<(EntityType | RelationType)[]>)
        : (model.listRelationTypes(ontologyKey) as Promise<(EntityType | RelationType)[]>),
  })
  const type = typesQuery.data?.find((t) =>
    isEntity
      ? (t as EntityType).entityTypeId === typeId
      : (t as RelationType).relationTypeId === typeId,
  )

  const propertiesQuery = useQuery({
    queryKey: qk.model(ontologyKey, kind, typeId, 'properties'),
    queryFn: () => model.listProperties(ontologyKey, kind, typeId),
  })
  const properties = propertiesQuery.data

  const update = useMutation({
    mutationFn: (patch: { displayName: string; description: string | null }): Promise<unknown> =>
      isEntity
        ? model.updateEntityType(ontologyKey, typeId, patch)
        : model.updateRelationType(ontologyKey, typeId, patch),
    onSuccess: () => {
      invalidateModeling(queryClient)
      toast.success('Saved')
    },
    onError: toastError,
  })

  const deleteType = useMutation({
    mutationFn: (cascadeFlag: boolean) =>
      isEntity
        ? model.deleteEntityType(ontologyKey, typeId, cascadeFlag)
        : model.deleteRelationType(ontologyKey, typeId, cascadeFlag),
    onSuccess: () => {
      invalidateModeling(queryClient)
      toast.success(`${isEntity ? 'Entity' : 'Relation'} type deleted`)
      void navigate(`/o/${ontologyKey}/studio`)
    },
    onError: (error) => {
      if (guard(error, () => deleteType.mutate(true))) return
      toastError(error)
    },
  })

  const deleteProperty = useMutation({
    mutationFn: ({ propertyId, cascadeFlag }: { propertyId: string; cascadeFlag: boolean }) =>
      model.deleteProperty(ontologyKey, kind, typeId, propertyId, cascadeFlag),
    onSuccess: () => {
      invalidateModeling(queryClient)
      toast.success('Property deleted')
    },
    onError: (error, variables) => {
      if (
        guard(error, () =>
          deleteProperty.mutate({ propertyId: variables.propertyId, cascadeFlag: true }),
        )
      ) {
        return
      }
      toastError(error)
    },
  })

  if (typesQuery.isPending) {
    return (
      <div className="space-y-4 p-6">
        <Skeleton className="h-8 w-64" />
        <Skeleton className="h-40 rounded-xl" />
      </div>
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
              if (v !== '') update.mutate({ displayName: v, description: type.description })
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
          <div className="ml-auto">
            <Button variant="destructive" size="sm" onClick={() => setDeleteTypeOpen(true)}>
              <Trash2 className="size-3.5" /> Delete
            </Button>
          </div>
        </div>
        <div className="mt-1 max-w-2xl">
          <InlineText
            aria-label="Description"
            value={type.description ?? ''}
            placeholder="Add a description…"
            multiline
            onSave={(v) =>
              update.mutate({
                displayName: type.displayName,
                description: v === '' ? null : v,
              })
            }
            className="block w-full text-[13px] text-muted-foreground"
          />
        </div>
      </header>

      <div className="p-6">
        <div className="mb-3 flex items-center gap-2">
          <h2 className="text-[13px] font-semibold">Properties</h2>
          <span className="text-[13px] text-muted-foreground">{properties?.length ?? 0}</span>
          <Button
            size="sm"
            className="ml-auto"
            onClick={() => {
              setEditingProperty(null)
              setPropertyDialogOpen(true)
            }}
          >
            <Plus className="size-3.5" /> Add property
          </Button>
        </div>

        {propertiesQuery.isPending && <Skeleton className="h-32 rounded-xl" />}

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
                    <TableCell className="font-mono text-xs">{p.key}</TableCell>
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
                        <Button
                          variant="ghost"
                          size="icon-sm"
                          aria-label={`Delete ${p.key}`}
                          onClick={() => setPropertyToDelete(p)}
                        >
                          <Trash2 className="size-3.5 text-destructive" />
                        </Button>
                      </div>
                    </TableCell>
                  </TableRow>
                ))}
              </TableBody>
            </Table>
          </div>
        )}
      </div>

      <PropertyDialog
        ontologyKey={ontologyKey}
        kind={kind}
        typeId={typeId}
        property={editingProperty}
        open={propertyDialogOpen}
        onOpenChange={setPropertyDialogOpen}
      />

      <AlertDialog open={deleteTypeOpen} onOpenChange={setDeleteTypeOpen}>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>Delete "{type.displayName}"?</AlertDialogTitle>
            <AlertDialogDescription>
              This removes the {isEntity ? 'entity' : 'relation'} type and its properties
              from this ontology's schema. This cannot be undone.
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel>Cancel</AlertDialogCancel>
            <AlertDialogAction
              variant="destructive"
              onClick={() => deleteType.mutate(false)}
            >
              Delete
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>

      <AlertDialog
        open={propertyToDelete !== null}
        onOpenChange={(open) => !open && setPropertyToDelete(null)}
      >
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>
              Delete property "{propertyToDelete?.key ?? ''}"?
            </AlertDialogTitle>
            <AlertDialogDescription>
              Existing instance data for this property stays in the database but is no
              longer part of the schema.
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel>Cancel</AlertDialogCancel>
            <AlertDialogAction
              variant="destructive"
              onClick={() => {
                if (propertyToDelete !== null) {
                  deleteProperty.mutate({
                    propertyId: propertyToDelete.propertyId,
                    cascadeFlag: false,
                  })
                }
              }}
            >
              Delete property
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>

      <CascadeDialog cascade={cascade} onClose={clear} />
    </div>
  )
}
