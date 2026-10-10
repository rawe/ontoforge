/**
 * Inline, multi-line description of a type or property. The API can replace
 * a description but not clear it, so an emptied one is not sent: the stored
 * text shows again with a short hint.
 */

import { useEffect, useState } from 'react'
import { InlineText } from '../shared'

interface DescriptionTextProps {
  value: string | null
  /** Called with a changed, non-empty description. */
  onSave: (value: string) => void
  className?: string
  'aria-label'?: string
}

export function DescriptionText({
  value,
  onSave,
  className,
  'aria-label': ariaLabel = 'Description',
}: DescriptionTextProps) {
  const [hint, setHint] = useState(false)

  useEffect(() => {
    if (!hint) return
    const timer = setTimeout(() => setHint(false), 4000)
    return () => clearTimeout(timer)
  }, [hint])

  return (
    <div className="grid gap-0.5">
      <InlineText
        aria-label={ariaLabel}
        value={value ?? ''}
        placeholder="Add a description…"
        multiline
        onSave={(v) => {
          if (v === '') setHint(true)
          else {
            setHint(false)
            onSave(v)
          }
        }}
        className={className}
      />
      {hint && (
        <p role="status" className="text-[11px] text-muted-foreground">
          A description can't be removed, only changed
        </p>
      )}
    </div>
  )
}
