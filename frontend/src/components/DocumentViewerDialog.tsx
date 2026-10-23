import { useQuery } from '@tanstack/react-query'
import { Loader2 } from 'lucide-react'
import { qk } from '@/api/queryKeys'
import * as runtime from '@/api/runtime'
import type { SchemaProperty } from '@/api/types'
import { DocumentBadge } from '@/components/DocumentBadge'
import { DocumentMarkdown } from '@/components/schema/DocumentEditor'
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
} from '@/components/ui/dialog'

/** Which document to show: entity coordinates + the document property. */
export interface DocumentViewerTarget {
  entityTypeKey: string
  entityId: string
  /** Display label of the owning entity, shown under the title. */
  entityLabel: string
  property: SchemaProperty
  /** Character count from the stub, for the header badge. */
  length: number
}

interface DocumentViewerDialogProps {
  ontologyKey: string
  lensKey: string
  /** `null` keeps the dialog closed. */
  target: DocumentViewerTarget | null
  /** Set: show the text a commit of this changeset would leave (its staged
   * value of the property) instead of the stored text. */
  changesetId?: string
  onClose: () => void
}

/**
 * Read-only overlay for one `document` property: fetches the full content on
 * open (shared `qk.document` cache) and renders it as Markdown in a large
 * scrollable layer. Reused wherever a document stub is one click away from
 * being read — explore node panel, entity tables, a changeset's review
 * (the staged text, under the changeset's key).
 */
export function DocumentViewerDialog({
  ontologyKey,
  lensKey,
  target,
  changesetId,
  onClose,
}: DocumentViewerDialogProps) {
  const typeKey = target?.entityTypeKey ?? ''
  const entityId = target?.entityId ?? ''
  const propertyKey = target?.property.key ?? ''
  const docQuery = useQuery({
    queryKey:
      changesetId === undefined
        ? qk.document(ontologyKey, lensKey, typeKey, entityId, propertyKey)
        : qk.changesets(ontologyKey, lensKey, changesetId, ['document', typeKey, entityId, propertyKey]),
    queryFn: () =>
      changesetId === undefined
        ? runtime.getDocument(ontologyKey, lensKey, typeKey, entityId, propertyKey)
        : runtime.getStagedDocument(ontologyKey, lensKey, changesetId, typeKey, entityId, propertyKey),
    enabled: target !== null,
  })

  return (
    <Dialog open={target !== null} onOpenChange={(open) => !open && onClose()}>
      <DialogContent className="flex max-h-[85vh] flex-col sm:max-w-3xl">
        <DialogHeader>
          <DialogTitle>{target?.property.displayName}</DialogTitle>
          <DialogDescription className="flex min-w-0 items-center gap-2">
            <span className="truncate">{target?.entityLabel}</span>
            {target !== null && <DocumentBadge length={docQuery.data?.totalLength ?? target.length} />}
            {changesetId !== undefined && <span className="shrink-0">· staged text, as a commit would leave it</span>}
          </DialogDescription>
        </DialogHeader>
        <div className="min-h-24 flex-1 overflow-y-auto rounded-md border bg-muted/20 px-4 py-3">
          {docQuery.isPending ? (
            <div className="flex items-center justify-center py-10">
              <Loader2 className="size-4 animate-spin text-muted-foreground" />
            </div>
          ) : docQuery.isError ? (
            <p className="py-4 text-center text-xs text-destructive">
              Failed to load document: {docQuery.error.message}
            </p>
          ) : (
            <DocumentMarkdown>{docQuery.data.content}</DocumentMarkdown>
          )}
        </div>
      </DialogContent>
    </Dialog>
  )
}
