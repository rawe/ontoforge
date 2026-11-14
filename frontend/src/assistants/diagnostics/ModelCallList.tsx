import type { ReactNode } from 'react'
import { formatDuration, type TurnStatus } from '../conversation/chatModel'
import { modelCallTotals, usageParts, type ModelCall } from './diagnostics'

/**
 * An answer's model calls, the same for every kind: per call its number,
 * name, duration, the tokens the provider reported, its finish reason or
 * failure; then the total.
 */
export function ModelCallList<C extends ModelCall>({ calls, status, nameOf, detail }: {
  calls: readonly C[] | undefined
  status: TurnStatus
  /** A call's name as shown; its name as sent when omitted. */
  nameOf?: (name: string) => string
  /** What a kind shows under a call (the retriever's bounded texts). */
  detail?: (call: C) => ReactNode
}) {
  if (calls === undefined || calls.length === 0) {
    return <p className="text-xs text-muted-foreground">{status === 'pending' ? 'No model calls yet.' : 'No model calls reported for this answer.'}</p>
  }
  const totals = modelCallTotals(calls)
  return (
    <div className="space-y-2 text-xs">
      <ol className="space-y-2">
        {calls.map((call) => (
          <li key={call.index} className="space-y-2 rounded border p-2.5" data-testid="model-call">
            <div className="flex items-baseline justify-between gap-3">
              <span className="min-w-0 truncate font-medium">
                <span className="tabular-nums text-muted-foreground">#{call.index}</span>
                {call.name !== undefined && ` ${nameOf?.(call.name) ?? call.name}`}
              </span>
              <span className="shrink-0 tabular-nums text-muted-foreground">{formatDuration(call.durationMs)}</span>
            </div>
            <Facts parts={[...usageParts(call.usage), ...(call.finishReason !== undefined ? [`finish: ${call.finishReason}`] : [])]} failed={call.failed === true} />
            {detail?.(call)}
          </li>
        ))}
      </ol>
      <div className="flex items-baseline justify-between gap-3 border-t pt-2 font-medium" data-testid="model-call-total">
        <span>
          Total · {totals.calls} {totals.calls === 1 ? 'call' : 'calls'}
          {totals.failed > 0 && <span className="text-destructive"> · {totals.failed} failed</span>}
        </span>
        <span className="shrink-0 tabular-nums">{formatDuration(totals.durationMs)}</span>
      </div>
      <Facts parts={usageParts(totals.usage)} failed={false} />
    </div>
  )
}

function Facts({ parts, failed }: { parts: string[]; failed: boolean }) {
  if (parts.length === 0 && !failed) return null
  return (
    <p className="tabular-nums text-muted-foreground">
      {failed && <span className="font-medium text-destructive">Failed{parts.length > 0 && ' · '}</span>}
      {parts.join(' · ')}
    </p>
  )
}
