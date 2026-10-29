import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import { ChevronDown, ChevronRight, Loader2, Pencil } from 'lucide-react'
import { useState } from 'react'
import { toast } from 'sonner'
import { ApiError } from '@/api/http'
import { qk } from '@/api/queryKeys'
import * as runtime from '@/api/runtime'
import type { EntityInstance, SchemaProperty } from '@/api/types'
import { useRuntimeWrites } from '@/api/writes'
import { useCanEdit } from '@/components/auth/useAccess'
import { MarkerChip } from '@/components/changesets/MarkerChip'
import { DocumentBadge } from '@/components/DocumentBadge'
import { DocumentViewerDialog } from '@/components/DocumentViewerDialog'
import type { StagedField } from '@/components/entity/stagedFields'
import { DocumentEditor, DocumentMarkdown } from '@/components/schema/DocumentEditor'
import { Button } from '@/components/ui/button'
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from '@/components/ui/dialog'
import { Tooltip, TooltipContent, TooltipTrigger } from '@/components/ui/tooltip'
import { formatDocSize, isDocumentStub } from '@/lib/documents'
import { pinnedChangeset } from '@/lib/pinnedChangeset'

interface DocumentPropertyRowProps {
  ontologyKey: string
  lensKey: string
  entity: EntityInstance
  property: SchemaProperty
  /** Display label of the entity, for the staged text's viewer. */
  entityLabel: string
  /** Set while the pinned changeset (`changesetId`) sets this property. */
  staged?: StagedField
  changesetId?: string
}

/**
 * Entity-detail row for one `document` property. Reads carry only a stub
 * (`{document: true, length}`), so the row starts collapsed showing a size
 * badge; expanding fetches the full content via the document endpoint and
 * renders it as Markdown. Editing opens a large Write/Preview dialog that
 * loads the full document and saves the whole string via a normal PATCH.
 * Staged in the pinned changeset, the row adds "staged · size · View" (the
 * staged text in the viewer, read only on View) and the editor starts from
 * the staged text.
 */
