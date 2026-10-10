import { useEffect, useRef, useState, type ReactNode } from 'react'
import { AlertTriangle, Check, ChevronRight, CircleSlash, LoaderCircle } from 'lucide-react'
import { Link } from 'react-router-dom'
import { useDisplayLabel, useRuntimeSchema } from '@/api/hooks'
import type { EntityInstance, QueryResult, SearchHit, ToolCall } from '@/api/types'
import { TypeChip } from '@/components/TypeChip'
import { ResultsTable } from '@/components/query/ResultsTable'
import { isEntityObject } from '@/components/query/resultUtils'
import { cn } from '@/lib/utils'
import { formatDuration, turnDuration, type Turn } from '../chat/chatModel'
import {
  callDuration,
  toolCallSummary,
  toolError,
  toolLabel,
  toolTime,
} from './toolCallModel'

interface ToolCallPanelProps {
  ontologyKey: string
  lensKey: string
  /** The assistant turn shown; undefined when no turn of this session made tool calls. */
  turn: Turn<ToolCall[]> | undefined
  /** The conversation has answers restored from an earlier session, which keep no tool calls. */
  hasRestoredTurns: boolean
}

/**
 * The tool calls of one assistant turn, in the order the agent made them:
 * what each asked for, how long it took and what it answered — readable
 * per tool, raw JSON one click away. Follows a running turn as calls arrive.
 */
export function ToolCallPanel({ ontologyKey, lensKey, turn, hasRestoredTurns }: ToolCallPanelProps) {
  const calls = turn?.insight ?? []
  const scroll = useRef<HTMLDivElement>(null)
  const running = turn?.status === 'pending'
  // Calls start collapsed; only the ones opened by hand show their details.
  const [opened, setOpened] = useState<Record<string, boolean>>({})
  // A running turn: keep its newest call in view.
  useEffect(() => {
    if (running && scroll.current !== null) scroll.current.scrollTop = scroll.current.scrollHeight
  }, [running, calls.length])

  if (turn === undefined) {
    return (
      <p className="p-4 text-xs text-muted-foreground">
        {hasRestoredTurns
          ? 'Tool calls are kept only while this chat is open — answers restored from earlier have none. Ask something to see its tool calls here.'
          : 'Ask something. Each tool call the agent makes appears here as it runs.'}
      </p>
    )
  }
  const time = toolTime(calls)
  const answered = turnDuration(turn)
  // Calls that overlapped: the tool time is less than their sum.
  const parallel =
    time !== undefined && calls.reduce((sum, c) => sum + (callDuration(c) ?? 0), 0) > time + 1
  const failed = calls.filter((c) => toolError(c) !== null).length
  return (
    <div className="flex min-h-0 flex-1 flex-col text-xs">
      <div className="space-y-0.5 border-b px-4 py-2.5">
        <p className="truncate text-muted-foreground" title={turn.question}>
          For: <span className="text-foreground">{turn.question}</span>
        </p>
        <p className="text-muted-foreground">
          {calls.length} {calls.length === 1 ? 'call' : 'calls'}
          {time !== undefined && (
            <span title="Time spent inside tools — parallel calls count once, the model's thinking not at all">
              {' '}· {formatDuration(time)} in tools{parallel && ', partly in parallel'}
            </span>
          )}
          {answered !== undefined && ` · answered after ${formatDuration(answered)}`}
          {failed > 0 && <span className="text-(--tc-amber)"> · {failed} answered with an error</span>}
          {running && ' · running'}
          {turn.status === 'failed' && <span className="text-destructive"> · turn failed or cancelled</span>}
        </p>
      </div>
      <div ref={scroll} className="min-h-0 flex-1 overflow-y-auto p-3">
        <ol className="space-y-2">
          {calls.map((call, i) => (
            <ToolCallCard
              key={call.callId}
              ontologyKey={ontologyKey}
              lensKey={lensKey}
              call={call}
              step={i + 1}
              open={opened[call.callId] ?? false}
              onToggle={(open) => setOpened((o) => ({ ...o, [call.callId]: open }))}
            />
          ))}
        </ol>
      </div>
    </div>
  )
}

