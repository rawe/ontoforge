import { useMutation, useQueryClient } from '@tanstack/react-query'
import {
  Check,
  ChevronLeft,
  ChevronRight,
  FileStack,
  Loader2,
  Pencil,
  Plus,
  ScrollText,
  Send,
  Trash2,
  Undo2,
} from 'lucide-react'
import { useEffect, useState } from 'react'
import { Link, useNavigate, useParams } from 'react-router-dom'
import { toast } from 'sonner'
import { useChangeset, useChangesets, useDisplayLabel, useRulesets, useRuntimeSchema } from '@/api/hooks'
import { ApiError } from '@/api/http'
import { qk } from '@/api/queryKeys'
import * as runtime from '@/api/runtime'
import { stagedEntity } from '@/api/staging'
import type { ChangesetViolation, StagedObjectView } from '@/api/types'
import { DocumentViewerDialog, type DocumentViewerTarget } from '@/components/DocumentViewerDialog'
import { EmptyState } from '@/components/EmptyState'
import { PageHeader } from '@/components/PageHeader'
import { TypeChip } from '@/components/TypeChip'
import { ChangesetNoteField } from '@/components/changesets/ChangesetNoteField'
import { ChangesetStateChip } from '@/components/changesets/ChangesetStateChip'
import { ChangesetExplainerButton } from '@/components/changesets/explainer/ChangesetExplainer'
import {
  EditStagedEntityDialog,
  type StagedEntityTarget,
} from '@/components/changesets/EditStagedEntityDialog'
import {
  EXTEND_HINT_TEXT,
  isCommittedDataKey,
  isVersionMismatch,
  OBJECTS_PAGE_SIZE,
  objectsText,
  operationsSummary,
  stagedCreateValues,
  targetText,
  violationLabel,
  violationPrefix,
  violationsNote,
  violationsOf,
} from '@/components/changesets/changesets'
import { PinChangesetButton } from '@/components/changesets/PinChangesetButton'
import { Disabled, FROZEN_REASON, StagedObjectCard } from '@/components/changesets/StagedObjectCard'
import { useStagedObjectActions } from '@/components/changesets/useStagedObjectActions'
import { hierarchyLinks, linkedTypeKey, sharesLinkedType, type HierarchyLink } from '@/components/entity/hierarchy'
import { openQuickAdd } from '@/components/quickadd/quickAddBus'
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
import { Tooltip, TooltipContent, TooltipTrigger } from '@/components/ui/tooltip'
import { pinnedChangeset, unpinChangeset, usePinnedChangeset } from '@/lib/pinnedChangeset'
import { cn } from '@/lib/utils'

/** Why Unsubmit is off on a draft. */
const DRAFT_REASON = 'Only a submitted changeset can be unsubmitted'
/** Why Submit is off while submitted. */
const SUBMITTED_REASON = 'It is submitted already'

/**
 * The ruleset a changeset was started through, as a chip linking to the
 * Rulesets page; muted and struck through once the ruleset is deleted, since
 * the commit then rejects the changeset (`ruleset_gone`).
 */
function RulesetChip({ ontologyKey, lensKey, rulesetKey }: { ontologyKey: string; lensKey: string; rulesetKey: string }) {
  const rulesets = useRulesets(ontologyKey)
  const deleted = rulesets.data !== undefined && !rulesets.data.some((r) => r.key === rulesetKey)
  return (
    <Tooltip>
      <TooltipTrigger asChild>
        <Link
          to={`/o/${ontologyKey}/w/${lensKey}/rulesets`}
          className={cn(
            'inline-flex items-center gap-1 rounded-full border px-2 py-0.5 font-mono text-[11px] font-semibold hover:underline focus-visible:outline-2 focus-visible:outline-ring/60',
            deleted
              ? 'border-border bg-muted text-muted-foreground line-through'
              : 'border-(--tc-teal-border) bg-(--tc-teal-bg) text-(--tc-teal)',
          )}
        >
          <ScrollText className="size-3" />
          {rulesetKey}
        </Link>
      </TooltipTrigger>
      <TooltipContent>
        {deleted
          ? `Ruleset ${rulesetKey} was deleted: this changeset cannot be committed.`
          : `Started through ruleset ${rulesetKey}`}
      </TooltipContent>
    </Tooltip>
  )
}

const errorText = (err: unknown, fallback: string) => (err instanceof Error ? err.message : fallback)

