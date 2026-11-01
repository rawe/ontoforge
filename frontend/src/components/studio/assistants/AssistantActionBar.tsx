import { Trash2 } from 'lucide-react'
import { useState, type ReactNode } from 'react'
import type { AssistantKind } from '@/api/types'
import { adapters } from '@/assistants'
import {
  AlertDialog, AlertDialogAction, AlertDialogCancel, AlertDialogContent, AlertDialogDescription, AlertDialogFooter, AlertDialogHeader, AlertDialogTitle,
} from '@/components/ui/alert-dialog'
import { Button } from '@/components/ui/button'

/**
 * The editor's row of actions — Create/Save (the form's submit), Discard
 * changes, the kind's extras, Delete behind a confirmation — and below it the
 * reasons the last save failed. Render it inside the editor's `<form>`.
 */
export function AssistantActionBar({ kind, isNew, dirty, canSave, busy, name, errors, failed = 'save', extras, onDiscard, onDelete }: {
  kind: AssistantKind
  isNew: boolean
  dirty: boolean
  /** Whether the submit is enabled: changed, valid and not busy. */
  canSave: boolean
  busy: boolean
  /** The saved name, for the delete confirmation. */
  name: string
  /** Why the last save or delete failed, one line each; empty when it did not. */
  errors: string[]
  /** Which of the two failed. */
  failed?: 'save' | 'delete'
  /** Kind actions before Delete (Retrievers: Save as copy). */
  extras?: ReactNode
  onDiscard: () => void
  onDelete: () => void
}) {
  const [confirmDelete, setConfirmDelete] = useState(false)
  const one = adapters[kind].nouns.one.toLowerCase()
  return (
    <>
      <div className="flex flex-wrap items-center gap-2">
        <Button type="submit" size="sm" data-testid="assistant-save" disabled={!canSave}>{isNew ? `Create ${one}` : 'Save'}</Button>
        {!isNew && <Button type="button" size="sm" variant="ghost" data-testid="assistant-discard" disabled={!dirty || busy} onClick={onDiscard}>Discard changes</Button>}
        {extras}
        {!isNew && (
          <Button type="button" size="sm" variant="ghost" className="ml-auto text-destructive" disabled={busy} onClick={() => setConfirmDelete(true)}>
            <Trash2 className="size-3.5" /> Delete
          </Button>
        )}
      </div>
      {errors.length > 0 && (
        <div role="alert" className="rounded-lg border border-destructive/40 bg-destructive/5 px-3 py-2 text-xs">
          <p className="font-medium text-destructive">{failed === 'delete' ? 'Not deleted:' : 'Not saved:'}</p>
          <ul className="mt-1 list-disc space-y-0.5 pl-4">{errors.map((line, i) => <li key={i} className="whitespace-pre-wrap break-words">{line}</li>)}</ul>
        </div>
      )}
      <AlertDialog open={confirmDelete} onOpenChange={setConfirmDelete}>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>Delete {one} "{name}"?</AlertDialogTitle>
            <AlertDialogDescription>It is removed from this lens. This cannot be undone.</AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel>Cancel</AlertDialogCancel>
            <AlertDialogAction variant="destructive" onClick={onDelete}>Delete {one}</AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </>
  )
}