function ToolCallCard({
  ontologyKey,
  lensKey,
  call,
  step,
  open,
  onToggle,
}: {
  ontologyKey: string
  lensKey: string
  call: ToolCall
  step: number
  open: boolean
  onToggle: (open: boolean) => void
}) {
  const summary = toolCallSummary(call)
  const error = toolError(call)
  const duration = callDuration(call)
  return (
    <li className={cn('rounded-lg border bg-card', error !== null && 'border-(--tc-amber-border)')}>
      <button
        type="button"
        aria-expanded={open}
        onClick={() => onToggle(!open)}
        className="flex w-full items-start gap-2 px-2.5 py-2 text-left transition-colors hover:bg-muted/40"
      >
        <span className="mt-px flex size-4 shrink-0 items-center justify-center rounded-full border text-[10px] text-muted-foreground tabular-nums">
          {step}
        </span>
        <span className="min-w-0 flex-1">
          <span className="flex items-center gap-1.5">
            <span className="font-medium text-foreground">{toolLabel(call.tool)}</span>
            <code className="text-[10.5px] text-muted-foreground">{call.tool}</code>
          </span>
          {summary !== undefined && (
            <span className="mt-0.5 block truncate font-mono text-[11px] text-muted-foreground" title={summary}>
              {summary}
            </span>
          )}
        </span>
        <span className="flex shrink-0 items-center gap-1 text-[11px] text-muted-foreground tabular-nums">
          {duration !== undefined && formatDuration(duration)}
          <StatusIcon call={call} error={error} />
          <ChevronRight className={cn('size-3.5 transition-transform', open && 'rotate-90')} />
        </span>
      </button>
      {open && (
        <div className="space-y-2.5 border-t px-2.5 py-2.5">
          <Arguments args={call.args} />
          {call.status === 'pending' && (
            <p className="flex items-center gap-1.5 text-muted-foreground">
              <LoaderCircle className="size-3.5 animate-spin" /> Waiting for the result…
            </p>
          )}
          {call.status === 'interrupted' && (
            <p className="text-muted-foreground">Interrupted before a result arrived.</p>
          )}
          {call.status === 'completed' &&
            (error !== null ? (
              <p className="flex gap-1.5 rounded-md border border-(--tc-amber-border) bg-(--tc-amber-bg) px-2 py-1.5">
                <AlertTriangle className="mt-0.5 size-3.5 shrink-0 text-(--tc-amber)" />
                <span>{error}</span>
              </p>
            ) : (
              <Section title="Result">
                <ToolResult ontologyKey={ontologyKey} lensKey={lensKey} call={call} />
              </Section>
            ))}
          {call.status === 'completed' && <RawJson value={call.result} />}
        </div>
      )}
    </li>
  )
}

function StatusIcon({ call, error }: { call: ToolCall; error: string | null }) {
  if (call.status === 'pending') return <LoaderCircle className="size-3.5 animate-spin" aria-label="Running" />
  if (call.status === 'interrupted') return <CircleSlash className="size-3.5" aria-label="Interrupted" />
  if (error !== null) return <AlertTriangle className="size-3.5 text-(--tc-amber)" aria-label="Answered with an error" />
  return <Check className="size-3.5 text-(--tc-emerald)" aria-label="Done" />
}

function Section({ title, children }: { title: string; children: ReactNode }) {
  return (
    <div className="space-y-1">
      <div className="text-[10px] font-semibold tracking-wider text-muted-foreground uppercase">{title}</div>
      {children}
    </div>
  )
}

