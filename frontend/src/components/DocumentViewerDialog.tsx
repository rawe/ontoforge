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
  /** `null` keeps the dialog closed. */
  target: DocumentViewerTarget | null
  onClose: () => void
}

/**
 * Read-only overlay for one `document` property: fetches the full content on
 * open (shared `qk.document` cache) and renders it as Markdown in a large
 * scrollable layer. Reused wherever a document stub is one click away from
 * being read — explore node panel, entity tables.
 */
export function DocumentViewerDialog({
  ontologyKey,
  target,
  onClose,
}: DocumentViewerDialogProps) {
  const docQuery = useQuery({
    queryKey: qk.document(
      ontologyKey,
      target?.entityTypeKey ?? '',
      target?.entityId ?? '',
      target?.property.key ?? '',
    ),
    queryFn: () =>
      runtime.getDocument(
        ontologyKey,
        target!.entityTypeKey,
        target!.entityId,
        target!.property.key,
      ),
    enabled: target !== null,
  })

  return (
    <Dialog open={target !== null} onOpenChange={(open) => !open && onClose()}>
      <DialogContent className="flex max-h-[85vh] flex-col sm:max-w-3xl">
        <DialogHeader>
          <DialogTitle>{target?.property.displayName}</DialogTitle>
          <DialogDescription className="flex min-w-0 items-center gap-2">
            <span className="truncate">{target?.entityLabel}</span>
            {target !== null && <DocumentBadge length={target.length} />}
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
