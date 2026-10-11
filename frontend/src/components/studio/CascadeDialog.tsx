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
import { affectedText } from './cascadeText'
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

/** The lenses and search indices a cascade updates. */
export function AffectedLists({ lenses, indices }: { lenses: string[]; indices: string[] }) {
  return (
    <>
      <AffectedList title="Lenses" keys={lenses} />
      <AffectedList title="Search indices" keys={indices} />
    </>
  )
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
          <AffectedLists lenses={cascade.affectedLenses} indices={cascade.affectedIndices} />
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
