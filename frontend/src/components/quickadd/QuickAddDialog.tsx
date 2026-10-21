import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import { ArrowLeft, Plus } from 'lucide-react'
import { useCallback, useEffect, useState } from 'react'
import { useNavigate } from 'react-router-dom'
import { toast } from 'sonner'
import { useDisplayLabel, useRuntimeSchema } from '@/api/hooks'
import { ApiError } from '@/api/http'
import { qk } from '@/api/queryKeys'
import { getPath } from '@/api/runtime'
import type { JsonValue, SchemaProperty } from '@/api/types'
import { useRuntimeWrites } from '@/api/writes'
import { TypeChip } from '@/components/TypeChip'
import { STAGED_ONLY_TEXT } from '@/components/changesets/changesets'
import { formatPath, splitParentErrors } from '@/components/entity/hierarchy'
import { invalidateNeighborhood } from '@/components/entity/useNeighborCounts'
import { EntityForm } from '@/components/quickadd/EntityForm'
import {
  QUICK_ADD_EVENT,
  type QuickAddDetail,
  type QuickAddParent,
} from '@/components/quickadd/quickAddBus'
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
import { Button } from '@/components/ui/button'
import { Checkbox } from '@/components/ui/checkbox'
import {
  Command,
  CommandEmpty,
  CommandInput,
  CommandItem,
  CommandList,
} from '@/components/ui/command'
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from '@/components/ui/dialog'
import { Label } from '@/components/ui/label'
import { pinnedChangeset } from '@/lib/pinnedChangeset'

const NO_PROPERTIES: readonly SchemaProperty[] = []

/** True when the keyboard event happens somewhere typing should win. */
function isEditableTarget(e: KeyboardEvent): boolean {
  const el = e.target
  return (
    el instanceof HTMLElement &&
    (el.closest('input, textarea, select, [contenteditable]') !== null ||
      el.isContentEditable)
  )
}

/**
 * Global Quick Add dialog, mounted once in WorkbenchLayout. Opens via the
 * `c` shortcut, `openQuickAdd()` (sidebar button, `?new=1` on type tables)
 * or palette action. Step 1 picks an entity type (skipped when pre-scoped),
 * step 2 is the schema-driven EntityForm. With a fixed parent ("+ Task under
 * P1") it shows an "Under" row and the parent relation's own properties, and
 * sends one create with `parentRelation`. A parent only a changeset creates
 * ("Add child…" on its review row) takes a child only while that changeset is
 * pinned: the child is staged there.
 */
