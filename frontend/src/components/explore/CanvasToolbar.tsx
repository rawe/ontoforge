import {
  Eraser,
  Maximize,
  Network,
  Pin,
  Search,
  X,
} from 'lucide-react'
import { useState, type ReactNode } from 'react'
import {
  AlertDialog,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
} from '@/components/ui/alert-dialog'
import { Button } from '@/components/ui/button'
import { Tooltip, TooltipContent, TooltipTrigger } from '@/components/ui/tooltip'
import { getTypeColor } from '@/lib/typeColors'
import { cn } from '@/lib/utils'
import { WARN_NODES } from './workingSet'

export interface TypeFilterEntry {
  typeKey: string
  displayName: string
  count: number
  hidden: boolean
}

interface CanvasToolbarProps {
  nodeCount: number
  pinnedCount: number
  types: readonly TypeFilterEntry[]
  onSearch: () => void
  onFit: () => void
  onRelayout: () => void
  onClear: (mode: 'all' | 'unpinned') => void
  onToggleType: (typeKey: string) => void
}

/**
 * Top-left canvas overlay: search/add, fit view, explicit re-layout, clear
 * (unpinned/all, confirmed), a node-count badge (warn look above the soft
 * cap) and per-type show/hide filter chips.
 */
export function CanvasToolbar({
  nodeCount,
  pinnedCount,
  types,
  onSearch,
  onFit,
  onRelayout,
  onClear,
  onToggleType,
}: CanvasToolbarProps) {
  const [clearOpen, setClearOpen] = useState(false)
  const empty = nodeCount === 0

  const iconButton = (
    label: string,
    icon: ReactNode,
    onClick: () => void,
    disabled = false,
  ) => (
    <Tooltip>
      <TooltipTrigger asChild>
        <Button
          variant="ghost"
          size="icon-sm"
          aria-label={label}
          disabled={disabled}
          onClick={onClick}
        >
          {icon}
        </Button>
      </TooltipTrigger>
      <TooltipContent>{label}</TooltipContent>
    </Tooltip>
  )

  return (
    <div className="absolute top-3 left-3 z-10 flex max-w-[calc(100%-380px)] flex-col items-start gap-2">
      <div className="flex items-center gap-0.5 rounded-xl border bg-card/95 p-1 shadow-md backdrop-blur-sm">
        {iconButton('Search & add entities', <Search className="size-4" />, onSearch)}
        {iconButton('Fit view (F)', <Maximize className="size-4" />, onFit, empty)}
        {iconButton('Re-layout all', <Network className="size-4" />, onRelayout, empty)}
        {iconButton(
          'Clear canvas',
          <Eraser className="size-4" />,
          () => setClearOpen(true),
          empty,
        )}
        <span
          className={cn(
            'ml-1 rounded-md px-2 py-0.5 font-mono text-[11px]',
            nodeCount > WARN_NODES
              ? 'bg-(--tc-amber-bg) text-(--tc-amber)'
              : 'text-muted-foreground',
          )}
          title={
            nodeCount > WARN_NODES
              ? 'Large working set — consider clearing unpinned nodes'
              : undefined
          }
        >
          {nodeCount} {nodeCount === 1 ? 'node' : 'nodes'}
        </span>
      </div>

      {types.length > 1 && (
        <div className="flex flex-wrap items-center gap-1">
          {types.map((t) => {
            const color = getTypeColor(t.typeKey)
            return (
              <button
                key={t.typeKey}
                type="button"
                onClick={() => onToggleType(t.typeKey)}
                aria-pressed={!t.hidden}
                title={t.hidden ? `Show ${t.displayName} nodes` : `Hide ${t.displayName} nodes`}
                className={cn(
                  'inline-flex items-center gap-1.5 rounded-md border px-2 py-0.5 text-[11px] font-medium shadow-xs backdrop-blur-sm transition-opacity',
                  color.chip,
                  t.hidden && 'opacity-40',
                )}
              >
                <span
                  className={cn('size-1.5 rounded-full', color.dot)}
                  aria-hidden
                />
                {t.displayName}
                <span className="font-mono text-[10px] opacity-70">{t.count}</span>
              </button>
            )
          })}
        </div>
      )}

      <AlertDialog open={clearOpen} onOpenChange={setClearOpen}>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>Clear the canvas?</AlertDialogTitle>
            <AlertDialogDescription>
              This only removes nodes from the canvas — no data is deleted.
              {pinnedCount > 0 &&
                ` ${pinnedCount} pinned ${pinnedCount === 1 ? 'node survives' : 'nodes survive'} "Clear unpinned".`}
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel>Cancel</AlertDialogCancel>
            {pinnedCount > 0 && (
              <Button
                variant="outline"
                onClick={() => {
                  onClear('unpinned')
                  setClearOpen(false)
                }}
              >
                Clear unpinned
              </Button>
            )}
            <Button
              variant="destructive"
              onClick={() => {
                onClear('all')
                setClearOpen(false)
              }}
            >
              Clear all
            </Button>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </div>
  )
}

interface SelectionBarProps {
  count: number
  allPinned: boolean
  onPinAll: () => void
  onRemove: () => void
}

/** Floating bar for multi-selections: pin all / remove from canvas. */
export function SelectionBar({ count, allPinned, onPinAll, onRemove }: SelectionBarProps) {
  return (
    <div className="absolute bottom-4 left-1/2 z-10 flex -translate-x-1/2 items-center gap-2 rounded-xl border bg-card/95 py-1.5 pr-1.5 pl-3 shadow-lg backdrop-blur-sm">
      <span className="text-[12.5px] text-muted-foreground">
        <span className="font-medium text-foreground">{count}</span> selected
      </span>
      <Button variant="outline" size="xs" onClick={onPinAll}>
        <Pin className="size-3" /> {allPinned ? 'Unpin all' : 'Pin all'}
      </Button>
      <Button variant="outline" size="xs" onClick={onRemove}>
        <X className="size-3" /> Remove from canvas
      </Button>
    </div>
  )
}
