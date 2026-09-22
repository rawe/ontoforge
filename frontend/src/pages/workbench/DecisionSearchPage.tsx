import {
  AlertCircle,
  ArrowDown,
  ArrowRight,
  Ban,
  Bookmark,
  ChevronRight,
  CircleCheck,
  CornerDownLeft,
  Database,
  Loader2,
  RotateCcw,
  Route,
  Shapes,
  Sparkles,
  Square,
  SquareTerminal,
  Waypoints,
  type LucideIcon,
} from 'lucide-react'
import { useEffect, useReducer, useRef, useState, type KeyboardEvent, type ReactNode } from 'react'
import { Link, useParams } from 'react-router-dom'
import { useFeatures, useRuntimeSchema } from '@/api/hooks'
import { aiDecide } from '@/api/runtime'
import type {
  DecideEntityRef,
  DecideEvent,
  DecidePath,
  DecideRows,
  DecideStage,
  JsonValue,
  RuntimeSchema,
} from '@/api/types'
import { EmptyState } from '@/components/EmptyState'
import { ElapsedIndicator } from '@/components/ai/ElapsedIndicator'
import { CopyButton, Markdown } from '@/components/ai/Markdown'
import { TypeChip } from '@/components/TypeChip'
import { Badge } from '@/components/ui/badge'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from '@/components/ui/table'
import { cn } from '@/lib/utils'

// Mirrors the server's thresholds (prototype — display only).
const KEEP_THRESHOLD = 0.5
const ENOUGH_THRESHOLD = 0.6

type Ev<T extends DecideEvent['type']> = Extract<DecideEvent, { type: T }>

interface Attempt {
  attempt: number
  query: string | null
  rows: DecideRows | null
}

type Pending =
  | { kind: 'deciding'; stage: DecideStage; hop: number; entityId: string | null }
  | { kind: 'reading'; hop: number; entityId: string }
  | { kind: 'writing_query' | 'running_query'; attempt: number }
  | { kind: 'writing_parameters' }

interface Run {
  question: string
  route: Ev<'route'> | null
  fallbacks: Ev<'fallback'>[]
  savedQuery: Ev<'saved_query'> | null
  parameters: Ev<'saved_query_parameters'> | null
  savedRows: DecideRows | null
  focus: Ev<'schema_focus'> | null
  attempts: Attempt[]
  hits: DecideEntityRef[] | null
  pick: Ev<'pick_hit'> | null
  steps: Ev<'step'>[]
  ready: Ev<'ready'> | null
  /** What the server is doing right now, between events. */
  pending: Pending | null
  answering: boolean
  answer: string
  done: boolean
  error: string | null
}

type Action = { type: 'start'; question: string } | { type: 'event'; event: DecideEvent } |
  { type: 'fail'; message: string }

function reduce(run: Run | null, action: Action): Run | null {
  if (action.type === 'start') {
    return {
      question: action.question, route: null, fallbacks: [], savedQuery: null, parameters: null,
      savedRows: null, focus: null, attempts: [], hits: null, pick: null, steps: [], ready: null,
      pending: null, answering: false, answer: '', done: false, error: null,
    }
  }
  if (run === null) return run
  if (action.type === 'fail') return { ...run, pending: null, done: true, error: action.message }
  const e = action.event
  switch (e.type) {
    case 'deciding':
      return {
        ...run,
        pending: { kind: 'deciding', stage: e.stage, hop: e.hop ?? 0, entityId: e.entityId ?? null },
      }
    case 'route': return { ...run, route: e, pending: null }
    case 'fallback': return { ...run, fallbacks: [...run.fallbacks, e] }
    case 'saved_query': return { ...run, savedQuery: e, pending: null }
    case 'writing_parameters': return { ...run, pending: { kind: 'writing_parameters' } }
    case 'saved_query_parameters': return { ...run, parameters: e, pending: null }
    case 'schema_focus': return { ...run, focus: e, pending: null }
    case 'writing_query':
      return {
        ...run,
        attempts: [...run.attempts, { attempt: e.attempt, query: null, rows: null }],
        pending: { kind: 'writing_query', attempt: e.attempt },
      }
    case 'oql':
      return {
        ...run,
        attempts: run.attempts.map((a) => (a.attempt === e.attempt ? { ...a, query: e.query } : a)),
        pending: { kind: 'running_query', attempt: e.attempt },
      }
    case 'rows': {
      const target = run.attempts.find((a) => a.attempt === e.attempt && a.query !== null && a.rows === null)
      return target
        ? { ...run, attempts: run.attempts.map((a) => (a === target ? { ...a, rows: e } : a)), pending: null }
        : { ...run, savedRows: e, pending: null }
    }
    case 'search': return { ...run, hits: e.hits }
    case 'reading':
      return { ...run, pending: { kind: 'reading', hop: run.steps.length + 1, entityId: e.entityId } }
    case 'pick_hit': return { ...run, pick: e, pending: null }
    case 'step': return { ...run, steps: [...run.steps, e], pending: null }
    case 'ready': return { ...run, ready: e, pending: null }
    case 'answering': return { ...run, answering: true, pending: null }
    case 'token': return { ...run, answer: run.answer + e.text }
    case 'final': return { ...run, answer: e.reply, done: true, pending: null }
    case 'error': return { ...run, pending: null, done: true, error: e.error.message }
  }
}

