/**
 * Side panels of the index designer: the save bar with the cost preview,
 * and the build status block with Rebuild.
 */

import { LoaderCircle, RotateCw, Save, Undo2 } from 'lucide-react'
import { toast } from 'sonner'
import { useRebuildSearchIndex, useSearchIndexStatus } from '@/api/searchIndexHooks'
import type { SearchIndexPreview, SearchIndexRecord } from '@/api/types'
import { toastError } from '@/components/studio/lib'
import {
  AlertDialog,
  AlertDialogAction,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
  AlertDialogTrigger,
} from '@/components/ui/alert-dialog'
import { Button } from '@/components/ui/button'
import { cn } from '@/lib/utils'
import {
  MAX_INDEX_FIELDS,
  MAX_RELATION_GROUPS,
  formatDuration,
  representationLine,
} from './searchIndexModel'
import { StatusChip } from './shared'

const count = (n: number) => n.toLocaleString('en-US')

interface IndexSaveBarProps {
  isNew: boolean
  dirty: boolean
  canSave: boolean
  busy: boolean
  /** False while the draft has no entity type — nothing to estimate yet. */
  previewRequested: boolean
  /** The client already sees problems — no estimate until they are resolved. */
  blocked: boolean
  /** The preview of the current draft; undefined while it is on its way. */
  preview: SearchIndexPreview | undefined
  previewFetching: boolean
  fieldCount: number
  groupCount: number
  onSave: () => void
  onDiscard: () => void
}

/**
 * The one place that decides whether edits take effect, with the cost of
 * taking them: estimated entries and build time of the current draft.
 */
export function IndexSaveBar({
  isNew,
  dirty,
  canSave,
  busy,
  previewRequested,
  blocked,
  preview,
  previewFetching,
  fieldCount,
  groupCount,
  onSave,
  onDiscard,
}: IndexSaveBarProps) {
  const estimate = preview?.estimate ?? null
  return (
    <div
      className={cn(
        'space-y-3 rounded-xl border bg-card p-3',
        dirty && 'border-(--tc-amber-border) bg-(--tc-amber-bg)',
      )}
    >
      <p className="text-xs">
        {isNew ? (
          <>
            <b>New index.</b> Saving creates it and starts building its entries.
          </>
        ) : dirty ? (
          <>
            <b>Unsaved changes.</b> Saving builds the index again in the background.
          </>
        ) : (
          <span className="text-muted-foreground">All changes saved.</span>
        )}
      </p>

      <div className="rounded-lg border bg-background/60 p-2.5">
        <div className="flex items-center gap-1.5 text-[11px] font-medium uppercase tracking-wider text-muted-foreground">
          Cost preview
          {previewFetching && <LoaderCircle className="size-3 animate-spin" />}
        </div>
        {!previewRequested ? (
          <p className="mt-1 text-[12px] text-muted-foreground">
            Choose an entity type to see the estimate.
          </p>
        ) : !blocked && preview === undefined ? (
          <p className="mt-1 text-[12px] text-muted-foreground">Estimating…</p>
        ) : blocked || estimate === null ? (
          <p className="mt-1 text-[12px] text-muted-foreground">
            Resolve the issues to see the estimate.
          </p>
        ) : (
          <div className="mt-1 space-y-1">
            <p className="text-[13px]">
              <span className="font-semibold">≈ {count(estimate.entries)}</span> entries ·{' '}
              <span className="font-semibold">≈ {formatDuration(estimate.seconds)}</span>
            </p>
            <p className="text-[11px] text-muted-foreground">
              from {count(estimate.entities)} entities
            </p>
            <ul className="space-y-0.5 text-[11px] text-muted-foreground">
              {estimate.perRepresentation.map((r) => (
                <li key={r.representation}>
                  <span className="font-mono">{r.representation}</span>: {count(r.entries)}{' '}
                  entries · {formatDuration(r.seconds)}
                  {!r.measured && ' (default rate)'}
                </li>
              ))}
            </ul>
          </div>
        )}
        <p
          className={cn(
            'mt-2 border-t pt-1.5 text-[11px] text-muted-foreground',
            (fieldCount > MAX_INDEX_FIELDS || groupCount > MAX_RELATION_GROUPS) &&
              'text-destructive',
          )}
        >
          {fieldCount}/{MAX_INDEX_FIELDS} fields · {groupCount}/{MAX_RELATION_GROUPS} relation
          groups
        </p>
      </div>

      {/* A fixed grid instead of wrapping flex: the side column can be narrow. */}
      <div className="grid grid-cols-2 gap-2">
        <Button size="sm" className="gap-1" disabled={busy || !dirty || !canSave} onClick={onSave}>
          <Save className="size-3.5" />
          {isNew ? 'Create' : 'Save'}
        </Button>
        <Button
          size="sm"
          variant="outline"
          className="gap-1"
          disabled={busy || !dirty}
          onClick={onDiscard}
        >
          <Undo2 className="size-3.5" />
          Discard
        </Button>
      </div>
    </div>
  )
}