/**
 * `/o/:ontologyKey/w/:lensKey/changesets/:changesetId` — one changeset's
 * review through the current lens: its staged objects by first touch, a card
 * each with its action, name or ends, markers and values (before / current /
 * after); a staged document opens its staged text in the document viewer.
 * Commit, after a confirmation, sends the version shown when it was clicked;
 * Submit, with an optional note, and Unsubmit, with a required one, move it
 * between draft and submitted; Discard, and removing an object, cutting a
 * value or accepting a drifted value's current one, work only on a draft. A draft can be pinned ("Work in this changeset"),
 * so the Workbench's writes stage into it; while it is, an entity it creates
 * offers "Edit values…" and an add-child button per parent relation on its
 * row, both staged here.
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
  const read = useChangeset(ontologyKey!, lensKey!, changesetId!, { offset, limit: OBJECTS_PAGE_SIZE }, !gone)
  const list = useChangesets(ontologyKey, lensKey)
  const schema = useRuntimeSchema(ontologyKey, lensKey)
  const pinned = usePinnedChangeset(ontologyKey!, lensKey!)
  const displayLabel = useDisplayLabel()

  // The violations of a rejected commit or submit.
  const [rejected, setRejected] = useState<{
    by: 'commit' | 'submit'
    violations: ChangesetViolation[]
    total: number
  } | null>(null)
  const [submitOpen, setSubmitOpen] = useState(false)
  const [unsubmitOpen, setUnsubmitOpen] = useState(false)
  const [note, setNote] = useState('')
  const [discardOpen, setDiscardOpen] = useState(false)
  // The version shown when Commit was clicked; set while its confirmation is open.
  const [commitVersion, setCommitVersion] = useState<number | null>(null)
  const [docTarget, setDocTarget] = useState<DocumentViewerTarget | null>(null)
  const [editTarget, setEditTarget] = useState<StagedEntityTarget | null>(null)

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
    if (pinnedChangeset(ontologyKey!, lensKey!) === changesetId) unpinChangeset(ontologyKey!, lensKey!)
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
      toast.success(`Committed ${objectsText(result.committed)}`)
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
          setCommitVersion(null)
          setRejected({ by: 'commit', ...found })
          void reload()
          return
        }
      }
      setCommitVersion(null)
      if (err instanceof ApiError && isVersionMismatch(err)) {
        toast.warning('This changeset changed since you looked. It was reloaded: review it again.')
      } else {
        toast.error(errorText(err, 'Failed to commit'))
      }
      setRejected(null)
      void reload()
    },
  })

  const submit = useMutation({
    mutationFn: (text: string) =>
      runtime.submitChangeset(ontologyKey!, lensKey!, changesetId!, text === '' ? undefined : text),
    onSuccess: () => {
      toast.success('Submitted: the changeset is frozen for review')
      setSubmitOpen(false)
      setRejected(null)
      void reload()
    },
    onError: (err) => {
      setSubmitOpen(false)
      const found = err instanceof ApiError && err.status === 422 ? violationsOf(err.details) : null
      if (found !== null) setRejected({ by: 'submit', ...found })
      else toast.error(errorText(err, 'Failed to submit'))
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

  const objectActions = useStagedObjectActions(ontologyKey!, lensKey!, changesetId!)

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
  const busy =
    commit.isPending || submit.isPending || unsubmit.isPending || discard.isPending || objectActions.busy

  const typeLabel = (object: StagedObjectView) => {
    if (object.type === null) return undefined
    const entityType = schema.data?.entityTypes.find((t) => t.key === object.type)
    if (entityType !== undefined) {
      return <TypeChip typeKey={entityType.key} displayName={entityType.displayName} size="sm" />
    }
    const relationType = schema.data?.relationTypes.find((t) => t.key === object.type)
    return <span className="text-[12.5px] text-muted-foreground">{relationType?.displayName ?? object.type}</span>
  }

  /** Opens the staged text of one of an entity's document values. */
  const viewDocument = (object: StagedObjectView, key: string) => {
    const property = schema.data?.entityTypes.find((t) => t.key === object.type)?.properties.find((p) => p.key === key)
    const stub = object.values.find((value) => value.property === key)?.after
    if (property === undefined) return
    const length = typeof stub === 'object' && stub !== null && !Array.isArray(stub) ? stub.length : null
    setDocTarget({
      entityTypeKey: object.type!,
      entityId: object.id,
      entityLabel: targetText(object),
      property,
      length: typeof length === 'number' ? length : 0,
    })
  }

  /**
   * A draft's staged entity create: "Edit values…" and an "Add child" button
   * per parent relation it can be the parent of (as on an entity page) while
   * it is the pinned changeset, else a hint.
   */
  const extendActions = (object: StagedObjectView) => {
    const values = submitted ? null : stagedCreateValues(object)
    const entityType = schema.data?.entityTypes.find((t) => t.key === object.type)
    if (values === null || entityType === undefined) return undefined
    if (pinned !== changeset.id) {
      return <p className="text-[11.5px] text-muted-foreground">{EXTEND_HINT_TEXT}</p>
    }
    const label = displayLabel(stagedEntity(entityType.key, object.id, values))
    const childLinks = hierarchyLinks(schema.data!.relationTypes, entityType.key).children
    const addChild = (link: HierarchyLink) =>
      openQuickAdd(linkedTypeKey(link), {
        relationTypeKey: link.relationType.key,
        typeKey: entityType.key,
        id: object.id,
        label,
        changesetId: changeset.id,
      })
    const childName = (link: HierarchyLink) =>
      schema.data!.entityTypes.find((t) => t.key === linkedTypeKey(link))?.displayName ?? linkedTypeKey(link)
    // Two parent relations to the same child type: the relation's name tells them apart.
    const buttonName = (link: HierarchyLink) =>
      sharesLinkedType(link, childLinks) ? `${childName(link)} (${link.relationType.displayName})` : childName(link)
    return (
      <div className="flex flex-wrap gap-1">
        {entityType.properties.length > 0 && (
          <Button
            variant="outline"
            size="xs"
            aria-label={`Edit the values of ${label}`}
            onClick={() => setEditTarget({ changesetId: changeset.id, entityType, id: object.id, label, values })}
          >
            <Pencil className="size-3" />
            Edit values…
          </Button>
        )}
        {childLinks.map((link) => (
          <Button
            key={link.relationType.key}
            variant="outline"
            size="xs"
            title={`Add a ${childName(link)} under ${label} via ${link.relationType.key}`}
            onClick={() => addChild(link)}
          >
            <Plus className="size-3" />
            Add {buttonName(link)}…
          </Button>
        ))}
      </div>
    )
  }

  /** A change of the page's objects succeeded: the rejection shown is stale. */
  const changed = () => setRejected(null)

  const submitButton = (
    <Button
      size="sm"
      variant="outline"
      disabled={submitted || busy}
      onClick={() => {
        setNote('')
        setSubmitOpen(true)
      }}
    >
      {submit.isPending ? <Loader2 className="size-3.5 animate-spin" /> : <Send className="size-3.5" />}
      Submit
    </Button>
  )

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

  const unsubmitButton = (
    <Button
      size="sm"
      variant="outline"
      disabled={!submitted || busy}
      onClick={() => {
        setNote('')
        setUnsubmitOpen(true)
      }}
    >
      <Undo2 className="size-3.5" />
      Unsubmit
    </Button>
  )

  return (
    <div>
      <PageHeader
        breadcrumb={back}
        title={`Changeset #${changeset.number}`}
        meta={
          <>
            <ChangesetExplainerButton className="-ml-2" />
            <ChangesetStateChip state={changeset.state} />
            {changeset.ruleset !== null && (
              <RulesetChip ontologyKey={ontologyKey!} lensKey={lensKey!} rulesetKey={changeset.ruleset} />
            )}
          </>
        }
        description={
          <>
            {objectsText(changeset.objectCount)}
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
            <PinChangesetButton ontologyKey={ontologyKey} lensKey={lensKey} changeset={changeset} />
            {submitted ? <Disabled reason={SUBMITTED_REASON}>{submitButton}</Disabled> : submitButton}
            <Button size="sm" disabled={busy} onClick={() => setCommitVersion(changeset.version)}>
              {commit.isPending ? <Loader2 className="size-3.5 animate-spin" /> : <Check className="size-3.5" />}
              Commit
            </Button>
            {submitted ? unsubmitButton : <Disabled reason={DRAFT_REASON}>{unsubmitButton}</Disabled>}
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
            aria-label={rejected.by === 'commit' ? 'Commit violations' : 'Submit violations'}
            className="rounded-lg border border-destructive bg-destructive/10 px-3 py-2.5"
          >
            <div className="flex items-start gap-3">
              <div className="min-w-0 flex-1">
                <p className="text-[13px] font-semibold text-destructive">
                  {rejected.by === 'commit' ? 'Commit rejected, nothing persisted' : 'Submit rejected, still a draft'}:{' '}
                  {rejected.total}{' '}
                  {rejected.total === 1 ? 'violation' : 'violations'}
                  {rejected.total > rejected.violations.length &&
                    ` (the first ${rejected.violations.length} shown)`}
                </p>
                <ul className="mt-1 max-h-60 space-y-0.5 overflow-y-auto text-[12.5px]">
                  {rejected.violations.map((violation, i) => {
                    const label = violationLabel(violation.kind)
                    return (
                      <li key={i} className="break-words">
                        {violationPrefix(violation, changeset.objects)}
                        {label === null ? violation.kind : <span className="font-medium">{label}</span>} —{' '}
                        {violation.message}
                      </li>
                    )
                  })}
                </ul>
              </div>
              {submitted && (
                <Button
                  size="sm"
                  variant="outline"
                  disabled={busy}
                  onClick={() => unsubmit.mutate(violationsNote(rejected.violations, rejected.total, changeset.objects))}
                >
                  Unsubmit with these violations
                </Button>
              )}
            </div>
          </div>
        )}

        {changeset.objectCount === 0 ? (
          <EmptyState icon={FileStack} title="Nothing staged" description="Nothing is staged in this changeset." />
        ) : (
          <>
            <div className="space-y-2">
              {changeset.objects.map((object) => (
                <StagedObjectCard
                  key={object.id}
                  object={object}
                  type={typeLabel(object)}
                  frozen={submitted ? FROZEN_REASON : null}
                  busy={busy}
                  onRemove={() =>
                    objectActions.remove.mutate(object.id, {
                      onSuccess: () => {
                        changed()
                        // The last object of a trailing page: back one page.
                        if (offset > 0 && changeset.objects.length === 1) setOffset(offset - OBJECTS_PAGE_SIZE)
                      },
                    })
                  }
                  onCut={(property) =>
                    objectActions.cut.mutate({ objectId: object.id, property }, { onSuccess: changed })
                  }
                  onAcceptCurrent={(property) =>
                    objectActions.acceptCurrent.mutate({ objectId: object.id, property }, { onSuccess: changed })
                  }
                  onView={(property) => viewDocument(object, property)}
                >
                  {extendActions(object)}
                </StagedObjectCard>
              ))}
            </div>

            {changeset.objectCount > OBJECTS_PAGE_SIZE && (
              <div className="flex items-center justify-between">
                <span className="text-xs tabular-nums text-muted-foreground">
                  {offset + 1}–{Math.min(offset + OBJECTS_PAGE_SIZE, changeset.objectCount)} of{' '}
                  {changeset.objectCount}
                </span>
                <div className="flex items-center gap-2">
                  <Button
                    variant="outline"
                    size="icon"
                    className="size-7"
                    disabled={offset === 0}
                    onClick={() => setOffset((o) => Math.max(0, o - OBJECTS_PAGE_SIZE))}
                    aria-label="Previous page"
                  >
                    <ChevronLeft className="size-3.5" />
                  </Button>
                  <Button
                    variant="outline"
                    size="icon"
                    className="size-7"
                    disabled={offset + OBJECTS_PAGE_SIZE >= changeset.objectCount}
                    onClick={() => setOffset((o) => o + OBJECTS_PAGE_SIZE)}
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

      {editTarget !== null && (
        <EditStagedEntityDialog
          key={`${editTarget.changesetId}:${editTarget.id}`}
          ontologyKey={ontologyKey}
          lensKey={lensKey}
          target={editTarget}
          onClose={() => setEditTarget(null)}
        />
      )}

      <AlertDialog open={commitVersion !== null} onOpenChange={(open) => !open && setCommitVersion(null)}>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>Commit {objectsText(changeset.objectCount)} to the data?</AlertDialogTitle>
            <AlertDialogDescription>This cannot be undone.</AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel>Cancel</AlertDialogCancel>
            <Button disabled={commit.isPending} onClick={() => commit.mutate(commitVersion!)}>
              {commit.isPending ? <Loader2 className="size-3.5 animate-spin" /> : <Check className="size-3.5" />}
              Commit
            </Button>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>

      <AlertDialog open={discardOpen} onOpenChange={setDiscardOpen}>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>Discard this changeset?</AlertDialogTitle>
            <AlertDialogDescription>
              Its {objectsText(changeset.objectCount)} are dropped and nothing is persisted. This cannot be
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

      <AlertDialog open={submitOpen} onOpenChange={setSubmitOpen}>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>Submit this changeset for review?</AlertDialogTitle>
            <AlertDialogDescription>
              It is frozen until it is committed or unsubmitted: nothing can be staged, removed or cut. A note
              replaces the current one; left empty, the current one stays.
            </AlertDialogDescription>
          </AlertDialogHeader>
          <ChangesetNoteField label="Note (optional)" value={note} onChange={setNote} />
          <AlertDialogFooter>
            <AlertDialogCancel>Cancel</AlertDialogCancel>
            <Button disabled={submit.isPending} onClick={() => submit.mutate(note.trim())}>
              {submit.isPending ? <Loader2 className="size-3.5 animate-spin" /> : <Send className="size-3.5" />}
              Submit changeset
            </Button>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>

      <AlertDialog open={unsubmitOpen} onOpenChange={setUnsubmitOpen}>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>Unsubmit this changeset?</AlertDialogTitle>
            <AlertDialogDescription>
              It goes back to draft, so it can be changed again. The note replaces the current
              one: say what should change.
            </AlertDialogDescription>
          </AlertDialogHeader>
          <ChangesetNoteField label="Note (required)" value={note} onChange={setNote} />
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