const PATHS: { key: DecidePath; name: string; hint: string; icon: LucideIcon }[] = [
  { key: 'walk', name: 'Walk', hint: 'one thing, read with its neighbours', icon: Waypoints },
  { key: 'query', name: 'Query', hint: 'count, list, filter or rank many', icon: Database },
  { key: 'saved_query', name: 'Saved query', hint: 'a stored, validated query fits', icon: Bookmark },
  { key: 'schema', name: 'Schema', hint: 'what kinds of things exist', icon: Shapes },
  { key: 'none', name: 'None', hint: 'off-topic or not in this lens', icon: Ban },
]
const pathName = (key: DecidePath) => PATHS.find((p) => p.key === key)?.name ?? key

function pct(p: number): string {
  return `${Math.round(p * 100)}%`
}

/** Small probability bar with an optional threshold tick. */
function Prob({ label, value, threshold, wide }: {
  label?: string
  value: number
  threshold?: number
  wide?: boolean
}) {
  const passes = threshold === undefined || value >= threshold
  return (
    <span className={cn('inline-flex items-center gap-1.5 text-[11px] text-muted-foreground', wide && 'flex-1')}>
      {label}
      <span className={cn('relative h-1.5 overflow-hidden rounded-full bg-muted', wide ? 'min-w-16 flex-1' : 'w-16')}>
        <span
          className={cn(
            'absolute inset-y-0 left-0 rounded-full transition-[width] duration-500',
            passes ? 'bg-(--tc-emerald)' : 'bg-muted-foreground/40',
          )}
          style={{ width: pct(value) }}
        />
        {threshold !== undefined && (
          <span
            className="absolute inset-y-0 w-px bg-foreground/50"
            style={{ left: pct(threshold) }}
            aria-hidden
          />
        )}
      </span>
      <span className="w-8 text-right font-mono tabular-nums text-foreground">{pct(value)}</span>
    </span>
  )
}

function Ms({ ms }: { ms: number }) {
  return <span className="shrink-0 font-mono text-[10px] text-muted-foreground tabular-nums">{ms} ms</span>
}

function AmberBadge({ children }: { children: ReactNode }) {
  return (
    <Badge variant="outline" className="border-(--tc-amber-border) bg-(--tc-amber-bg) text-(--tc-amber)">
      {children}
    </Badge>
  )
}

function EntityLabel({ ontologyKey, lensKey, entity, schema, className }: {
  ontologyKey: string
  lensKey: string
  entity: DecideEntityRef
  schema?: RuntimeSchema
  className?: string
}) {
  const type = schema?.entityTypes.find((t) => t.key === entity.entityTypeKey)
  return (
    <span className={cn('flex min-w-0 items-center gap-2', className)}>
      <TypeChip typeKey={entity.entityTypeKey} displayName={type?.displayName} size="sm" />
      <Link
        to={`/o/${ontologyKey}/w/${lensKey}/e/${entity.entityTypeKey}/${entity.id}`}
        className="truncate text-[13px] hover:underline"
        title={entity.label}
      >
        {entity.label}
      </Link>
    </span>
  )
}

function SectionTitle({ children }: { children: ReactNode }) {
  return (
    <p className="text-[10.5px] font-semibold uppercase tracking-wider text-muted-foreground">
      {children}
    </p>
  )
}

/** Section header: title, then a wrapping row of facts (margin, ms, badges). */
function SectionHead({ title, children }: { title: string; children?: ReactNode }) {
  return (
    <div className="flex flex-wrap items-center gap-x-2 gap-y-1">
      <SectionTitle>{title}</SectionTitle>
      {children}
    </div>
  )
}

