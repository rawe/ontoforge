import { useMutation, useQueries } from '@tanstack/react-query'
import { Check } from 'lucide-react'
import { toast } from 'sonner'
import { ApiError } from '@/api/http'
import { qk } from '@/api/queryKeys'
import { getStagedDocument } from '@/api/runtime'
import type { JsonValue, SchemaEntityType } from '@/api/types'
import { useRuntimeWrites } from '@/api/writes'
import { TypeChip } from '@/components/TypeChip'
import { STAGED_ONLY_TEXT } from '@/components/changesets/changesets'
import { EntityForm } from '@/components/quickadd/EntityForm'
import { Button } from '@/components/ui/button'
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from '@/components/ui/dialog'
import { isDocumentStub } from '@/lib/documents'
import { pinnedChangeset } from '@/lib/pinnedChangeset'

/** An entity a changeset creates, with its values as the review page shows them. */
export interface StagedEntityTarget {
  changesetId: string
  entityType: SchemaEntityType
  id: string
  label: string
  values: Record<string, JsonValue>
}

/**
 * "Edit values…" on a staged create: the entity form prefilled with its
 * values, a document with its staged text (loaded first); Save stages one
 * update of the minted id with only the changed properties. Only while its
 * changeset is the pinned one — otherwise the write is refused, never sent
 * live.
 */
export function EditStagedEntityDialog({
  ontologyKey,
  lensKey,
  target,
  onClose,
}: {
  ontologyKey: string
  lensKey: string
  target: StagedEntityTarget
  onClose: () => void
}) {
  const writes = useRuntimeWrites(ontologyKey, lensKey)
  const { changesetId, entityType, id } = target
  const documentKeys = entityType.properties
    .filter((p) => p.dataType === 'document' && isDocumentStub(target.values[p.key]))
    .map((p) => p.key)
  // The staged texts, under the key the staged document viewer reads them by.
  const documents = useQueries({
    queries: documentKeys.map((key) => ({
      queryKey: qk.changesets(ontologyKey, lensKey, changesetId, ['document', entityType.key, id, key]),
      queryFn: () => getStagedDocument(ontologyKey, lensKey, changesetId, entityType.key, id, key),
    })),
  })
  const failed = documents.find((d) => d.isError)?.error
  const loaded = documents.every((d) => d.isSuccess)
  const texts = loaded ? Object.fromEntries(documentKeys.map((key, i) => [key, documents[i].data!.content])) : null

  const save = useMutation({
    mutationFn: (patch: Record<string, JsonValue>) => {
      if (pinnedChangeset(ontologyKey, lensKey) !== changesetId) throw new Error(STAGED_ONLY_TEXT)
      return writes.updateEntity(entityType.key, id, patch)
    },
    onSuccess: (outcome) => {
      if (outcome.kind === 'staged') writes.toastStaged(outcome)
      onClose()
    },
    onError: (error) => {
      if (!(error instanceof ApiError) || error.fieldErrors === undefined) toast.error(error.message)
    },
  })

  return (
    <Dialog open onOpenChange={(open) => !open && !save.isPending && onClose()}>
      <DialogContent className="sm:max-w-md">
        <DialogHeader>
          <DialogTitle className="flex items-center gap-2">
            Edit {target.label}
            <TypeChip typeKey={entityType.key} displayName={entityType.displayName} size="sm" />
          </DialogTitle>
          <DialogDescription>Staged in this changeset: only the values you change are staged.</DialogDescription>
        </DialogHeader>
        {failed != null && <p className="text-[13px] text-destructive">{failed.message}</p>}
        {failed == null && texts === null && <p className="text-[13px] text-muted-foreground">Loading…</p>}
        {texts !== null && (
          <EntityForm
            entityType={entityType}
            initialValues={{ ...target.values, ...texts }}
            idPrefix="edit-staged"
            submitting={save.isPending}
            serverErrors={save.error instanceof ApiError ? save.error.fieldErrors : undefined}
            onSubmit={(patch) => (Object.keys(patch).length === 0 ? onClose() : save.mutate(patch))}
            footer={
              <DialogFooter className="mt-2">
                <Button type="button" variant="outline" size="sm" disabled={save.isPending} onClick={onClose}>
                  Cancel
                </Button>
                <Button type="submit" size="sm" disabled={save.isPending}>
                  <Check className="size-3.5" />
                  {save.isPending ? 'Staging…' : 'Stage changes'}
                </Button>
              </DialogFooter>
            }
          />
        )}
      </DialogContent>
    </Dialog>
  )
}
