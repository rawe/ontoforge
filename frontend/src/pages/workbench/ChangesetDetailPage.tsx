import { useMutation, useQueryClient } from '@tanstack/react-query'
import {
  Anchor as AnchorIcon,
  Check,
  ChevronLeft,
  ChevronRight,
  FileStack,
  FileText,
  Loader2,
  Trash2,
  Undo2,
} from 'lucide-react'
import { useEffect, useState, type ReactNode } from 'react'
import { Link, useNavigate, useParams } from 'react-router-dom'
import { toast } from 'sonner'
import { useChangeset, useChangesets, useRuntimeSchema } from '@/api/hooks'
import { ApiError } from '@/api/http'
import { qk } from '@/api/queryKeys'
import * as runtime from '@/api/runtime'
import type { ChangesetViolation, JsonValue, StagedWriteView } from '@/api/types'
import { DocumentViewerDialog, type DocumentViewerTarget } from '@/components/DocumentViewerDialog'
import { EmptyState } from '@/components/EmptyState'
import { PageHeader } from '@/components/PageHeader'
import { TypeChip } from '@/components/TypeChip'
import { ChangesetStateChip } from '@/components/changesets/ChangesetStateChip'
import { ChangesetExplainerButton } from '@/components/changesets/explainer/ChangesetExplainer'
import {
  changeText,
  isCommittedDataKey,
  isVersionMismatch,
  markerLabel,
  MAX_NOTE_LENGTH,
  operationLabel,
  operationsSummary,
  shortId,
  stagedDocumentKeys,
  targetText,
  violationLine,
  violationsNote,
  violationsOf,
  WRITES_PAGE_SIZE,
  writesText,
} from '@/components/changesets/changesets'
import { absoluteTime, relativeTime } from '@/components/table/format'
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
import { Skeleton } from '@/components/ui/skeleton'
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from '@/components/ui/table'
import { Textarea } from '@/components/ui/textarea'
import { Tooltip, TooltipContent, TooltipTrigger } from '@/components/ui/tooltip'
import { cn } from '@/lib/utils'

/** Why Unstage and Discard are off while submitted. */
const FROZEN_REASON = 'Submitted changesets are frozen: unsubmit it first'

const errorText = (err: unknown, fallback: string) => (err instanceof Error ? err.message : fallback)

/** A disabled control with its reason on hover: a disabled button gets no pointer events. */
function Disabled({ reason, children }: { reason: string; children: ReactNode }) {
  return (
    <Tooltip>
      <TooltipTrigger asChild>
        <span tabIndex={0}>{children}</span>
      </TooltipTrigger>
      <TooltipContent>{reason}</TooltipContent>
    </Tooltip>
  )
}

/**
 * `/o/:ontologyKey/w/:lensKey/changesets/:changesetId` — one changeset's
 * review through the current lens: its writes by seq with names, before →
 * after and markers; a document change opens its staged text in the
 * document viewer. Commit sends the version shown; Unsubmit sends a note;
 * Discard and Unstage work only on a draft.
 */