function Fact({ children }: { children: ReactNode }) {
  return <span className="text-[11px] text-muted-foreground">{children}</span>
}

function Pending({ label }: { label: string }) {
  return (
    <span className="inline-flex items-center gap-1.5 text-xs text-muted-foreground">
      <Loader2 className="size-3 animate-spin" />
      {label}
    </span>
  )
}

const isDeciding = (run: Run, stage: DecideStage) =>
  run.pending?.kind === 'deciding' && run.pending.stage === stage

/* ------------------------------------------------------------------ route */

/** The five handling paths with their probabilities; the taken one highlighted. */
function RouteSection({ run }: { run: Run }) {
  const route = run.route
  if (route === null) {
    return isDeciding(run, 'route')
      ? (
          <section className="space-y-2">
            <SectionHead title="Route" />
            <Pending label="Choosing a path…" />
          </section>
        )
      : null
  }
  return (
    <section className="space-y-2">
      <SectionHead title="Route">
        <Fact>
          margin <span className="font-mono">{route.margin.toFixed(2)}</span>
          {' '}(needs {route.thresholds.margin.toFixed(2)})
        </Fact>
        <Ms ms={route.ms} />
        {!route.confident && <AmberBadge>not confident</AmberBadge>}
      </SectionHead>
      <ul className="divide-y overflow-hidden rounded-lg border bg-card">
        {PATHS.map(({ key, name, hint, icon: Icon }) => {
          const p = route.probabilities[key] ?? 0
          const taken = route.path === key
          const top = route.choice === key
          return (
            <li
              key={key}
              className={cn(
                'flex items-center gap-3 px-3 py-1.5',
                taken ? 'bg-primary/5 ring-1 ring-inset ring-primary/30' : 'opacity-75',
              )}
            >
              <Icon className={cn('size-3.5 shrink-0', taken ? 'text-primary' : 'text-muted-foreground')} />
              <span className="flex w-28 shrink-0 items-baseline gap-2 sm:w-72">
                <span className={cn('shrink-0 text-[13px]', taken && 'font-medium')}>{name}</span>
                <span className="hidden truncate text-[11px] text-muted-foreground sm:inline" title={hint}>{hint}</span>
              </span>
              <Prob value={p} wide />
              <span className="flex w-16 shrink-0 justify-end">
                {taken && !route.confident && <AmberBadge>fallback</AmberBadge>}
                {taken && route.confident && (
                  <Badge variant="outline" className="border-primary/30 text-primary">taken</Badge>
                )}
                {top && !taken && <Badge variant="outline" className="text-muted-foreground">top</Badge>}
              </span>
            </li>
          )
        })}
      </ul>
      <div className="flex flex-wrap items-center gap-x-3 gap-y-1 pl-1 text-[11px] text-muted-foreground">
        <Prob label="many items?" value={route.helpers.many} threshold={route.thresholds.many} />
        {!route.confident && (
          <span>
            Nothing clearly ahead — {route.helpers.many >= route.thresholds.many ? 'many' : 'one'} item
            {route.helpers.many >= route.thresholds.many ? 's' : ''} asked for, so{' '}
            <span className="font-medium text-foreground">{pathName(route.path)}</span>
          </span>
        )}
      </div>
    </section>
  )
}

function FallbackNotice({ fallback }: { fallback: Ev<'fallback'> }) {
  return (
    <div className="flex flex-wrap items-center gap-2 rounded-lg border border-(--tc-amber-border) bg-(--tc-amber-bg) px-3 py-1.5 text-[12px]">
      <RotateCcw className="size-3.5 shrink-0 text-(--tc-amber)" />
      <span className="font-medium">{pathName(fallback.from)}</span>
      <ArrowRight className="size-3 text-muted-foreground" />
      <span className="font-medium">{pathName(fallback.to)}</span>
      <span className="text-muted-foreground">— {fallback.reason}</span>
    </div>
  )
}

/* ------------------------------------------------------------------ rows */

function cellText(value: JsonValue | undefined): string {
  if (value === undefined || value === null) return '—'
  if (Array.isArray(value)) return value.map((v) => (typeof v === 'object' ? JSON.stringify(v) : String(v))).join(', ')
  if (typeof value === 'object') return JSON.stringify(value)
  return String(value)
}

