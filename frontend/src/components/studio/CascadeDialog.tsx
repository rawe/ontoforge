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
import type { CascadeState } from './useCascade'

interface CascadeDialogProps {
  cascade: CascadeState | null
  onClose: () => void
}

/** Confirm dialog for cascading schema changes across affected ontologies. */
export function CascadeDialog({ cascade, onClose }: CascadeDialogProps) {
  return (
    <AlertDialog open={cascade !== null} onOpenChange={(open) => !open && onClose()}>
      <AlertDialogContent>
        <AlertDialogHeader>
          <AlertDialogTitle>Cascade required</AlertDialogTitle>
          <AlertDialogDescription>
            {cascade?.message ?? ''} This change also updates the scope of the affected
            ontologies listed below.
          </AlertDialogDescription>
        </AlertDialogHeader>
        {cascade !== null && cascade.affectedOntologies.length > 0 && (
          <ul className="rounded-md border bg-muted/40 px-3 py-2 text-[13px]">
            {cascade.affectedOntologies.map((name) => (
              <li key={name} className="py-0.5 font-mono">
                {name}
              </li>
            ))}
          </ul>
        )}
        <AlertDialogFooter>
          <AlertDialogCancel>Cancel</AlertDialogCancel>
          <AlertDialogAction
            onClick={() => {
              cascade?.retry()
              onClose()
            }}
          >
            Apply with cascade
          </AlertDialogAction>
        </AlertDialogFooter>
      </AlertDialogContent>
    </AlertDialog>
  )
}