export function DocumentPropertyRow({
  ontologyKey,
  lensKey,
  entity,
  property,
  entityLabel,
  staged,
  changesetId,
}: DocumentPropertyRowProps) {
  const queryClient = useQueryClient()
  const writes = useRuntimeWrites(ontologyKey, lensKey)
  const canEdit = useCanEdit(ontologyKey, lensKey)
  const stub = entity[property.key]
  const hasValue = isDocumentStub(stub)
  const stagedStub = staged !== undefined && isDocumentStub(staged.value) ? staged.value : null

  const [expanded, setExpanded] = useState(false)
  const [editOpen, setEditOpen] = useState(false)
  const [draft, setDraft] = useState('')
  const [seeded, setSeeded] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [viewing, setViewing] = useState(false)

  const docQuery = useQuery({
    queryKey: qk.document(ontologyKey, lensKey, entity._entityTypeKey, entity._id, property.key),
    queryFn: () =>
      runtime.getDocument(ontologyKey, lensKey, entity._entityTypeKey, entity._id, property.key),
    enabled: hasValue && (expanded || (editOpen && staged === undefined)),
  })
  // The staged text, under the viewer's key.
  const stagedQuery = useQuery({
    queryKey: qk.changesets(ontologyKey, lensKey, changesetId ?? '', [
      'document',
      entity._entityTypeKey,
      entity._id,
      property.key,
    ]),
    queryFn: () =>
      runtime.getStagedDocument(ontologyKey, lensKey, changesetId!, entity._entityTypeKey, entity._id, property.key),
    enabled: editOpen && stagedStub !== null && changesetId !== undefined,
  })
  // The text the editor starts from: the staged one, else the stored one; null when there is none.
  const source = staged === undefined ? (hasValue ? docQuery : null) : stagedStub !== null ? stagedQuery : null

  // Seed the editor draft once per dialog open, as soon as content is known.
  if (editOpen && !seeded && (source === null || source.data !== undefined)) {
    setDraft(source?.data?.content ?? '')
    setSeeded(true)
  }

  const openEditor = () => {
    setError(null)
    setSeeded(false)
    setDraft('')
    setEditOpen(true)
  }

  const mutation = useMutation({
    mutationFn: (value: string | null) =>
      writes.setDocument(entity._entityTypeKey, entity._id, property.key, value),
    onSuccess: (outcome) => {
      // Staged: the dialog closes, the row keeps the stored value.
      if (outcome.kind === 'staged') {
        setEditOpen(false)
        writes.toastStaged(outcome)
        return
      }
      const updated = outcome.value
      queryClient.setQueryData(
        qk.entity(ontologyKey, lensKey, entity._entityTypeKey, entity._id),
        updated,
      )
      void queryClient.invalidateQueries({
        queryKey: qk.entities(ontologyKey, lensKey, entity._entityTypeKey),
      })
      void queryClient.invalidateQueries({
        queryKey: qk.document(ontologyKey, lensKey, entity._entityTypeKey, entity._id, property.key),
      })
      setEditOpen(false)
      toast.success(`${property.displayName} saved`)
    },
    onError: (err) => {
      if (err instanceof ApiError) {
        setError(err.fieldErrors?.[property.key] ?? err.message)
      } else {
        setError(err instanceof Error ? err.message : 'Save failed')
      }
    },
  })

  const save = () => {
    const value = draft.trim() === '' ? null : draft
    if (value === null && property.required) {
      setError('Required — cannot be cleared')
      return
    }
    // Pinned: an unchanged value would stage a write that changes nothing, so it just closes.
    const unchanged = source === null ? null : (source.data?.content ?? null)
    if (value === unchanged && pinnedChangeset(ontologyKey, lensKey) !== null) {
      setEditOpen(false)
      return
    }
    mutation.mutate(value)
  }

  return (
    <div className="grid grid-cols-[130px_minmax(0,1fr)] items-start gap-3 px-4 py-2">
      <Tooltip>
        <TooltipTrigger asChild>
          <span className="mt-1 truncate text-[12.5px] text-muted-foreground">
            {property.displayName}
            {property.required && (
              <span aria-hidden className="ml-0.5 text-destructive">
                *
              </span>
            )}
          </span>
        </TooltipTrigger>
        <TooltipContent side="left">
          <span className="font-mono">
            {property.key} · {property.dataType}
          </span>
        </TooltipContent>
      </Tooltip>

      <div className="min-w-0">
        <div className="flex items-center gap-1">
          <button
            type="button"
            disabled={!hasValue}
            onClick={() => setExpanded((prev) => !prev)}
            className="-mx-1.5 flex min-h-7 items-center gap-1.5 rounded-md px-1.5 py-1 text-left text-[13px] transition-colors duration-100 hover:bg-muted/60 focus-visible:outline-2 focus-visible:outline-ring/60 disabled:cursor-default disabled:hover:bg-transparent"
            aria-expanded={expanded}
            aria-label={`${expanded ? 'Collapse' : 'Expand'} ${property.displayName}`}
          >
            {hasValue ? (
              <>
                {expanded ? (
                  <ChevronDown className="size-3.5 shrink-0 text-muted-foreground" />
                ) : (
                  <ChevronRight className="size-3.5 shrink-0 text-muted-foreground" />
                )}
                <DocumentBadge length={stub.length} />
              </>
            ) : (
              <span className="text-muted-foreground/50">—</span>
            )}
          </button>
          {canEdit && (
            <Button
              variant="ghost"
              size="icon"
              className="size-6 text-muted-foreground"
              onClick={openEditor}
              aria-label={`Edit ${property.displayName}`}
            >
              <Pencil className="size-3" />
            </Button>
          )}
        </div>

        {staged !== undefined && (
          <div className="flex flex-wrap items-center gap-1.5 text-[12px] text-(--tc-amber)">
            <span>staged · {stagedStub === null ? 'removed' : formatDocSize(stagedStub.length)}</span>
            {stagedStub !== null && (
              <>
                <span aria-hidden>·</span>
                <button
                  type="button"
                  onClick={() => setViewing(true)}
                  className="font-medium underline-offset-2 hover:underline focus-visible:outline-2 focus-visible:outline-ring/60"
                  aria-label={`View the staged ${property.displayName}`}
                >
                  View
                </button>
              </>
            )}
            {staged.drift !== null && <MarkerChip marker={staged.drift} />}
          </div>
        )}

        {expanded && hasValue && (
          <div className="mt-1.5 mb-1 max-h-96 overflow-y-auto rounded-md border bg-muted/20 px-3 py-2.5">
            {docQuery.isPending ? (
              <div className="flex items-center justify-center py-4">
                <Loader2 className="size-4 animate-spin text-muted-foreground" />
              </div>
            ) : docQuery.isError ? (
              <p className="py-2 text-xs text-destructive">
                Failed to load document: {docQuery.error.message}
              </p>
            ) : (
              <DocumentMarkdown>{docQuery.data.content}</DocumentMarkdown>
            )}
          </div>
        )}
      </div>

      <Dialog open={editOpen} onOpenChange={(open) => !open && setEditOpen(false)}>
        <DialogContent className="sm:max-w-2xl">
          <DialogHeader>
            <DialogTitle>Edit {property.displayName}</DialogTitle>
            <DialogDescription>
              Markdown document — saved whole on confirm.
            </DialogDescription>
          </DialogHeader>
          {!seeded ? (
            source?.isError ? (
              <p className="py-8 text-center text-xs text-destructive">
                Failed to load document: {source.error.message}
              </p>
            ) : (
              <div className="flex items-center justify-center py-10">
                <Loader2 className="size-4 animate-spin text-muted-foreground" />
              </div>
            )
          ) : (
            <DocumentEditor
              value={draft}
              onChange={(next) => {
                setDraft(next)
                setError(null)
              }}
              rows={14}
              autoFocus
              invalid={error !== null}
              disabled={mutation.isPending}
            />
          )}
          {error !== null && <p className="text-xs text-destructive">{error}</p>}
          <DialogFooter>
            <Button
              type="button"
              variant="ghost"
              onClick={() => setEditOpen(false)}
              disabled={mutation.isPending}
            >
              Cancel
            </Button>
            <Button
              type="button"
              onClick={save}
              disabled={!seeded || mutation.isPending}
            >
              {mutation.isPending && <Loader2 className="size-3.5 animate-spin" />}
              Save
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      {changesetId !== undefined && (
        <DocumentViewerDialog
          ontologyKey={ontologyKey}
          lensKey={lensKey}
          changesetId={changesetId}
          target={
            viewing && stagedStub !== null
              ? {
                  entityTypeKey: entity._entityTypeKey,
                  entityId: entity._id,
                  entityLabel,
                  property,
                  length: stagedStub.length,
                }
              : null
          }
          onClose={() => setViewing(false)}
        />
      )}
    </div>
  )
}