function RowsTable({ rows }: { rows: DecideRows }) {
  if (rows.error) {
    return (
      <div className="flex items-start gap-2 rounded-md border border-destructive/40 bg-destructive/5 px-3 py-2 text-xs">
        <AlertCircle className="mt-0.5 size-3.5 shrink-0 text-destructive" />
        <pre className="whitespace-pre-wrap break-words font-mono text-[11px] text-destructive">{rows.error}</pre>
      </div>
    )
  }
  return (
    <div className="space-y-1">
      <Fact>
        {rows.total} row{rows.total === 1 ? '' : 's'}
        {rows.total > rows.rows.length && ` · first ${rows.rows.length} shown`}
      </Fact>
      {rows.total > 0 && (
        <div className="max-h-72 overflow-auto rounded-md border">
          <Table className="text-xs">
            <TableHeader className="sticky top-0 bg-card">
              <TableRow className="hover:bg-transparent">
                {rows.columns.map((c) => (
                  <TableHead key={c} className="h-7 whitespace-nowrap font-mono text-[11px]">{c}</TableHead>
                ))}
              </TableRow>
            </TableHeader>
            <TableBody>
              {rows.rows.map((row, i) => (
                <TableRow key={i}>
                  {rows.columns.map((c) => (
                    <TableCell key={c} className="max-w-72 truncate py-1" title={cellText(row[c])}>
                      {cellText(row[c])}
                    </TableCell>
                  ))}
                </TableRow>
              ))}
            </TableBody>
          </Table>
        </div>
      )}
    </div>
  )
}

/* ------------------------------------------------------------ saved query */

function SavedQuerySection({ run }: { run: Run }) {
  const sq = run.savedQuery
  if (sq === null) {
    return isDeciding(run, 'saved_query')
      ? (
          <section className="space-y-2">
            <SectionHead title="Saved query" />
            <Pending label="Choosing a saved query…" />
          </section>
        )
      : null
  }
  const options = Object.entries(sq.options)
    .map(([key, name]) => ({ key, name, p: sq.probabilities[key] ?? 0 }))
    .sort((a, b) => b.p - a.p)
  return (
    <section className="space-y-2">
      <SectionHead title="Saved query">
        <Fact>threshold {pct(sq.threshold)}</Fact>
        <Ms ms={sq.ms} />
        {!sq.confident && <AmberBadge>below threshold</AmberBadge>}
      </SectionHead>
      <ul className="divide-y overflow-hidden rounded-lg border bg-card">
        {options.map((o) => {
          const chosen = o.key === sq.choice
          return (
            <li
              key={o.key}
              className={cn(
                'flex items-center gap-3 px-3 py-1.5',
                chosen && sq.confident ? 'bg-primary/5 ring-1 ring-inset ring-primary/30' : 'opacity-75',
              )}
            >
              <Bookmark className={cn('size-3.5 shrink-0', chosen ? 'text-primary' : 'text-muted-foreground')} />
              <span className="w-56 shrink-0 truncate">
                <span className={cn('text-[13px]', chosen && 'font-medium')}>{o.name}</span>
                <span className="ml-2 font-mono text-[11px] text-muted-foreground">{o.key}</span>
              </span>
              <Prob value={o.p} threshold={sq.threshold} wide />
            </li>
          )
        })}
      </ul>
      {run.pending?.kind === 'writing_parameters' && (
        <ElapsedIndicator label="Filling parameters from the question" className="text-xs" />
      )}
      {run.parameters && (
        <div className="flex flex-wrap items-center gap-1.5 text-[11px]">
          <span className="text-muted-foreground">parameters</span>
          {Object.entries(run.parameters.parameters).map(([name, value]) => (
            <span
              key={name}
              className={cn(
                'rounded-md border px-1.5 py-0.5 font-mono',
                value === null && 'border-(--tc-amber-border) bg-(--tc-amber-bg) text-(--tc-amber)',
              )}
            >
              {name} = {value === null ? 'missing' : JSON.stringify(value)}
            </span>
          ))}
        </div>
      )}
      {run.parameters && run.parameters.missing.length === 0 && run.savedRows === null && !run.done && (
        <Pending label="Running saved query…" />
      )}
      {run.savedRows && <RowsTable rows={run.savedRows} />}
    </section>
  )
}

/* ------------------------------------------------------------------ query */

