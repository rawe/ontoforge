import type { ToolCall, ValidationError } from '@/api/types'
import { cn } from '@/lib/utils'
import { checkLine, checkOf } from '../../proposal/proposalModel'

const isRecord = (v: unknown): v is Record<string, unknown> => typeof v === 'object' && v !== null && !Array.isArray(v)
const isIssues = (v: unknown): v is ValidationError[] =>
  Array.isArray(v) && v.every((i) => isRecord(i) && typeof i.path === 'string' && typeof i.message === 'string')

/** The Studio helper's own views of its design reads; undefined leaves a result to the shared views. */
export function studioResult(call: ToolCall) {
  const result = call.result
  if (!isRecord(result)) return undefined
  const check = checkOf(result)
  if (check !== null) {
    const line = checkLine(check)
    return <p className={line.verdict === 'ok' ? 'text-(--tc-emerald)' : 'text-destructive'}>{line.text}</p>
  }
  if (typeof result.valid === 'boolean' && isIssues(result.errors)) {
    const warnings = isIssues(result.warnings) ? result.warnings : []
    return (
      <div className="space-y-1">
        <p className={result.valid ? 'text-(--tc-emerald)' : 'text-destructive'}>
          {result.valid ? 'Valid' : 'Invalid'}
          <span className="text-muted-foreground">
            {' '}· {result.errors.length} {result.errors.length === 1 ? 'error' : 'errors'}
            {' '}· {warnings.length} {warnings.length === 1 ? 'warning' : 'warnings'}
          </span>
        </p>
        {issueList(result.errors, 'text-destructive')}
        {issueList(warnings, 'text-(--tc-amber)')}
      </div>
    )
  }
  if (Array.isArray(result.entityTypes) && Array.isArray(result.relationTypes)) {
    const keys = (types: unknown[]) => types.flatMap((t) => (isRecord(t) && typeof t.key === 'string' ? [t.key] : []))
    return (
      <dl className="grid grid-cols-[auto_minmax(0,1fr)] gap-x-3 gap-y-1">
        <dt className="text-muted-foreground">Entity types</dt>
        <dd className="font-mono text-[11px] break-words">{keys(result.entityTypes).join(', ') || 'none'}</dd>
        <dt className="text-muted-foreground">Relation types</dt>
        <dd className="font-mono text-[11px] break-words">{keys(result.relationTypes).join(', ') || 'none'}</dd>
      </dl>
    )
  }
  return undefined
}

function issueList(issues: ValidationError[], tone: string) {
  if (issues.length === 0) return null
  return (
    <ul className="space-y-0.5">
      {issues.map((issue, i) => (
        <li key={i} className={cn('break-words', tone)}>
          <code className="text-[10.5px] text-muted-foreground">{issue.path}</code> {issue.message}
        </li>
      ))}
    </ul>
  )
}