/** Build status of a saved index (polled while building or stale) and Rebuild. */
export function IndexStatusBlock({
  ontologyKey,
  record,
}: {
  ontologyKey: string
  record: SearchIndexRecord
}) {
  const statusQuery = useSearchIndexStatus(ontologyKey, record.key)
  const status = statusQuery.data ?? record.status
  const rebuild = useRebuildSearchIndex(ontologyKey)

  return (
    <div className="space-y-2.5 rounded-xl border bg-card p-3">
      <div className="flex items-center gap-2">
        <h2 className="text-[13px] font-semibold">Status</h2>
        <StatusChip status={status} />
      </div>
      {status.representations.length > 0 && (
        <ul className="space-y-0.5 text-[12px]">
          {status.representations.map((r) => (
            <li key={r.representation} className="flex gap-2">
              <span className="w-16 shrink-0 font-mono text-muted-foreground">
                {r.representation}
              </span>
              <span>{representationLine(r)}</span>
            </li>
          ))}
        </ul>
      )}
      {status.lastErrors.length > 0 && (
        <details className="rounded-lg border border-destructive/30 bg-destructive/5 px-2.5 py-1.5 text-[12px]">
          <summary className="cursor-pointer text-destructive">
            Last errors ({status.lastErrors.length})
          </summary>
          <ul className="mt-1.5 space-y-1.5">
            {status.lastErrors.map((e, i) => (
              <li key={i}>
                <span className="font-mono text-[11px] text-muted-foreground">
                  {e.partKind} · {e.entityId.slice(0, 12)} · {new Date(e.at).toLocaleString('en-US')}
                </span>
                <p className="break-words">{e.message}</p>
              </li>
            ))}
          </ul>
        </details>
      )}
      <AlertDialog>
        <AlertDialogTrigger asChild>
          <Button
            size="sm"
            variant="outline"
            className="w-full gap-1"
            disabled={!record.enabled || rebuild.isPending}
            title={record.enabled ? undefined : 'Switched off — switch it on to build it'}
          >
            <RotateCw className={cn('size-3.5', rebuild.isPending && 'animate-spin')} />
            Rebuild
          </Button>
        </AlertDialogTrigger>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>Rebuild "{record.definition.name}"?</AlertDialogTitle>
            <AlertDialogDescription>
              Every entry of this index is built again in the background, which retries
              failed items. Search keeps using the current entries until the new build is
              ready. With an embedding provider, every entry is embedded again.
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel>Cancel</AlertDialogCancel>
            <AlertDialogAction
              onClick={() =>
                rebuild.mutate(record.key, {
                  onSuccess: () => toast.success('Rebuild started'),
                  onError: toastError,
                })
              }
            >
              Rebuild
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </div>
  )
}