function SchemaFocusSection({ run, schema }: { run: Run; schema?: RuntimeSchema }) {
  const focus = run.focus
  if (focus === null) {
    return isDeciding(run, 'schema_focus')
      ? (
          <section className="space-y-2">
            <SectionHead title="Schema focus" />
            <Pending label="Choosing the entity types involved…" />
          </section>
        )
      : null
  }
  return (
    <section className="space-y-2">
      <SectionHead title="Schema focus">
        <Fact>threshold {pct(focus.threshold)}</Fact>
        <Ms ms={focus.ms} />
        <Fact>· {focus.types.filter((t) => t.chosen).length} of {focus.types.length} types to the query writer</Fact>
      </SectionHead>
      <ul className="divide-y overflow-hidden rounded-lg border bg-card">
        {focus.types.map((t) => {
          const type = schema?.entityTypes.find((x) => x.key === t.key)
          return (
            <li
              key={t.key}
              className={cn(
                'flex items-center gap-3 px-3 py-1.5',
                t.chosen ? 'bg-primary/5' : 'opacity-60',
              )}
            >
              <span className="w-40 shrink-0">
                <TypeChip typeKey={t.key} displayName={type?.displayName} size="sm" />
              </span>
              <Prob value={t.p} threshold={focus.threshold} wide />
              <span className="flex w-24 shrink-0 justify-end">
                {t.chosen && !t.connecting && (
                  <Badge variant="outline" className="border-primary/30 text-primary">in focus</Badge>
                )}
                {t.connecting && <Badge variant="outline" className="text-muted-foreground">connecting</Badge>}
              </span>
            </li>
          )
        })}
      </ul>
    </section>
  )
}

function QueryAttempt({ attempt, run, ontologyKey, lensKey }: {
  attempt: Attempt
  run: Run
  ontologyKey: string
  lensKey: string
}) {
  const writing = run.pending?.kind === 'writing_query' && run.pending.attempt === attempt.attempt
  const running = run.pending?.kind === 'running_query' && run.pending.attempt === attempt.attempt
  const retry = attempt.attempt > 1
  return (
    <li className={cn('space-y-2 rounded-lg border bg-card px-3 py-2', retry && 'border-(--tc-amber-border)')}>
      <div className="flex items-center gap-2">
        <span className="flex size-5 shrink-0 items-center justify-center rounded-full border bg-background font-mono text-[10px]">
          {attempt.attempt}
        </span>
        <span className="text-[12px] font-medium">{retry ? 'Retry' : 'Query'}</span>
        {retry && <AmberBadge>retry</AmberBadge>}
        {attempt.rows?.error && <Badge variant="destructive">failed</Badge>}
        {attempt.rows && !attempt.rows.error && attempt.rows.total === 0 && <AmberBadge>no rows</AmberBadge>}
        {attempt.query !== null && (
          <span className="ml-auto flex items-center gap-0.5">
            <CopyButton text={attempt.query} />
            <Button asChild variant="ghost" size="sm" className="h-6 gap-1 px-1.5 text-xs text-muted-foreground">
              <Link to={`/o/${ontologyKey}/w/${lensKey}/query?query=${encodeURIComponent(attempt.query)}`}>
                <SquareTerminal className="size-3" />
                Open in console
              </Link>
            </Button>
          </span>
        )}
      </div>
      {writing && <ElapsedIndicator label="Language model writing the query" className="text-xs" />}
      {attempt.query !== null && (
        <pre className="overflow-x-auto rounded-md border bg-muted/40 p-2.5 font-mono text-xs leading-relaxed">
          {attempt.query}
        </pre>
      )}
      {running && <Pending label="Running query…" />}
      {attempt.rows && <RowsTable rows={attempt.rows} />}
    </li>
  )
}

/* ------------------------------------------------------------------- walk */

/** Search hits with the decision model's pick highlighted. */
function HitList({ run, ...ctx }: { run: Run; ontologyKey: string; lensKey: string; schema?: RuntimeSchema }) {
  const hits = run.hits ?? []
  const pick = run.pick
  return (
    <section className="space-y-2">
      <SectionHead title={`Search · ${hits.length} hits`}>
        {pick && (
          <>
            <Fact>
              picked {pick.choice} · {pct(pick.probabilities[pick.choice] ?? 0)} · margin{' '}
              <span className="font-mono">{pick.margin.toFixed(2)}</span>
            </Fact>
            <Ms ms={pick.ms} />
          </>
        )}
        {pick && !pick.confident && <AmberBadge>not confident</AmberBadge>}
        {!pick && isDeciding(run, 'pick') && <Pending label="Choosing a starting point…" />}
      </SectionHead>
      {hits.length > 0 && (
        <ol className="divide-y rounded-lg border bg-card">
          {hits.map((hit, i) => {
            const key = `h${i + 1}`
            const picked = pick?.choice === key
            const p = pick?.probabilities[key]
            return (
              <li
                key={hit.id + key}
                className={cn(
                  'flex items-center gap-2 px-3 py-1.5',
                  picked && 'bg-primary/5 ring-1 ring-inset ring-primary/30',
                  pick && !picked && 'opacity-70',
                )}
              >
                <span className="w-6 shrink-0 font-mono text-[11px] text-muted-foreground">{key}</span>
                <EntityLabel entity={hit} className="flex-1" {...ctx} />
                {p !== undefined && <Prob value={p} />}
              </li>
            )
          })}
        </ol>
      )}
    </section>
  )
}

