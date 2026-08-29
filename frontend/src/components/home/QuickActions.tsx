import { Sparkles, SquareTerminal, Waypoints } from 'lucide-react'
import { Link } from 'react-router-dom'
import { Button } from '@/components/ui/button'

/**
 * Quick actions row: Explorer, Query console, Ask AI (gated) and a passive
 * ⌘K search hint.
 */
export function QuickActions({
  lensKey,
  aiEnabled,
}: {
  lensKey: string
  aiEnabled: boolean
}) {
  return (
    <div className="flex flex-wrap items-center gap-2">
      <Button asChild variant="outline" size="sm" className="h-8 gap-1.5 text-[13px]">
        <Link to={`/w/${lensKey}/explore`}>
          <Waypoints className="size-3.5" />
          Open Explorer
        </Link>
      </Button>
      <Button asChild variant="outline" size="sm" className="h-8 gap-1.5 text-[13px]">
        <Link to={`/w/${lensKey}/query`}>
          <SquareTerminal className="size-3.5" />
          Query console
        </Link>
      </Button>
      {aiEnabled && (
        <Button asChild variant="outline" size="sm" className="h-8 gap-1.5 text-[13px]">
          <Link to={`/w/${lensKey}/ai`}>
            <Sparkles className="size-3.5" />
            Ask AI
          </Link>
        </Button>
      )}
      <span className="ml-auto hidden items-center gap-1.5 text-xs text-muted-foreground sm:flex">
        Search
        <kbd className="rounded-md border bg-muted/60 px-1.5 py-0.5 font-mono text-[11px]">
          ⌘K
        </kbd>
      </span>
    </div>
  )
}
