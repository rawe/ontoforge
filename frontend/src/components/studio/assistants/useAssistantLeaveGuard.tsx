import { useRef } from 'react'
import { useBlocker } from 'react-router-dom'
import {
  AlertDialog, AlertDialogAction, AlertDialogCancel, AlertDialogContent, AlertDialogDescription, AlertDialogFooter, AlertDialogHeader, AlertDialogTitle,
} from '@/components/ui/alert-dialog'

/**
 * Asks before an editor with unsaved changes is left by any navigation — other
 * tabs, the list, other pages. `leave(fn)` runs a navigation the editor itself
 * makes (after a save or delete) without asking; render `dialog` once.
 */
export function useAssistantLeaveGuard(dirty: boolean, title: string) {
  const leaving = useRef(false)
  const blocker = useBlocker(({ currentLocation, nextLocation }) =>
    dirty && !leaving.current && (currentLocation.pathname !== nextLocation.pathname || currentLocation.search !== nextLocation.search))
  const leave = (run: () => void) => { leaving.current = true; run() }
  const dialog = (
    <AlertDialog open={blocker.state === 'blocked'}>
      <AlertDialogContent>
        <AlertDialogHeader>
          <AlertDialogTitle>Discard unsaved changes?</AlertDialogTitle>
          <AlertDialogDescription>{title} has unsaved changes. Leaving discards them.</AlertDialogDescription>
        </AlertDialogHeader>
        <AlertDialogFooter>
          <AlertDialogCancel onClick={() => blocker.reset?.()}>Keep editing</AlertDialogCancel>
          <AlertDialogAction variant="destructive" onClick={() => blocker.proceed?.()}>Discard and leave</AlertDialogAction>
        </AlertDialogFooter>
      </AlertDialogContent>
    </AlertDialog>
  )
  return { leave, dialog }
}
