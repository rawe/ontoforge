import { CircleCheck, CircleX, X } from 'lucide-react'
import type { ValidationResult } from '@/api/types'
import { Button } from '@/components/ui/button'
import { cn } from '@/lib/utils'

interface ValidationPanelProps {
  result: ValidationResult
  onDismiss: () => void
  className?: string
}

/** Inline results panel for schema / lens validation. */
export function ValidationPanel({ result, onDismiss, className }: ValidationPanelProps) {
  return (
    <div
      className={cn(
        'rounded-lg border p-3',
        result.valid
          ? 'border-(--tc-emerald-border) bg-(--tc-emerald-bg)'
          : 'border-destructive/40 bg-destructive/5',
        className,
      )}
    >
      <div className="flex items-center gap-2">
        {result.valid ? (
          <CircleCheck className="size-4 shrink-0 text-(--tc-emerald)" />
        ) : (
          <CircleX className="size-4 shrink-0 text-destructive" />
        )}
        <span className="text-[13px] font-medium">
          {result.valid
            ? 'Validation passed — no issues found.'
            : `Validation found ${result.errors.length} issue${result.errors.length === 1 ? '' : 's'}.`}
        </span>
        <Button
          variant="ghost"
          size="icon-sm"
          className="ml-auto"
          onClick={onDismiss}
          aria-label="Dismiss validation results"
        >
          <X className="size-3.5" />
        </Button>
      </div>
      {!result.valid && (
        <ul className="mt-2 space-y-1 pl-6">
          {result.errors.map((e, i) => (
            <li key={i} className="text-[13px]">
              <span className="font-mono text-xs text-muted-foreground">{e.path}</span>{' '}
              <span>{e.message}</span>
            </li>
          ))}
        </ul>
      )}
    </div>
  )
}