/** The chosen next neighbour, with the runner-up options on expand. */
function NextChoice({ next, ...ctx }: {
  next: NonNullable<Ev<'step'>['next']>
  ontologyKey: string
  lensKey: string
  schema?: RuntimeSchema
}) {
  const [open, setOpen] = useState(false)
  const options = Object.entries(next.options)
    .map(([key, label]) => ({ key, label, p: next.probabilities[key] ?? 0 }))
    .sort((a, b) => b.p - a.p)
  return (
    <div className="space-y-1">
      <div className="flex items-center gap-2 text-xs text-muted-foreground">
        <span>next</span>
        <EntityLabel entity={next.entity} className="min-w-0" {...ctx} />
        <span className="font-mono tabular-nums text-foreground">
          {pct(next.probabilities[next.choice] ?? 0)}
        </span>
        {options.length > 1 && (
          <button
            type="button"
            onClick={() => setOpen((o) => !o)}
            className="ml-auto flex shrink-0 items-center gap-0.5 hover:text-foreground"
            aria-expanded={open}
          >
            <ChevronRight className={cn('size-3 transition-transform', open && 'rotate-90')} />
            {options.length} options
          </button>
        )}
      </div>
      {open && (
        <ul className="space-y-0.5 rounded-md border bg-muted/30 px-2 py-1.5">
          {options.map((o) => (
            <li key={o.key} className={cn('flex items-center gap-2 text-[11px]',
              o.key === next.choice ? 'font-medium text-foreground' : 'text-muted-foreground')}>
              <span className="w-6 shrink-0 font-mono">{o.key}</span>
              <span className="flex-1 truncate" title={o.label}>{o.label}</span>
              <Prob value={o.p} />
            </li>
          ))}
        </ul>
      )}
    </div>
  )
}

function Connector({ via, schema }: { via: NonNullable<Ev<'step'>['via']>; schema?: RuntimeSchema }) {
  const rel = schema?.relationTypes.find((r) => r.key === via.relationTypeKey)?.displayName ??
    via.relationTypeKey
  return (
    <div className="flex items-center gap-1.5 py-1 pl-2.5 text-[11px] text-muted-foreground">
      <ArrowDown className="size-3" />
      <span className="font-mono">
        {via.direction === 'outgoing' ? `—${rel}→` : `←${rel}—`}
      </span>
      <span>({via.direction})</span>
    </div>
  )
}