/** The arguments as key–value lines; long text (a query) on its own block. */
function Arguments({ args }: { args: Record<string, unknown> }) {
  const entries = Object.entries(args).filter(([, v]) => v !== null && v !== undefined && v !== '')
  if (entries.length === 0) return <Section title="Arguments"><p className="text-muted-foreground">None</p></Section>
  return (
    <Section title="Arguments">
      <dl className="grid grid-cols-[auto_minmax(0,1fr)] gap-x-3 gap-y-1">
        {entries.map(([key, value]) => (
          <div key={key} className="contents">
            <dt className="font-mono text-[11px] text-muted-foreground">{key}</dt>
            <dd className="min-w-0">
              {typeof value === 'string' && (value.includes('\n') || value.length > 60) ? (
                <pre className="overflow-x-auto rounded border bg-muted/30 p-1.5 font-mono text-[11px] whitespace-pre-wrap">{value}</pre>
              ) : (
                <span className="font-mono text-[11px] break-words">
                  {typeof value === 'string' ? value : JSON.stringify(value)}
                </span>
              )}
            </dd>
          </div>
        ))}
      </dl>
    </Section>
  )
}

function RawJson({ value }: { value: unknown }) {
  const json = typeof value === 'string' ? value : JSON.stringify(value, null, 2)
  return (
    <details className="rounded border">
      <summary className="cursor-pointer px-2 py-1 text-[11px] text-muted-foreground">
        Raw result · {json.length.toLocaleString()} characters
      </summary>
      <pre className="max-h-72 overflow-auto border-t p-2 font-mono text-[11px] whitespace-pre-wrap break-words">{json}</pre>
    </details>
  )
}

/* ------------------------------ result views ------------------------------ */

const isRecord = (v: unknown): v is Record<string, unknown> => typeof v === 'object' && v !== null && !Array.isArray(v)
const isQueryResult = (v: unknown): v is QueryResult =>
  isRecord(v) && Array.isArray(v.columns) && Array.isArray(v.results)
const isHits = (v: unknown): v is { hits: SearchHit[] } => isRecord(v) && Array.isArray(v.hits)
const isItems = (v: unknown): v is { items: unknown[]; total?: number } => isRecord(v) && Array.isArray(v.items)

