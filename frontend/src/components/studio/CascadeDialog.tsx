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

function AffectedList({ title, keys }: { title: string; keys: string[] }) {
  if (keys.length === 0) return null
  return (
    <div className="grid gap-1">
      <h3 className="text-[12px] font-medium text-muted-foreground">{title}</h3>
      <ul className="rounded-md border bg-muted/40 px-3 py-2 text-[13px]">
        {keys.map((key) => (
          <li key={key} className="py-0.5 font-mono">
            {key}
          </li>
        ))}
      </ul>
    </div>
  )
}

/** Own wording, not the server message: the lists below carry the specifics. */
function affectedText({ affectedLenses, affectedIndices }: CascadeState): string {
  const parts = [
    ...(affectedLenses.length > 0 ? ['the scope of the lenses'] : []),
    ...(affectedIndices.length > 0
      ? ['the search indices (an index left with nothing to read is deleted)']
      : []),
  ]
  return parts.length === 0
    ? 'This change also updates objects that depend on it.'
    : `This change also updates ${parts.join(' and ')} listed below.`
}

/** Confirm dialog for cascading changes across affected lenses and search indices. */
export function CascadeDialog({ cascade, onClose }: CascadeDialogProps) {
  return (
    <AlertDialog open={cascade !== null} onOpenChange={(open) => !open && onClose()}>
      <AlertDialogContent>
        <AlertDialogHeader>
          <AlertDialogTitle>Cascade required</AlertDialogTitle>
          <AlertDialogDescription>
            {cascade !== null && affectedText(cascade)}
          </AlertDialogDescription>
        </AlertDialogHeader>
        {cascade !== null && (
          <>
            <AffectedList title="Lenses" keys={cascade.affectedLenses} />
            <AffectedList title="Search indices" keys={cascade.affectedIndices} />
          </>
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