/** The walk: one node per hop, joined by the relation that led there. */
function Walk({ run, labels, ...ctx }: {
  run: Run
  labels: Map<string, DecideEntityRef>
  ontologyKey: string
  lensKey: string
  schema?: RuntimeSchema
}) {
  const pending = run.pending !== null &&
    (run.pending.kind === 'reading' || (run.pending.kind === 'deciding' && run.pending.stage === 'hop'))
    ? run.pending as { kind: 'reading' | 'deciding'; hop: number; entityId: string | null }
    : null
  const pendingRef = pending?.entityId ? labels.get(pending.entityId) : undefined
  const lastNext = run.steps.at(-1)?.next
  if (run.steps.length === 0 && pending === null) return null
  return (
    <section className="space-y-2">
      <SectionTitle>Walk</SectionTitle>
      <ol>
        {run.steps.map((step) => (
          <li key={step.hop}>
            {step.via && <Connector via={step.via} schema={ctx.schema} />}
            <div
              className={cn(
                'space-y-1.5 rounded-lg border px-3 py-2',
                step.kept
                  ? 'border-(--tc-emerald-border) bg-(--tc-emerald-bg)'
                  : 'border-dashed bg-card opacity-60',
              )}
            >
              <div className="flex items-center gap-2">
                <span className="flex size-5 shrink-0 items-center justify-center rounded-full border bg-background font-mono text-[10px]">
                  {step.hop}
                </span>
                <EntityLabel entity={step.entity} className="flex-1" {...ctx} />
                <Badge
                  variant="outline"
                  className={step.kept ? 'border-(--tc-emerald-border) text-(--tc-emerald)' : ''}
                >
                  {step.kept ? (step.start && step.keep < KEEP_THRESHOLD ? 'kept · start' : 'kept') : 'skipped'}
                </Badge>
                <Ms ms={step.ms} />
              </div>
              <div className="flex flex-wrap gap-x-4 gap-y-1 pl-7">
                <Prob label="keep" value={step.keep} threshold={KEEP_THRESHOLD} />
                <Prob label="enough" value={step.enough} threshold={ENOUGH_THRESHOLD} />
              </div>
              {step.next && (
                <div className="pl-7">
                  <NextChoice next={step.next} {...ctx} />
                </div>
              )}
            </div>
          </li>
        ))}
        {pending && (
          <li>
            {lastNext && (
              <div className="flex items-center gap-1.5 py-1 pl-2.5 text-[11px] text-muted-foreground">
                <ArrowDown className="size-3" />
              </div>
            )}
            <div className="flex items-center gap-2 rounded-lg border border-dashed px-3 py-2">
              <span className="flex size-5 shrink-0 items-center justify-center rounded-full border bg-background font-mono text-[10px]">
                {pending.hop}
              </span>
              {pendingRef
                ? <EntityLabel entity={pendingRef} className="flex-1" {...ctx} />
                : <span className="flex-1" />}
              <Pending label={pending.kind === 'reading' ? 'Reading…' : 'Deciding…'} />
            </div>
          </li>
        )}
      </ol>
    </section>
  )
}

function ReadySection({ ready, ...ctx }: {
  ready: Ev<'ready'>
  ontologyKey: string
  lensKey: string
  schema?: RuntimeSchema
}) {
  return (
    <section className="space-y-2">
      <div className="flex flex-wrap items-center gap-2 text-[13px]">
        <CircleCheck className="size-4 text-(--tc-emerald)" />
        <span className="font-medium">Ready</span>
        <span className="text-muted-foreground">{ready.reason} · {ready.visited} visited</span>
      </div>
      {ready.evidence.length > 0 && (
        <div className="space-y-1">
          <SectionTitle>Sent to the language model</SectionTitle>
          <ul className="space-y-1">
            {ready.evidence.map((e) => (
              <li key={e.id}><EntityLabel entity={e} {...ctx} /></li>
            ))}
          </ul>
        </div>
      )}
    </section>
  )
}

/* ------------------------------------------------------------------- page */

/** Which source the answer is written from, shown above the answer. */
function answerSource(run: Run): string {
  const path = run.fallbacks.at(-1)?.to ?? run.route?.path
  switch (path) {
    case 'none': return 'nothing read — the question is outside this lens'
    case 'schema': return 'from the lens description'
    case 'query': return 'from the query rows'
    case 'saved_query': return 'from the saved query rows'
    case 'walk': return 'from the kept evidence'
    default: return ''
  }
}

/**
 * `/o/:ontologyKey/w/:lensKey/decide` — prototype. A decision model routes the
 * question to a handling path (walk, query, saved query, schema, none) and
 * steers each step of it; the language model writes queries and the answer.
 * Every decision streams in as it happens, with its probabilities and time.
 */
