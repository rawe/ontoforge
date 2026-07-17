import { Trash2, X } from 'lucide-react'
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
import { Separator } from '@/components/ui/separator'

/**
 * Floating bar shown while rows are selected: count, Delete (behind an
 * AlertDialog confirm) and Clear. Deletion itself runs in the page (it owns
 * the sequential DELETE loop + progress toast).
 */
export function BulkActionBar({
  count,
  typeName,
  deleting,
  onDelete,
  onClear,
}: {
  count: number
  typeName: string
  deleting: boolean
  onDelete: () => void
  onClear: () => void
}) {
  if (count === 0) return null
  return (
    <div className="pointer-events-none sticky bottom-5 z-20 mt-4 flex justify-center">
      <div className="pointer-events-auto flex items-center gap-2 rounded-lg border bg-popover py-1.5 pl-3 pr-1.5 shadow-lg">
        <span className="text-[13px] font-medium tabular-nums">
          {count} selected
        </span>
        <Separator orientation="vertical" className="h-4" />
        <AlertDialog>
          <AlertDialogTrigger asChild>
            <Button
              variant="ghost"
              size="sm"
              className="h-7 gap-1.5 text-[13px] text-destructive hover:text-destructive"
              disabled={deleting}
            >
              <Trash2 className="size-3.5" />
              {deleting ? 'Deleting…' : 'Delete'}
            </Button>
          </AlertDialogTrigger>
          <AlertDialogContent>
            <AlertDialogHeader>
              <AlertDialogTitle>
                Delete {count} {typeName}
                {count === 1 ? '' : 's'}?
              </AlertDialogTitle>
              <AlertDialogDescription>
                This permanently removes the selected {count === 1 ? 'entity' : 'entities'}{' '}
                and all relations attached to {count === 1 ? 'it' : 'them'}. This cannot be
                undone.
              </AlertDialogDescription>
            </AlertDialogHeader>
            <AlertDialogFooter>
              <AlertDialogCancel>Cancel</AlertDialogCancel>
              <AlertDialogAction
                onClick={onDelete}
                className="bg-destructive text-white hover:bg-destructive/90"
              >
                Delete
              </AlertDialogAction>
            </AlertDialogFooter>
          </AlertDialogContent>
        </AlertDialog>
        <Button
          variant="ghost"
          size="sm"
          className="h-7 gap-1.5 text-[13px] text-muted-foreground"
          onClick={onClear}
          disabled={deleting}
        >
          <X className="size-3.5" />
          Clear
        </Button>
      </div>
    </div>
  )
}
