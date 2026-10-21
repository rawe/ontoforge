import { useMutation, useQueryClient } from '@tanstack/react-query'
import { Loader2, Plus } from 'lucide-react'
import { useState } from 'react'
import { useNavigate } from 'react-router-dom'
import { toast } from 'sonner'
import { qk } from '@/api/queryKeys'
import * as runtime from '@/api/runtime'
import { ChangesetNoteField } from '@/components/changesets/ChangesetNoteField'
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
import { pinChangeset } from '@/lib/pinnedChangeset'

/** Starts a changeset with an optional note, pins it and opens its review. */
export function StartChangesetDialog({
  ontologyKey,
  lensKey,
  open,
  onOpenChange,
}: {
  ontologyKey: string
  lensKey: string
  open: boolean
  onOpenChange: (open: boolean) => void
}) {
  const navigate = useNavigate()
  const queryClient = useQueryClient()
  const [note, setNote] = useState('')

  const start = useMutation({
    mutationFn: (text: string) => runtime.startChangeset(ontologyKey, lensKey, text === '' ? undefined : text),
    onSuccess: (changeset) => {
      void queryClient.invalidateQueries({ queryKey: qk.changesets(ontologyKey, lensKey), exact: true })
      pinChangeset(ontologyKey, lensKey, changeset.id)
      toast.success('Changeset started: your writes stage into it')
      setNote('')
      onOpenChange(false)
      void navigate(`/o/${ontologyKey}/w/${lensKey}/changesets/${changeset.id}`)
    },
    onError: (err) => toast.error(err.message),
  })

  return (
    <AlertDialog
      open={open}
      onOpenChange={(next) => {
        if (!next) setNote('')
        onOpenChange(next)
      }}
    >
      <AlertDialogContent>
        <AlertDialogHeader>
          <AlertDialogTitle>Start a changeset?</AlertDialogTitle>
          <AlertDialogDescription>
            It is pinned at once: until you leave it, your writes in this lens are staged into it instead of
            written to the data.
          </AlertDialogDescription>
        </AlertDialogHeader>
        <ChangesetNoteField label="Note (optional)" value={note} onChange={setNote} />
        <AlertDialogFooter>
          <AlertDialogCancel>Cancel</AlertDialogCancel>
          <Button disabled={start.isPending} onClick={() => start.mutate(note.trim())}>
            {start.isPending ? <Loader2 className="size-3.5 animate-spin" /> : <Plus className="size-3.5" />}
            Start changeset
          </Button>
        </AlertDialogFooter>
      </AlertDialogContent>
    </AlertDialog>
  )
}