/** A readable view of a result, per its shape; falls back to text or a note. */
function ToolResult({ ontologyKey, lensKey, call }: { ontologyKey: string; lensKey: string; call: ToolCall }) {
  const result = call.result
  const link = { ontologyKey, lensKey }
  if (typeof result === 'string') {
    return <pre className="max-h-72 overflow-auto rounded border bg-muted/30 p-2 font-mono text-[11px] whitespace-pre-wrap">{result}</pre>
  }
  if (isQueryResult(result)) {
    return (
      <div className="space-y-1">
        <p className="text-muted-foreground">{result.results.length} {result.results.length === 1 ? 'row' : 'rows'}</p>
        {result.results.length > 0 && <ResultsTable ontologyKey={ontologyKey} lensKey={lensKey} result={result} />}
      </div>
    )
  }
  if (isHits(result)) {
    return (
      <div className="space-y-1">
        <p className="text-muted-foreground">{result.hits.length} {result.hits.length === 1 ? 'hit' : 'hits'}</p>
        <ul className="space-y-1">
          {result.hits.map((hit) => (
            <li key={hit.entity._id} className="space-y-0.5">
              <div className="flex items-center gap-2">
                <EntityLink {...link} entity={hit.entity} />
                <ScoreBar value={hit.relativeScore} />
              </div>
              {hit.matched?.snippet && (
                <p className="line-clamp-2 pl-1 text-[11px] text-muted-foreground" title={hit.matched.snippet}>
                  {hit.matched.snippet}
                </p>
              )}
            </li>
          ))}
        </ul>
      </div>
    )
  }
  if (isItems(result)) {
    const entities = result.items.filter(isEntityObject)
    return (
      <div className="space-y-1">
        <p className="text-muted-foreground">
          {result.items.length}
          {typeof result.total === 'number' && result.total !== result.items.length && ` of ${result.total}`}{' '}
          {result.items.length === 1 ? 'item' : 'items'}
        </p>
        {entities.length > 0 ? (
          <ul className="space-y-1">{entities.map((e) => <li key={e._id}><EntityLink {...link} entity={e} /></li>)}</ul>
        ) : (
          result.items.length > 0 && <p className="text-muted-foreground">See the raw result.</p>
        )}
      </div>
    )
  }
  if (isRecord(result) && isEntityObject(result.entity) && Array.isArray(result.neighbors)) {
    const neighbors = result.neighbors as { relation: { _relationTypeKey: string; direction: string }; entity: EntityInstance }[]
    return (
      <div className="space-y-1">
        <EntityLink {...link} entity={result.entity} />
        <p className="text-muted-foreground">{neighbors.length} {neighbors.length === 1 ? 'neighbour' : 'neighbours'}</p>
        <ul className="space-y-1">
          {neighbors.map((n, i) => (
            <li key={i} className="flex items-center gap-1.5">
              <span className="shrink-0 font-mono text-[10.5px] text-muted-foreground">
                {n.relation.direction === 'incoming' ? '←' : '→'} {n.relation._relationTypeKey}
              </span>
              <EntityLink {...link} entity={n.entity} />
            </li>
          ))}
        </ul>
      </div>
    )
  }
  if (isEntityObject(result)) {
    const props = Object.entries(result).filter(([k]) => !k.startsWith('_'))
    return (
      <div className="space-y-1.5">
        <EntityLink {...link} entity={result} />
        <dl className="grid grid-cols-[auto_minmax(0,1fr)] gap-x-3 gap-y-0.5">
          {props.map(([k, v]) => (
            <div key={k} className="contents">
              <dt className="text-muted-foreground">{k}</dt>
              <dd className="truncate" title={typeof v === 'string' ? v : JSON.stringify(v)}>
                {typeof v === 'string' ? v : JSON.stringify(v)}
              </dd>
            </div>
          ))}
        </dl>
      </div>
    )
  }
  if (isRecord(result) && typeof result.content === 'string') {
    const { offset, length, totalLength } = result as { offset?: number; length?: number; totalLength?: number }
    return (
      <div className="space-y-1">
        {typeof totalLength === 'number' && (
          <p className="text-muted-foreground">
            Characters {offset ?? 0}–{(offset ?? 0) + (length ?? 0)} of {totalLength.toLocaleString()}
          </p>
        )}
        <pre className="max-h-72 overflow-auto rounded border bg-muted/30 p-2 text-[11.5px] whitespace-pre-wrap">{result.content}</pre>
      </div>
    )
  }
  if (Array.isArray(result) && result.every((r) => isRecord(r) && typeof r.key === 'string')) {
    const rows = result as { key: string; name?: string; description?: string | null }[]
    return (
      <ul className="space-y-1">
        {rows.map((r) => (
          <li key={r.key}>
            <span className="font-medium">{r.name ?? r.key}</span> <code className="text-[10.5px] text-muted-foreground">{r.key}</code>
            {r.description && <p className="line-clamp-2 text-[11px] text-muted-foreground">{r.description}</p>}
          </li>
        ))}
      </ul>
    )
  }
  return <p className="text-muted-foreground">See the raw result.</p>
}

function EntityLink({ ontologyKey, lensKey, entity }: { ontologyKey: string; lensKey: string; entity: EntityInstance }) {
  const displayLabel = useDisplayLabel()
  const type = useRuntimeSchema(ontologyKey, lensKey).data?.entityTypes.find((t) => t.key === entity._entityTypeKey)
  return (
    <Link
      to={`/o/${ontologyKey}/w/${lensKey}/e/${entity._entityTypeKey}/${entity._id}`}
      className="inline-flex max-w-full min-w-0 items-center gap-1.5 hover:underline"
    >
      <TypeChip typeKey={entity._entityTypeKey} displayName={type?.displayName} size="sm" />
      <span className="truncate">{displayLabel(entity)}</span>
    </Link>
  )
}

/** The relative score (1.0 = best hit of this search) as a small bar. */
function ScoreBar({ value }: { value: number }) {
  return (
    <span className="ml-auto flex shrink-0 items-center gap-1" title={`Relative score ${value.toFixed(2)} — 1.00 is the best hit of this search`}>
      <span className="h-1.5 w-10 overflow-hidden rounded bg-muted">
        <span className="block h-full bg-primary/60" style={{ width: `${Math.max(4, Math.min(100, value * 100))}%` }} />
      </span>
      <span className="w-7 text-right text-[10.5px] text-muted-foreground tabular-nums">{value.toFixed(2)}</span>
    </span>
  )
}
