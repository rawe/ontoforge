/**
 * Delete with impact preview: one dialog for entity types, relation types and
 * properties, mounted once per page and opened from anywhere with
 * `useRequestDelete()` (`deleteContext.ts`).
 *
 * The preview comes from the loaded schema: relation types that block an
 * entity type, the property count, the name property. Lens and search-index
 * impact has no dry run in the API: the first attempt is refused with
 * CASCADE_REQUIRED, and the dialog turns into the cascade stage, which re-sends
 * with `cascade=true`. A type always needs its key typed; a property one confirm.
 */

import { useCallback, useState, type ReactNode } from 'react'
import { useQueryClient } from '@tanstack/react-query'
import { AlertTriangle, ArrowRight, Layers, ListTree, Trash2, type LucideIcon } from 'lucide-react'
import { ApiError } from '@/api/http'
import type { EntityType, RelationType } from '@/api/types'
import { TypeDot } from '@/components/TypeChip'
import {
  AlertDialog,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
} from '@/components/ui/alert-dialog'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { AffectedLists } from '../CascadeDialog'
import { affectedText } from '../cascadeText'
import { invalidateModeling, isCascadeError, toastError } from '../lib'
import {
  DeleteContext,
  useRequestDelete,
  type DeleteTarget,
  type RequestDelete,
  type TypeRef,
} from './deleteContext'
import { useDeleteProperty, useDeleteType } from './mutations'
import { findType, useModelSchema, type TypeKind } from './useModelSchema'

interface DeleteProviderProps {
  ontologyKey: string
  /** After a successful delete. `type` is the deleted type, or the deleted property's owner. */
  onDeleted?: (target: DeleteTarget, type: TypeRef) => void
  /** A blocking relation type's *Show*: select or open it. */
  onShowType?: (type: TypeRef) => void
  children: ReactNode
}

export function DeleteProvider({ ontologyKey, onDeleted, onShowType, children }: DeleteProviderProps) {
  const [target, setTarget] = useState<DeleteTarget | null>(null)
  const request = useCallback<RequestDelete>((t) => setTarget(t), [])
  return (
    <DeleteContext.Provider value={request}>
      {children}
      <AlertDialog open={target !== null} onOpenChange={(open) => !open && setTarget(null)}>
        <AlertDialogContent className="data-[size=default]:sm:max-w-md">
          {target !== null && (
            <DeleteBody
              key={JSON.stringify(target)}
              ontologyKey={ontologyKey}
              target={target}
              onClose={() => setTarget(null)}
              onDeleted={onDeleted}
              onShowType={onShowType}
            />
          )}
        </AlertDialogContent>
      </AlertDialog>
    </DeleteContext.Provider>
  )
}

interface DeleteBodyProps {
  ontologyKey: string
  target: DeleteTarget
  onClose: () => void
  onDeleted?: (target: DeleteTarget, type: TypeRef) => void
  onShowType?: (type: TypeRef) => void
}

