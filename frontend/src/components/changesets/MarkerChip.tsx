import type { ChangesetMarker } from '@/api/types'
import { markerLabel } from '@/components/changesets/changesets'
import { cn } from '@/lib/utils'

/** A staged object's or value's marker as a chip, its message on hover: drift in amber, the others in red. */
export function MarkerChip({ marker }: { marker: ChangesetMarker }) {
  return (
    <span
      title={marker.message}
      className={cn(
        'inline-flex items-center rounded-full border px-2 py-0.5 text-[11px] font-semibold',
        marker.kind === 'drift'
          ? 'border-(--tc-amber-border) bg-background text-(--tc-amber)'
          : 'border-destructive bg-background text-destructive',
      )}
    >
      {markerLabel(marker.kind)}
    </span>
  )
}