export function QuickAddDialog({ ontologyKey, lensKey }: { ontologyKey: string; lensKey: string }) {
  const displayLabel = useDisplayLabel()
  const navigate = useNavigate()
  const queryClient = useQueryClient()
  const schema = useRuntimeSchema(ontologyKey, lensKey)
  const writes = useRuntimeWrites(ontologyKey, lensKey)

  const [open, setOpen] = useState(false)
  const [typeKey, setTypeKey] = useState<string | undefined>(undefined)
  const [parent, setParent] = useState<QuickAddParent | undefined>(undefined)
  /** Whether the type was pre-scoped (no back button to the picker). */
  const [preScoped, setPreScoped] = useState(false)
  const [createAnother, setCreateAnother] = useState(false)
  const [dirty, setDirty] = useState(false)
  const [confirmDiscard, setConfirmDiscard] = useState(false)
  /** Remount key — resets the form for "create & add another". */
  const [formEpoch, setFormEpoch] = useState(0)

  const create = useMutation({
    mutationFn: ({
      forType,
      values,
      under,
      relationValues,
    }: {
      forType: string
      values: Record<string, JsonValue>
      under: QuickAddParent | undefined
      relationValues: Record<string, JsonValue>
    }) => {
      if (under?.changesetId !== undefined && pinnedChangeset(ontologyKey, lensKey) !== under.changesetId) {
        throw new Error(STAGED_ONLY_TEXT)
      }
      return writes.createEntity(
        forType,
        values,
        under === undefined
          ? undefined
          : { type: under.relationTypeKey, parentId: under.id, properties: relationValues },
      )
    },
    onSuccess: (outcome, { forType, under }) => {
      if (outcome.kind === 'staged') {
        // Staged: nothing live to show or view.
        writes.toastStaged(outcome)
      } else {
        const entity = outcome.value
        // Entity lists AND the per-type count queries share this key prefix.
        void queryClient.invalidateQueries({
          queryKey: qk.entities(ontologyKey, lensKey, forType),
        })
        if (under !== undefined) {
          invalidateNeighborhood(queryClient, ontologyKey, lensKey, under.typeKey, under.id)
        }
        toast.success(`Created ${displayLabel(entity)}`, {
          action: {
            label: 'View',
            onClick: () => navigate(`/o/${ontologyKey}/w/${lensKey}/e/${forType}/${entity._id}`),
          },
        })
      }
      setDirty(false)
      if (createAnother) {
        setFormEpoch((n) => n + 1)
      } else {
        setOpen(false)
      }
    },
    onError: (error) => {
      if (!(error instanceof ApiError) || error.fieldErrors === undefined) {
        toast.error(error.message)
      }
    },
  })
  const resetMutation = create.reset

  const openWith = useCallback(
    (detail: QuickAddDetail) => {
      setTypeKey(detail.typeKey)
      setParent(detail.parent)
      setPreScoped(detail.typeKey !== undefined)
      setDirty(false)
      setFormEpoch((n) => n + 1)
      resetMutation()
      setOpen(true)
    },
    [resetMutation],
  )

  // openQuickAdd() events from anywhere.
  useEffect(() => {
    const onEvent = (e: Event) => {
      openWith((e as CustomEvent<QuickAddDetail>).detail ?? {})
    }
    window.addEventListener(QUICK_ADD_EVENT, onEvent)
    return () => window.removeEventListener(QUICK_ADD_EVENT, onEvent)
  }, [openWith])

  // Global `c` shortcut (same pattern as the palette's Cmd+K) — ignored while
  // typing or while any dialog/popover layer is open.
  useEffect(() => {
    const onKeyDown = (e: KeyboardEvent) => {
      if (e.key !== 'c' || e.metaKey || e.ctrlKey || e.altKey) return
      if (isEditableTarget(e)) return
      if (document.querySelector('[data-slot=dialog-content], [role=dialog]') !== null) {
        return
      }
      e.preventDefault()
      openWith({})
    }
    window.addEventListener('keydown', onKeyDown)
    return () => window.removeEventListener('keydown', onKeyDown)
  }, [openWith])

  const type = schema.data?.entityTypes.find((t) => t.key === typeKey)
  const parentRelation =
    parent === undefined
      ? undefined
      : schema.data?.relationTypes.find((rt) => rt.key === parent.relationTypeKey)

  const parentPath = useQuery({
    queryKey: qk.path(ontologyKey, lensKey, parent?.typeKey ?? '', parent?.id ?? ''),
    queryFn: () => getPath(ontologyKey, lensKey, parent!.typeKey, parent!.id),
    // A parent only a changeset creates has no stored path.
    enabled: open && parent !== undefined && parent.changesetId === undefined,
  })

  const fieldErrors = create.error instanceof ApiError ? create.error.fieldErrors : undefined
  const split =
    parent !== undefined && fieldErrors !== undefined ? splitParentErrors(fieldErrors) : undefined
  const serverErrors = split?.entity ?? fieldErrors

  const attemptClose = () => {
    if (type !== undefined && dirty && !create.isPending) {
      setConfirmDiscard(true)
      return
    }
    setOpen(false)
  }

  return (
    <>
      <Dialog
        open={open}
        onOpenChange={(next) => {
          if (!next) attemptClose()
          else setOpen(true)
        }}
      >
        <DialogContent
          className="sm:max-w-md"
          onEscapeKeyDown={(e) => {
            e.preventDefault()
            attemptClose()
          }}
          onInteractOutside={(e) => {
            e.preventDefault()
            attemptClose()
          }}
        >
          {type === undefined ? (
            <>
              <DialogHeader>
                <DialogTitle>New entity</DialogTitle>
                <DialogDescription>Pick the type to create.</DialogDescription>
              </DialogHeader>
              <Command className="rounded-lg border">
                <CommandInput placeholder="Filter types…" autoFocus />
                <CommandList className="max-h-64">
                  <CommandEmpty>No matching type.</CommandEmpty>
                  {(schema.data?.entityTypes ?? []).map((t) => (
                    <CommandItem
                      key={t.key}
                      value={`${t.key} ${t.displayName}`}
                      onSelect={() => {
                        setTypeKey(t.key)
                        setDirty(false)
                        setFormEpoch((n) => n + 1)
                        resetMutation()
                      }}
                      className="gap-2"
                    >
                      <TypeChip typeKey={t.key} displayName={t.displayName} size="sm" />
                      {t.description !== null && (
                        <span className="truncate text-xs text-muted-foreground">
                          {t.description}
                        </span>
                      )}
                    </CommandItem>
                  ))}
                </CommandList>
              </Command>
            </>
          ) : (
            <>
              <DialogHeader>
                <DialogTitle className="flex items-center gap-2">
                  {!preScoped && (
                    <Button
                      variant="ghost"
                      size="icon-sm"
                      className="-ml-1"
                      aria-label="Back to type picker"
                      onClick={() => {
                        setTypeKey(undefined)
                        setDirty(false)
                        resetMutation()
                      }}
                    >
                      <ArrowLeft className="size-4" />
                    </Button>
                  )}
                  New {type.displayName}
                  <TypeChip typeKey={type.key} displayName={type.key} size="sm" />
                </DialogTitle>
                <DialogDescription>
                  Required fields first — press Enter to create.
                </DialogDescription>
              </DialogHeader>
              {parent !== undefined && (
                <div className="flex items-center gap-3 rounded-md border border-(--tc-violet-border) bg-(--tc-violet-bg) px-3 py-2">
                  <div className="min-w-0 flex-1">
                    <p className="truncate text-[11px] text-(--tc-violet)">
                      Under
                      {parent.changesetId !== undefined && ' · new in the changeset'}
                      {parentPath.data !== undefined && ` · ${formatPath(parentPath.data)}`}
                    </p>
                    <p className="flex items-baseline gap-2">
                      <span className="truncate text-[13px] font-semibold">{parent.label}</span>
                      <span className="shrink-0 font-mono text-[11px] text-muted-foreground">
                        via {parent.relationTypeKey}
                      </span>
                    </p>
                  </div>
                  <span className="text-[11px] text-muted-foreground">fixed</span>
                </div>
              )}
              {split?.form != null && (
                <p className="text-[13px] text-destructive">{split.form}</p>
              )}
              <EntityForm
                key={formEpoch}
                entityType={type}
                onSubmit={(values, relationValues) =>
                  create.mutate({ forType: type.key, values, under: parent, relationValues })
                }
                submitting={create.isPending}
                serverErrors={serverErrors}
                relation={
                  parent === undefined
                    ? undefined
                    : {
                        relationTypeKey: parent.relationTypeKey,
                        properties: parentRelation?.properties ?? NO_PROPERTIES,
                        serverErrors: split?.relation,
                      }
                }
                onDirtyChange={setDirty}
                footer={
                  <DialogFooter className="mt-2 items-center sm:justify-between">
                    <Label className="flex cursor-pointer items-center gap-2 text-[13px] font-normal text-muted-foreground">
                      <Checkbox
                        checked={createAnother}
                        onCheckedChange={(c) => setCreateAnother(c === true)}
                      />
                      Create &amp; add another
                    </Label>
                    <Button type="submit" size="sm" disabled={create.isPending}>
                      <Plus className="size-3.5" />
                      {create.isPending ? 'Creating…' : 'Create'}
                    </Button>
                  </DialogFooter>
                }
              />
            </>
          )}
        </DialogContent>
      </Dialog>

      <AlertDialog open={confirmDiscard} onOpenChange={setConfirmDiscard}>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>Discard this entity?</AlertDialogTitle>
            <AlertDialogDescription>
              You have unsaved input — closing the dialog will discard it.
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel>Keep editing</AlertDialogCancel>
            <AlertDialogAction
              onClick={() => {
                setConfirmDiscard(false)
                setOpen(false)
              }}
            >
              Discard
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </>
  )
}
