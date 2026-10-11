/**
 * Small shared pieces of the Studio Search area: status chip, kind and
 * representation badges, and the managed-index switch.
 */

import { LoaderCircle } from 'lucide-react'
import { toast } from 'sonner'
import type { useSwitchManagedIndex } from '@/api/searchIndexHooks'
import type {
  IndexKind,
  IndexStatus,
  SearchIndexDefinition,
  SearchIndexRecord,
} from '@/api/types'
import { Badge } from '@/components/ui/badge'
import { toastError } from '@/components/studio/lib'
import { Switch } from '@/components/ui/switch'
import { Tooltip, TooltipContent, TooltipTrigger } from '@/components/ui/tooltip'
import { cn } from '@/lib/utils'
import {
  representationLine,
  representations,
  statusChip,
  type StatusTone,
} from './searchIndexModel'

const TONE_CLASS: Record<StatusTone, string> = {
  ok: 'border-(--tc-emerald-border) bg-(--tc-emerald-bg) text-(--tc-emerald)',
  busy: 'border-(--tc-sky-border) bg-(--tc-sky-bg) text-(--tc-sky)',
  warn: 'border-(--tc-amber-border) bg-(--tc-amber-bg) text-(--tc-amber)',
  error: 'border-destructive/40 bg-destructive/5 text-destructive',
  muted: 'border-border bg-muted/40 text-muted-foreground',
}

/** Index status chip (ready / building n/total / stale / failed / disabled / unavailable). */
export function StatusChip({ status, className }: { status: IndexStatus; className?: string }) {
  const { label, tone } = statusChip(status)
  return (
    <Tooltip>
      <TooltipTrigger asChild>
        <span
          className={cn(
            'inline-flex h-5 w-fit shrink-0 items-center gap-1 rounded-md border px-1.5 text-[11px] font-medium whitespace-nowrap',
            TONE_CLASS[tone],
            className,
          )}
        >
          {tone === 'busy' && <LoaderCircle className="size-3 animate-spin" />}
          {label}
        </span>
      </TooltipTrigger>
      <TooltipContent>
        {status.state === 'disabled' ? (
          'Switched off in search settings'
        ) : status.representations.length === 0 ? (
          'No representation built'
        ) : (
          <ul>
            {status.representations.map((r) => (
              <li key={r.representation}>
                {r.representation}: {representationLine(r)}
              </li>
            ))}
          </ul>
        )}
      </TooltipContent>
    </Tooltip>
  )
}

const KIND_LABEL: Record<IndexKind, string> = {
  default: 'default',
  passage: 'passages',
  custom: 'custom',
}

export function KindBadge({ kind }: { kind: IndexKind }) {
  return (
    <Badge
      variant={kind === 'custom' ? 'secondary' : 'outline'}
      className="text-[10.5px]"
      title={kind === 'custom' ? 'Custom index' : 'Managed index — derived from the schema'}
    >
      {KIND_LABEL[kind]}
    </Badge>
  )
}

export function RepresentationBadges({ definition }: { definition: SearchIndexDefinition }) {
  return (
    <span className="flex gap-1">
      {representations(definition).map((r) => (
        <Badge key={r} variant="outline" className="font-mono text-[10.5px] text-muted-foreground">
          {r}
        </Badge>
      ))}
    </span>
  )
}

/** On/off switch of one managed index; writes `disabledIndices`. */
export function ManagedSwitch({
  record,
  switcher,
}: {
  record: SearchIndexRecord
  switcher: ReturnType<typeof useSwitchManagedIndex>
}) {
  return (
    <Switch
      checked={record.enabled}
      disabled={!switcher.ready || switcher.pending}
      aria-label={`${record.enabled ? 'Switch off' : 'Switch on'} ${record.key}`}
      onCheckedChange={(on) => {
        switcher
          .switchIndex(record.key, on)
          .then(() => toast.success(`${record.definition.name} switched ${on ? 'on' : 'off'}`))
          .catch(toastError)
      }}
    />
  )
}