export function DecisionSearchPage() {
  const { ontologyKey, lensKey } = useParams<{ ontologyKey: string; lensKey: string }>()
  const { data: features } = useFeatures()
  const schema = useRuntimeSchema(ontologyKey, lensKey)
  const [question, setQuestion] = useState('')
  const [run, dispatch] = useReducer(reduce, null)
  const controller = useRef<AbortController | null>(null)

  useEffect(() => () => controller.current?.abort(), [])

  if (ontologyKey === undefined || lensKey === undefined) return null
  const running = run !== null && !run.done

  const submit = async () => {
    const q = question.trim()
    if (q === '' || running) return
    controller.current?.abort()
    const current = new AbortController()
    controller.current = current
    dispatch({ type: 'start', question: q })
    setQuestion('')
    try {
      await aiDecide(ontologyKey, lensKey, q, (event) => dispatch({ type: 'event', event }), current.signal)
    } catch (error) {
      if (controller.current !== current) return
      dispatch({
        type: 'fail',
        message: current.signal.aborted ? 'Stopped' : error instanceof Error ? error.message : 'Decision search failed',
      })
    }
  }

  const stop = () => controller.current?.abort()

  const onKeyDown = (e: KeyboardEvent<HTMLInputElement>) => {
    if (e.key === 'Enter') {
      e.preventDefault()
      void submit()
    }
  }

  const labels = new Map<string, DecideEntityRef>()
  for (const hit of run?.hits ?? []) labels.set(hit.id, hit)
  for (const step of run?.steps ?? []) if (step.next) labels.set(step.next.entity.id, step.next.entity)
  const ctx = { ontologyKey, lensKey, schema: schema.data }

  return (
    <div className="flex h-full min-h-0 flex-col">
      <header className="flex items-center gap-2 border-b px-6 py-3">
        <h1 className="flex items-center gap-2 text-[15px] font-semibold tracking-tight">
          <Route className="size-4 text-muted-foreground" />
          Decision search
        </h1>
        <Badge variant="secondary">prototype</Badge>
      </header>

      {features?.ai === false ? (
        <EmptyState
          icon={Sparkles}
          title="AI is not enabled"
          description="This server has no AI provider configured. Decision search needs a language model and a decision model."
        />
      ) : (
        <div className="min-h-0 flex-1 overflow-y-auto">
          <div className="mx-auto w-full max-w-3xl space-y-5 px-4 py-4">
            <div className="flex items-center gap-2">
              <div className="relative flex-1">
                <Input
                  value={question}
                  onChange={(e) => setQuestion(e.target.value)}
                  onKeyDown={onKeyDown}
                  placeholder="Ask a question — watch the decision model route it and steer every step"
                  className="h-9 pr-8 text-[13px]"
                  disabled={running}
                  autoFocus
                />
                <CornerDownLeft className="pointer-events-none absolute right-2.5 top-1/2 size-3.5 -translate-y-1/2 text-muted-foreground/50" />
              </div>
              {running ? (
                <Button size="sm" variant="outline" className="h-9 gap-1.5" onClick={stop}>
                  <Square className="size-3" />
                  Stop
                </Button>
              ) : (
                <Button size="sm" className="h-9" onClick={() => void submit()} disabled={question.trim() === ''}>
                  Ask
                </Button>
              )}
            </div>

            {run === null && (
              <EmptyState
                icon={Route}
                title="Route, then decide every step"
                description="The decision model first picks a path — walk the graph, run a query, run a saved query, describe the schema, or decline — then steers it: which types a query needs, which saved query fits, which hit to start from and which neighbour to read. The language model writes the query and the answer."
                className="py-12"
              />
            )}

            {run !== null && (
              <>
                <p className="text-[13px] font-medium">{run.question}</p>

                <RouteSection run={run} />
                <SavedQuerySection run={run} />
                {run.fallbacks.map((f, i) => <FallbackNotice key={i} fallback={f} />)}

                <SchemaFocusSection run={run} schema={schema.data} />
                {run.attempts.length > 0 && (
                  <section className="space-y-2">
                    <SectionTitle>Generated query</SectionTitle>
                    <ol className="space-y-2">
                      {run.attempts.map((a) => (
                        <QueryAttempt key={a.attempt} attempt={a} run={run} ontologyKey={ontologyKey} lensKey={lensKey} />
                      ))}
                    </ol>
                  </section>
                )}

                {run.hits !== null && <HitList run={run} {...ctx} />}
                <Walk run={run} labels={labels} {...ctx} />
                {run.ready && <ReadySection ready={run.ready} {...ctx} />}

                {(run.answering || run.answer !== '') && (
                  <section className="space-y-2">
                    <SectionHead title="Answer">
                      <Fact>{answerSource(run)}</Fact>
                    </SectionHead>
                    <div className="rounded-lg border bg-card px-4 py-3">
                      {run.answer === ''
                        ? <ElapsedIndicator label="Generating answer" />
                        : <Markdown>{run.answer}</Markdown>}
                    </div>
                  </section>
                )}

                {run.error && (
                  <div className="flex items-start gap-2 rounded-lg border border-destructive/40 bg-destructive/5 px-3 py-2 text-[13px]">
                    <AlertCircle className="mt-0.5 size-3.5 shrink-0 text-destructive" />
                    <p className="text-destructive">{run.error}</p>
                  </div>
                )}
              </>
            )}
          </div>
        </div>
      )}
    </div>
  )
}