function DeleteBody({ ontologyKey, target, onClose, onDeleted, onShowType }: DeleteBodyProps) {
  const queryClient = useQueryClient()
  const schema = useModelSchema(ontologyKey)
  const deleteType = useDeleteType(ontologyKey)
  const deleteProperty = useDeleteProperty(ontologyKey)
  const [cascade, setCascade] = useState<{ lenses: string[]; indices: string[] } | null>(null)
  const [error, setError] = useState<string | null>(null)
  const [confirmText, setConfirmText] = useState('')

  const kind = target.kind
  const typeId = target.what === 'type' ? target.id : target.typeId
  const type = findType(schema, kind, typeId)
  const property =
    target.what === 'property'
      ? schema.properties[typeId]?.find((p) => p.propertyId === target.propertyId)
      : undefined
  const pending = deleteType.isPending || deleteProperty.isPending

  if (type === undefined || (target.what === 'property' && property === undefined)) {
    return (
      <>
        <AlertDialogHeader>
          <AlertDialogTitle>Already gone</AlertDialogTitle>
          <AlertDialogDescription>This no longer exists in the schema.</AlertDialogDescription>
        </AlertDialogHeader>
        <AlertDialogFooter>
          <AlertDialogCancel>Close</AlertDialogCancel>
        </AlertDialogFooter>
      </>
    )
  }

  const isEntity = kind === 'entity-types'
  const blocking =
    target.what === 'type' && isEntity
      ? schema.relationTypes.filter(
          (r) => r.sourceEntityTypeKey === type.key || r.targetEntityTypeKey === type.key,
        )
      : []
  const isNameProperty =
    property !== undefined && isEntity && (type as EntityType).nameProperty === property.key
  const blocked = blocking.length > 0 || isNameProperty
  const canDelete =
    !blocked && !pending && (target.what === 'property' || confirmText.trim() === type.key)

  const onError = (err: unknown) => {
    if (isCascadeError(err)) {
      setCascade({ lenses: err.affectedLenses ?? [], indices: err.affectedIndices ?? [] })
      return
    }
    setError(err instanceof Error ? err.message : String(err))
    // A stale preview (deleted or changed elsewhere) recomputes from fresh data.
    if (err instanceof ApiError && (err.status === 404 || err.status === 409)) {
      invalidateModeling(queryClient)
    }
    if (!(err instanceof ApiError && err.status === 409)) toastError(err)
  }
  const onSuccess = () => {
    onClose()
    onDeleted?.(target, { kind, id: typeId, key: type.key })
  }
  const run = (cascadeFlag: boolean) => {
    setError(null)
    if (target.what === 'type') {
      deleteType.mutate({ kind, id: typeId, cascade: cascadeFlag }, { onSuccess, onError })
    } else {
      deleteProperty.mutate(
        { kind, typeId, propertyId: target.propertyId, cascade: cascadeFlag },
        { onSuccess, onError },
      )
    }
  }

  const subject =
    target.what === 'type'
      ? `${isEntity ? 'entity' : 'relation'} type "${type.displayName}"`
      : `property "${property!.key}"`
  const errorLine = error !== null && <p className="text-xs text-destructive">{error}</p>

  if (cascade !== null) {
    return (
      <>
        <AlertDialogHeader>
          <AlertDialogTitle>Cascade required</AlertDialogTitle>
          <AlertDialogDescription>
            Deleting the {subject} is refused until its dependents are updated.{' '}
            {affectedText({ affectedLenses: cascade.lenses, affectedIndices: cascade.indices })}
          </AlertDialogDescription>
        </AlertDialogHeader>
        <AffectedLists lenses={cascade.lenses} indices={cascade.indices} />
        {errorLine}
        <AlertDialogFooter>
          <AlertDialogCancel>Cancel</AlertDialogCancel>
          <Button variant="destructive" disabled={pending} onClick={() => run(true)}>
            <Trash2 className="size-3.5" /> Delete and update dependents
          </Button>
        </AlertDialogFooter>
      </>
    )
  }

  const propertyCount = schema.properties[typeId]?.length ?? 0

  return (
    <>
      <AlertDialogHeader>
        <AlertDialogTitle>
          Delete {subject}
          {property !== undefined && (
            <span className="font-normal text-muted-foreground"> of {type.displayName}</span>
          )}
          ?
        </AlertDialogTitle>
        <AlertDialogDescription>Schema changes are live. This cannot be undone.</AlertDialogDescription>
      </AlertDialogHeader>

      {blocking.length > 0 && (
        <div className="grid gap-2 rounded-lg border border-(--tc-amber-border) bg-(--tc-amber-bg) p-3 text-[13px]">
          <p className="flex items-start gap-2">
            <AlertTriangle className="mt-0.5 size-3.5 shrink-0 text-(--tc-amber)" />
            <span>
              Blocked: {blocking.length} relation type{blocking.length === 1 ? '' : 's'} use
              {blocking.length === 1 ? 's' : ''} <b>{type.displayName}</b> as source or target.
              Delete {blocking.length === 1 ? 'it' : 'them'} first.
            </span>
          </p>
          <ul className="grid gap-1">
            {blocking.map((r) => (
              <BlockingRow
                key={r.relationTypeId}
                relation={r}
                onShow={
                  onShowType &&
                  (() => {
                    onClose()
                    onShowType({ kind: 'relation-types', id: r.relationTypeId, key: r.key })
                  })
                }
              />
            ))}
          </ul>
        </div>
      )}

      {isNameProperty && (
        <p className="flex items-start gap-2 rounded-lg border border-(--tc-amber-border) bg-(--tc-amber-bg) p-3 text-[13px]">
          <AlertTriangle className="mt-0.5 size-3.5 shrink-0 text-(--tc-amber)" />
          This is the name property of {type.displayName}. Choose another name property first.
        </p>
      )}

      <ul className="grid gap-2 text-[13px]">
        {target.what === 'type' && propertyCount > 0 && (
          <Impact icon={ListTree}>
            Removes {propertyCount} property definition{propertyCount === 1 ? '' : 's'} with it.
          </Impact>
        )}
        <Impact icon={Trash2}>
          {target.what === 'type' ? (
            <>
              Stored {isEntity ? 'entities' : 'relations'} under{' '}
              <code className="font-mono text-[12px]">{type.key}</code> stay in the database but
              become unreachable.
            </>
          ) : (
            <>Stored values of this property stay in the database but are no longer part of the schema.</>
          )}
        </Impact>
        <Impact icon={Layers}>
          <span className="text-muted-foreground">
            Lens scopes and search indices: the server reports what it would change when you
            confirm.
          </span>
        </Impact>
      </ul>

      {target.what === 'type' && !blocked && (
        <label className="grid gap-1.5 text-[12px] text-muted-foreground">
          <span>
            Type <code className="font-mono text-foreground">{type.key}</code> to confirm
          </span>
          <Input
            value={confirmText}
            autoFocus
            spellCheck={false}
            autoComplete="off"
            className="font-mono"
            onChange={(e) => setConfirmText(e.target.value)}
            onKeyDown={(e) => {
              if (e.key === 'Enter' && canDelete) run(false)
            }}
          />
        </label>
      )}

      {errorLine}

      <AlertDialogFooter>
        <AlertDialogCancel>Cancel</AlertDialogCancel>
        <Button variant="destructive" disabled={!canDelete} onClick={() => run(false)}>
          <Trash2 className="size-3.5" /> Delete
        </Button>
      </AlertDialogFooter>
    </>
  )
}