export function ChangesetDetailPage() {
  const { ontologyKey, lensKey, changesetId } = useParams<{
    ontologyKey: string
    lensKey: string
    changesetId: string
  }>()
  const navigate = useNavigate()
  const queryClient = useQueryClient()
  const [offset, setOffset] = useState(0)
  // Set once a commit or discard removed the changeset: its read must not run again.
  const [gone, setGone] = useState(false)
  const read = useChangeset(ontologyKey!, lensKey!, changesetId!, { offset, limit: WRITES_PAGE_SIZE }, !gone)
  const list = useChangesets(ontologyKey, lensKey)
  const schema = useRuntimeSchema(ontologyKey, lensKey)

  const [rejected, setRejected] = useState<{ violations: ChangesetViolation[]; total: number } | null>(null)
  const [unsubmitOpen, setUnsubmitOpen] = useState(false)
  const [note, setNote] = useState('')
  const [discardOpen, setDiscardOpen] = useState(false)
  const [docTarget, setDocTarget] = useState<DocumentViewerTarget | null>(null)

  const listUrl = `/o/${ontologyKey}/w/${lensKey}/changesets`
  // The list and every page of this changeset's read share the list's key.
  const reload = () => queryClient.invalidateQueries({ queryKey: qk.changesets(ontologyKey!, lensKey!) })
  /**
   * The changeset is gone: stop its read, refresh only the list, and leave.
   * Its cached pages are dropped once the page has unmounted (below): removed
   * while still observed, the read would be fetched again into a 404.
   */
  const leave = () => {
    setGone(true)
    void queryClient.invalidateQueries({ queryKey: qk.changesets(ontologyKey!, lensKey!), exact: true })
    void navigate(listUrl)
  }
  useEffect(() => {
    if (!gone) return
    return () => queryClient.removeQueries({ queryKey: qk.changesets(ontologyKey!, lensKey!, changesetId!) })
  }, [gone, queryClient, ontologyKey, lensKey, changesetId])

  const commit = useMutation({
    mutationFn: (expectedVersion: number) =>
      runtime.commitChangeset(ontologyKey!, lensKey!, changesetId!, expectedVersion),
    onSuccess: (result) => {
      toast.success(`Committed ${writesText(result.committed)}`)
      // The changed entities show wherever they are read next.
      void queryClient.invalidateQueries({
        predicate: (query) => isCommittedDataKey(query.queryKey, ontologyKey!),
      })
      leave()
    },
    onError: (err) => {
      if (err instanceof ApiError && err.status === 422) {
        const found = violationsOf(err.details)
        if (found !== null) {
          setRejected(found)
          void reload()
          return
        }
      }
      if (err instanceof ApiError && isVersionMismatch(err)) {
        toast.warning('This changeset changed since you looked. It was reloaded: review it again.')
      } else {
        toast.error(errorText(err, 'Failed to commit'))
      }
      setRejected(null)
      void reload()
    },
  })

  const unsubmit = useMutation({
    mutationFn: (text: string) => runtime.unsubmitChangeset(ontologyKey!, lensKey!, changesetId!, text),
    onSuccess: () => {
      toast.success('Unsubmitted: the changeset is a draft again')
      setUnsubmitOpen(false)
      setRejected(null)
      void reload()
    },
    onError: (err) => {
      toast.error(errorText(err, 'Failed to unsubmit'))
      void reload()
    },
  })

  const discard = useMutation({
    mutationFn: () => runtime.discardChangeset(ontologyKey!, lensKey!, changesetId!),
    onSuccess: () => {
      toast.success('Changeset discarded')
      setDiscardOpen(false)
      leave()
    },
    onError: (err) => {
      toast.error(errorText(err, 'Failed to discard'))
      setDiscardOpen(false)
      void reload()
    },
  })

  const unstage = useMutation({
    mutationFn: (seq: number) => runtime.unstageWrite(ontologyKey!, lensKey!, changesetId!, seq),
    onSuccess: (_, seq) => {
      toast.success(`#${seq} unstaged`)
      setRejected(null)
      // The last row of a trailing page: back one page.
      if (offset > 0 && read.data?.writes.length === 1) setOffset(offset - WRITES_PAGE_SIZE)
      void reload()
    },
    onError: (err) => {
      toast.error(errorText(err, 'Failed to unstage'))
      void reload()
    },
  })

  if (ontologyKey === undefined || lensKey === undefined || changesetId === undefined) return null

  const back = (
    <Link
      to={listUrl}
      className="mb-1 inline-flex items-center gap-0.5 text-[12px] text-muted-foreground hover:text-foreground"
    >
      <ChevronLeft className="size-3.5" />
      Changesets
    </Link>
  )

  if (read.isPending) {
    return (
      <div>
        <PageHeader breadcrumb={back} title="Changeset" />
        <div className="space-y-2 p-6">
          <Skeleton className="h-10 w-full" />
          <Skeleton className="h-10 w-full" />
        </div>
      </div>
    )
  }

  if (read.isError) {
    const missing = read.error instanceof ApiError && read.error.status === 404
    return (
      <div>
        <PageHeader breadcrumb={back} title="Changeset" />
        <EmptyState
          icon={FileStack}
          title={missing ? 'Changeset not found' : 'Could not load the changeset'}
          description={
            missing
              ? 'It was committed, discarded or expired, or this lens does not reach it.'
              : read.error.message
          }
          action={
            <Button asChild size="sm" variant="outline">
              <Link to={listUrl}>Open the list</Link>
            </Button>
          }
        />
      </div>
    )
  }

  const changeset = read.data
  const submitted = changeset.state === 'submitted'
  const operations = list.data?.find((item) => item.id === changeset.id)?.operations
  const summary = operations === undefined ? '' : operationsSummary(operations)
  const busy = commit.isPending || unsubmit.isPending || discard.isPending || unstage.isPending

  const typeLabel = (write: StagedWriteView) => {
    if (write.type === null) return <span className="text-muted-foreground">—</span>
    const entityType = schema.data?.entityTypes.find((t) => t.key === write.type)
    if (entityType !== undefined) {
      return <TypeChip typeKey={entityType.key} displayName={entityType.displayName} size="sm" />
    }
    const relationType = schema.data?.relationTypes.find((t) => t.key === write.type)
    return <span className="text-[12.5px]">{relationType?.displayName ?? write.type}</span>
  }

  /** The staged document properties of a write, each a button opening its staged text;
   * none when a later write on the page deletes the entity. */
  const documentButtons = (write: StagedWriteView) => {
    const entityType = schema.data?.entityTypes.find((t) => t.key === write.type)
    const buttons = stagedDocumentKeys(write, changeset.writes).flatMap((key) => {
      const property = entityType?.properties.find((p) => p.key === key)
      if (property === undefined) return []
      const stub = write.after?.[key] as Record<string, JsonValue>
      return [
        <Button
          key={key}
          variant="outline"
          size="xs"
          aria-label={`View the staged ${property.displayName} of #${write.seq}`}
          onClick={() =>
            setDocTarget({
              entityTypeKey: write.type!,
              entityId: write.id!,
              entityLabel: targetText(write),
              property,
              length: typeof stub.length === 'number' ? stub.length : 0,
            })
          }
        >
          <FileText className="size-3" />
          View {property.displayName}
        </Button>,
      ]
    })
    return buttons.length === 0 ? null : <div className="mt-1 flex flex-wrap gap-1">{buttons}</div>
  }

  const discardButton = (
    <Button
      size="sm"
      variant="outline"
      disabled={submitted || busy}
      className="text-destructive hover:text-destructive"
      onClick={() => setDiscardOpen(true)}
    >
      <Trash2 className="size-3.5" />
      Discard
    </Button>
  )

  return (
    <div>
      <PageHeader
        breadcrumb={back}
        title={`Changeset ${shortId(changeset.id)}`}
        meta={
          <>
            <ChangesetExplainerButton className="-ml-2" />
            <ChangesetStateChip state={changeset.state} />
            {changeset.anchor !== null && (
              <span className="inline-flex items-center gap-1 rounded-full border px-2 py-0.5 font-mono text-[11px]">
                <AnchorIcon className="size-3" />
                {changeset.anchor}
              </span>
            )}
          </>
        }
        description={
          <>
            {writesText(changeset.writeCount)}
            {summary !== '' && `: ${summary}`} · version {changeset.version} ·{' '}
            <span title={absoluteTime(changeset.createdAt)}>started {relativeTime(changeset.createdAt)}</span>{' '}
            · <span title={absoluteTime(changeset.lastChangeAt)}>last change {relativeTime(changeset.lastChangeAt)}</span>
            {changeset.submittedAt !== null && (
              <>
                {' '}· <span title={absoluteTime(changeset.submittedAt)}>submitted {relativeTime(changeset.submittedAt)}</span>
              </>
            )}
          </>
        }
        actions={
          <>
            <Button size="sm" disabled={busy} onClick={() => commit.mutate(changeset.version)}>
              {commit.isPending ? <Loader2 className="size-3.5 animate-spin" /> : <Check className="size-3.5" />}
              Commit
            </Button>
            {submitted && (
              <Button
                size="sm"
                variant="outline"
                disabled={busy}
                onClick={() => {
                  setNote('')
                  setUnsubmitOpen(true)
                }}
              >
                <Undo2 className="size-3.5" />
                Unsubmit
              </Button>
            )}
            {submitted ? <Disabled reason={FROZEN_REASON}>{discardButton}</Disabled> : discardButton}
          </>
        }
      />

      <div className="space-y-4 p-6">
        <div className="rounded-lg border bg-muted/30 px-3 py-2 text-[13px]">
          <div className="text-[11px] font-semibold uppercase tracking-wide text-muted-foreground">Note</div>
          {changeset.note === null ? (
            <p className="text-muted-foreground">No note</p>
          ) : (
            <p className="whitespace-pre-wrap">{changeset.note}</p>
          )}
        </div>

        {rejected !== null && (
          <div
            role="alert"
            aria-label="Commit violations"
            className="rounded-lg border border-destructive bg-destructive/10 px-3 py-2.5"
          >
            <div className="flex items-start gap-3">
              <div className="min-w-0 flex-1">
                <p className="text-[13px] font-semibold text-destructive">
                  Commit rejected, nothing persisted: {rejected.total}{' '}
                  {rejected.total === 1 ? 'violation' : 'violations'}
                  {rejected.total > rejected.violations.length &&
                    ` (the first ${rejected.violations.length} shown)`}
                </p>
                <ul className="mt-1 max-h-60 space-y-0.5 overflow-y-auto text-[12.5px]">
                  {rejected.violations.map((violation, i) => (
                    <li key={i} className="break-words">
                      {violationLine(violation, changeset.writes)}
                    </li>
                  ))}
                </ul>
              </div>
              {submitted && (
                <Button
                  size="sm"
                  variant="outline"
                  disabled={busy}
                  onClick={() => unsubmit.mutate(violationsNote(rejected.violations, rejected.total, changeset.writes))}
                >
                  Unsubmit with these violations
                </Button>
              )}
            </div>
          </div>
        )}

        {changeset.writeCount === 0 ? (
          <EmptyState icon={FileStack} title="No staged writes" description="Nothing is staged in this changeset." />
        ) : (
          <>
            <Table>
              <TableHeader>
                <TableRow>
                  <TableHead className="w-12">#</TableHead>
                  <TableHead className="w-28">Operation</TableHead>
                  <TableHead className="w-[14%]">Type</TableHead>
                  <TableHead className="w-[18%]">Target</TableHead>
                  <TableHead className="min-w-56">Change</TableHead>
                  <TableHead className="w-20 text-right">Unstage</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {changeset.writes.map((write) => {
                  const unstageButton = (
                    <Button
                      variant="outline"
                      size="xs"
                      aria-label={`Unstage #${write.seq}`}
                      disabled={submitted || busy}
                      onClick={() => unstage.mutate(write.seq)}
                    >
                      Unstage
                    </Button>
                  )
                  return (
                    <TableRow
                      key={write.seq}
                      className={cn(write.markers.length > 0 && 'bg-(--tc-amber-bg) hover:bg-(--tc-amber-bg)')}
                    >
                      <TableCell className="text-[12.5px] text-muted-foreground tabular-nums">{write.seq}</TableCell>
                      <TableCell className="text-[13px]">{operationLabel(write.operation)}</TableCell>
                      <TableCell>{typeLabel(write)}</TableCell>
                      <TableCell className="max-w-0 truncate text-[13px] font-medium" title={write.id ?? undefined}>
                        {targetText(write)}
                      </TableCell>
                      <TableCell className="whitespace-normal">
                        <div className="text-[13px] break-words">{changeText(write)}</div>
                        {documentButtons(write)}
                        {write.markers.length > 0 && (
                          <div className="mt-1 flex flex-wrap gap-1">
                            {write.markers.map((marker, i) => (
                              <span
                                key={i}
                                title={marker.message}
                                className={cn(
                                  'inline-flex items-center rounded-full border px-2 py-0.5 text-[11px] font-semibold',
                                  marker.kind === 'drift'
                                    ? 'border-(--tc-amber-border) bg-background text-(--tc-amber)'
                                    : 'border-destructive bg-background text-destructive',
                                )}
                              >
                                {markerLabel(marker.kind)}
                              </span>
                            ))}
                          </div>
                        )}
                        {write.markers.map((marker, i) => (
                          <p key={i} className="mt-0.5 text-[11.5px] text-muted-foreground">
                            {marker.message}
                          </p>
                        ))}
                      </TableCell>
                      <TableCell className="text-right">
                        {submitted ? <Disabled reason={FROZEN_REASON}>{unstageButton}</Disabled> : unstageButton}
                      </TableCell>
                    </TableRow>
                  )
                })}
              </TableBody>
            </Table>

            {changeset.writeCount > WRITES_PAGE_SIZE && (
              <div className="flex items-center justify-between">
                <span className="text-xs tabular-nums text-muted-foreground">
                  {offset + 1}–{Math.min(offset + WRITES_PAGE_SIZE, changeset.writeCount)} of{' '}
                  {changeset.writeCount}
                </span>
                <div className="flex items-center gap-2">
                  <Button
                    variant="outline"
                    size="icon"
                    className="size-7"
                    disabled={offset === 0}
                    onClick={() => setOffset((o) => Math.max(0, o - WRITES_PAGE_SIZE))}
                    aria-label="Previous page"
                  >
                    <ChevronLeft className="size-3.5" />
                  </Button>
                  <Button
                    variant="outline"
                    size="icon"
                    className="size-7"
                    disabled={offset + WRITES_PAGE_SIZE >= changeset.writeCount}
                    onClick={() => setOffset((o) => o + WRITES_PAGE_SIZE)}
                    aria-label="Next page"
                  >
                    <ChevronRight className="size-3.5" />
                  </Button>
                </div>
              </div>
            )}
          </>
        )}
      </div>

      <DocumentViewerDialog
        ontologyKey={ontologyKey}
        lensKey={lensKey}
        changesetId={changeset.id}
        target={docTarget}
        onClose={() => setDocTarget(null)}
      />

      <AlertDialog open={discardOpen} onOpenChange={setDiscardOpen}>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>Discard this changeset?</AlertDialogTitle>
            <AlertDialogDescription>
              Its {writesText(changeset.writeCount)} are dropped and nothing is persisted. This cannot be
              undone.
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel>Cancel</AlertDialogCancel>
            <Button variant="destructive" disabled={discard.isPending} onClick={() => discard.mutate()}>
              {discard.isPending ? <Loader2 className="size-3.5 animate-spin" /> : <Trash2 className="size-3.5" />}
              Discard changeset
            </Button>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>

      <AlertDialog open={unsubmitOpen} onOpenChange={setUnsubmitOpen}>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>Unsubmit this changeset?</AlertDialogTitle>
            <AlertDialogDescription>
              It goes back to draft, so its writes can be changed again. The note replaces the current
              one: say what should change.
            </AlertDialogDescription>
          </AlertDialogHeader>
          <label className="grid gap-1.5 text-[12px] text-muted-foreground">
            <span>Note (required)</span>
            <Textarea
              value={note}
              maxLength={MAX_NOTE_LENGTH}
              rows={4}
              onChange={(e) => setNote(e.target.value)}
            />
            <span className="text-right tabular-nums">
              {note.length} / {MAX_NOTE_LENGTH}
            </span>
          </label>
          <AlertDialogFooter>
            <AlertDialogCancel>Cancel</AlertDialogCancel>
            <Button
              disabled={note.trim() === '' || unsubmit.isPending}
              onClick={() => unsubmit.mutate(note.trim())}
            >
              {unsubmit.isPending ? <Loader2 className="size-3.5 animate-spin" /> : <Undo2 className="size-3.5" />}
              Unsubmit changeset
            </Button>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </div>
  )
}
