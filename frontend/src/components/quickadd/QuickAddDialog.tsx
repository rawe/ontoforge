import { useMutation, useQueryClient } from '@tanstack/react-query'
import { ArrowLeft, Plus } from 'lucide-react'
import { useCallback, useEffect, useState } from 'react'
import { useNavigate } from 'react-router-dom'
import { toast } from 'sonner'
import { useRuntimeSchema } from '@/api/hooks'
import { ApiError } from '@/api/http'
import { qk } from '@/api/queryKeys'
import { createEntity } from '@/api/runtime'
import type { JsonValue } from '@/api/types'
import { TypeChip } from '@/components/TypeChip'
import { EntityForm } from '@/components/quickadd/EntityForm'
import { QUICK_ADD_EVENT, type QuickAddDetail } from '@/components/quickadd/quickAddBus'
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
import { displayLabel } from '@/lib/displayLabel'

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
 * step 2 is the schema-driven EntityForm.
 */
export function QuickAddDialog({ ontologyKey, lensKey }: { ontologyKey: string; lensKey: string }) {
  const navigate = useNavigate()
  const queryClient = useQueryClient()
  const schema = useRuntimeSchema(ontologyKey, lensKey)

  const [open, setOpen] = useState(false)
  const [typeKey, setTypeKey] = useState<string | undefined>(undefined)
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
    }: {
      forType: string
      values: Record<string, JsonValue>
    }) => createEntity(ontologyKey, lensKey, forType, values),
    onSuccess: (entity, { forType }) => {
      // Entity lists AND the per-type count queries share this key prefix.
      void queryClient.invalidateQueries({
        queryKey: qk.entities(ontologyKey, lensKey, forType),
      })
      toast.success(`Created ${displayLabel(entity)}`, {
        action: {
          label: 'View',
          onClick: () => navigate(`/o/${ontologyKey}/w/${lensKey}/e/${forType}/${entity._id}`),
        },
      })
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

  const serverErrors =
    create.error instanceof ApiError ? create.error.fieldErrors : undefined

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
              <EntityForm
                key={formEpoch}
                entityType={type}
                onSubmit={(values) => create.mutate({ forType: type.key, values })}
                submitting={create.isPending}
                serverErrors={serverErrors}
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
