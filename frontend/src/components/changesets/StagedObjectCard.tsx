import { Check, FileText, Fingerprint, Scissors, X } from 'lucide-react'
import type { ReactNode } from 'react'
import type { StagedObjectView } from '@/api/types'
import {
  hasDrift,
  identityChangeText,
  objectOperation,
  operationLabel,
  stagedDocumentKeys,
  targetText,
  valueChangeText,
} from '@/components/changesets/changesets'
import { MarkerChip } from '@/components/changesets/MarkerChip'
import { Button } from '@/components/ui/button'
import { Tooltip, TooltipContent, TooltipTrigger } from '@/components/ui/tooltip'
import { cn } from '@/lib/utils'

/** Why remove, cut and accept current are off while submitted. */
export const FROZEN_REASON = 'Submitted changesets are frozen: unsubmit it first'

/** A disabled control with its reason on hover: a disabled button gets no pointer events. */
export function Disabled({ reason, children }: { reason: string; children: ReactNode }) {
  return (
    <Tooltip>
      <TooltipTrigger asChild>
        <span tabIndex={0}>{children}</span>
      </TooltipTrigger>
      <TooltipContent>{reason}</TooltipContent>
    </Tooltip>
  )
}

interface StagedObjectCardProps {
  object: StagedObjectView
  /** Beside the action: the type's chip or name. */
  type?: ReactNode
  /** Why remove, cut and accept current are off (a submitted changeset); null on a draft. */
  frozen: string | null
  /** Another change runs: the actions wait. */
  busy: boolean
  onRemove: () => void
  onCut: (property: string) => void
  onAcceptCurrent: (property: string) => void
  /** Opens a staged document's text; without it, no View. */
  onView?: (property: string) => void
  /** Below the values: what else the page offers on it. */
  children?: ReactNode
  className?: string
}

/**
 * One staged object: its action, what it is, its markers, the identity it
 * gets (before → after on a rename), and each staged
 * value — before → after on an update, with the current stored value where
 * it drifted. On a draft it can be removed, a value cut (scissors), and a
 * drifted value's current stored value accepted as its before.
 */
export function StagedObjectCard({
  object,
  type,
  frozen,
  busy,
  onRemove,
  onCut,
  onAcceptCurrent,
  onView,
  children,
  className,
}: StagedObjectCardProps) {
  const target = targetText(object)
  const identityChange = identityChangeText(object)
  const documents = onView === undefined ? [] : stagedDocumentKeys(object)
  const frozenOr = (control: ReactNode) => (frozen === null ? control : <Disabled reason={frozen}>{control}</Disabled>)
  const off = frozen !== null || busy

  return (
    <article
      aria-label={`${operationLabel(objectOperation(object))} ${target}`}
      className={cn(
        'rounded-lg border bg-card',
        (object.markers.length > 0 || object.values.some((value) => value.markers.length > 0)) &&
          'border-(--tc-amber-border)',
        className,
      )}
    >
      <header className="flex flex-wrap items-center gap-x-2 gap-y-1 px-3 py-2">
        <span className="text-[13px] font-semibold whitespace-nowrap">{operationLabel(objectOperation(object))}</span>
        {type}
        <span className="min-w-0 truncate text-[13px] font-medium">{target}</span>
        {object.markers.map((marker, i) => (
          <MarkerChip key={i} marker={marker} />
        ))}
        <span className="ml-auto">
          {frozenOr(
            <Button variant="outline" size="xs" aria-label={`Remove ${target}`} disabled={off} onClick={onRemove}>
              <X className="size-3" />
              Remove
            </Button>,
          )}
        </span>
      </header>
      {object.markers.map((marker, i) => (
        <p key={i} className="-mt-1 px-3 pb-1.5 text-[11.5px] text-muted-foreground">
          {marker.message}
        </p>
      ))}
      {identityChange !== null && (
        <p className="-mt-1 flex items-center gap-1.5 px-3 pb-1.5 text-[12px] text-muted-foreground">
          <Fingerprint className="size-3" aria-hidden />
          Identity <span className="font-mono text-foreground">{identityChange}</span>
        </p>
      )}
      {object.type === null && (
        <p className="px-3 pb-2 text-[12.5px] text-muted-foreground">Not visible through this lens</p>
      )}
      {object.values.length > 0 && (
        <ul className="divide-y border-t">
          {object.values.map((value) => (
            <li key={value.property} className="flex flex-wrap items-start gap-x-3 gap-y-1 px-3 py-1.5 text-[13px]">
              <span className="w-36 shrink-0 truncate font-mono text-[12px] text-muted-foreground" title={value.property}>
                {value.property}
              </span>
              <div className="min-w-0 flex-1 basis-48 break-words">
                {valueChangeText(object, value)}
                {value.markers.length > 0 && (
                  <div className="mt-1 flex flex-wrap gap-1">
                    {value.markers.map((marker, i) => (
                      <MarkerChip key={i} marker={marker} />
                    ))}
                  </div>
                )}
                {value.markers.map((marker, i) => (
                  <p key={i} className="mt-0.5 text-[11.5px] text-muted-foreground">
                    {marker.message}
                  </p>
                ))}
              </div>
              <div className="flex shrink-0 items-center gap-1">
                {documents.includes(value.property) && (
                  <Button
                    variant="outline"
                    size="xs"
                    aria-label={`View the staged ${value.property} of ${target}`}
                    onClick={() => onView!(value.property)}
                  >
                    <FileText className="size-3" />
                    View
                  </Button>
                )}
                {hasDrift(value) &&
                  frozenOr(
                    <Button
                      variant="outline"
                      size="xs"
                      title="Take the stored value now as the before; the staged value stays"
                      disabled={off}
                      onClick={() => onAcceptCurrent(value.property)}
                    >
                      <Check className="size-3" />
                      Accept current
                    </Button>,
                  )}
                {frozenOr(
                  <Button
                    variant="ghost"
                    size="icon-xs"
                    aria-label={`Cut ${value.property} from ${target}`}
                    title="Cut this value from the changeset"
                    disabled={off}
                    onClick={() => onCut(value.property)}
                  >
                    <Scissors />
                  </Button>,
                )}
              </div>
            </li>
          ))}
        </ul>
      )}
      {children !== undefined && children !== null && <div className="border-t px-3 py-2">{children}</div>}
    </article>
  )
}
