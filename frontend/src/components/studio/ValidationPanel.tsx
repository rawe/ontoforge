import { CircleCheck, CircleX, TriangleAlert, X } from 'lucide-react'
import type { ValidationError, ValidationResult } from '@/api/types'
import { Button } from '@/components/ui/button'
import { cn } from '@/lib/utils'

interface ValidationPanelProps {
  result: ValidationResult
  /** Omitted: the panel cannot be dismissed (it follows live state). */
  onDismiss?: () => void
  className?: string
}

const plural = (n: number, word: string) => `${n} ${word}${n === 1 ? '' : 's'}`

function IssueList({ issues, className }: { issues: ValidationError[]; className?: string }) {
  return (
    <ul className={cn('space-y-1 pl-6', className)}>
      {issues.map((e, i) => (
        <li key={i} className="text-[13px]">
          <span className="font-mono text-xs text-muted-foreground">{e.path}</span>{' '}
          <span>{e.message}</span>
        </li>
      ))}
    </ul>
  )
}

/**
 * Inline results panel for schema / lens validation. Warnings (lens
 * validation) never make a result invalid; they are listed apart from the
 * errors.
 */
export function ValidationPanel({ result, onDismiss, className }: ValidationPanelProps) {
  const warnings = result.warnings ?? []
  const warned = result.valid && warnings.length > 0
  return (
    <div
      className={cn(
        'rounded-lg border p-3',
        !result.valid
          ? 'border-destructive/40 bg-destructive/5'
          : warned
            ? 'border-(--tc-amber-border) bg-(--tc-amber-bg)'
            : 'border-(--tc-emerald-border) bg-(--tc-emerald-bg)',
        className,
      )}
    >
      <div className="flex items-center gap-2">
        {!result.valid ? (
          <CircleX className="size-4 shrink-0 text-destructive" />
        ) : warned ? (
          <TriangleAlert className="size-4 shrink-0 text-(--tc-amber)" />
        ) : (
          <CircleCheck className="size-4 shrink-0 text-(--tc-emerald)" />
        )}
        <span className="text-[13px] font-medium">
          {!result.valid
            ? `Validation found ${plural(result.errors.length, 'issue')}${
                warnings.length > 0 ? ` and ${plural(warnings.length, 'warning')}` : ''
              }.`
            : warned
              ? `Validation passed with ${plural(warnings.length, 'warning')}.`
              : 'Validation passed — no issues found.'}
        </span>
        {onDismiss !== undefined && (
          <Button
            variant="ghost"
            size="icon-sm"
            className="ml-auto"
            onClick={onDismiss}
            aria-label="Dismiss validation results"
          >
            <X className="size-3.5" />
          </Button>
        )}
      </div>
      {!result.valid && <IssueList issues={result.errors} className="mt-2" />}
      {warnings.length > 0 && (
        <div className="mt-2">
          {!result.valid && (
            <p className="flex items-center gap-1.5 text-[12px] font-medium text-(--tc-amber)">
              <TriangleAlert className="size-3.5" /> Warnings
            </p>
          )}
          <IssueList issues={warnings} className="mt-1" />
        </div>
      )}
    </div>
  )
}
