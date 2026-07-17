import { Loader2 } from 'lucide-react'
import { useEffect, useState } from 'react'
import { cn } from '@/lib/utils'

/**
 * Pending indicator for slow AI calls (local models routinely take 10–60s):
 * spinner + live elapsed seconds so slowness never reads as a hang.
 */
export function ElapsedIndicator({
  label = 'Thinking',
  className,
}: {
  label?: string
  className?: string
}) {
  const [seconds, setSeconds] = useState(0)

  useEffect(() => {
    const timer = window.setInterval(() => setSeconds((s) => s + 1), 1000)
    return () => window.clearInterval(timer)
  }, [])

  return (
    <span
      className={cn(
        'inline-flex items-center gap-2 text-[13px] text-muted-foreground',
        className,
      )}
      role="status"
    >
      <Loader2 className="size-3.5 animate-spin" />
      {label}…
      <span className="font-mono text-xs tabular-nums">{seconds}s</span>
    </span>
  )
}
