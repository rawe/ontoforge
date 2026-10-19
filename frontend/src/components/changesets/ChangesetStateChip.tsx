import type { ChangesetState } from '@/api/types'
import { stateLabel } from '@/components/changesets/changesets'
import { cn } from '@/lib/utils'

const STATE_CHIPS: Record<ChangesetState, string> = {
  submitted: 'border-transparent bg-(--tc-blue-bg) text-(--tc-blue)',
  draft: 'border-border bg-muted text-muted-foreground',
}

/** The state chip of a list row and of the detail's header. */
export function ChangesetStateChip({ state }: { state: ChangesetState }) {
  return (
    <span
      className={cn(
        'inline-flex items-center rounded-full border px-2 py-0.5 text-[11px] font-semibold',
        STATE_CHIPS[state],
      )}
    >
      {stateLabel(state)}
    </span>
  )
}