function Impact({ icon: Icon, children }: { icon: LucideIcon; children: ReactNode }) {
  return (
    <li className="flex items-start gap-2">
      <Icon className="mt-0.5 size-3.5 shrink-0 text-muted-foreground" />
      <span>{children}</span>
    </li>
  )
}

function BlockingRow({ relation, onShow }: { relation: RelationType; onShow?: () => void }) {
  return (
    <li className="flex items-center gap-1.5 rounded-md bg-background/60 px-2 py-1">
      <span className="font-mono text-[12px]">{relation.key}</span>
      <span className="ml-1 flex items-center gap-1 font-mono text-[11px] text-muted-foreground">
        <TypeDot typeKey={relation.sourceEntityTypeKey} />
        {relation.sourceEntityTypeKey}
        <ArrowRight className="size-3" />
        <TypeDot typeKey={relation.targetEntityTypeKey} />
        {relation.targetEntityTypeKey}
      </span>
      {onShow !== undefined && (
        <Button variant="ghost" size="xs" className="ml-auto" onClick={onShow}>
          Show
        </Button>
      )}
    </li>
  )
}

/** A type's delete action; the same button wherever a type is edited. */
export function DeleteTypeButton({ kind, id, className }: { kind: TypeKind; id: string; className?: string }) {
  const requestDelete = useRequestDelete()
  return (
    <Button
      variant="destructive"
      size="sm"
      className={className}
      onClick={() => requestDelete({ what: 'type', kind, id })}
    >
      <Trash2 className="size-3.5" /> Delete
    </Button>
  )
}
