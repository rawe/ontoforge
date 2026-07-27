import { useEffect, useState } from 'react'
import { useMutation } from '@tanstack/react-query'
import { Link } from 'react-router-dom'
import {
  BookMarked,
  ChevronDown,
  Play,
  Search,
  SquarePen,
  Terminal,
} from 'lucide-react'
import { toast } from 'sonner'
import { useFeatures, useOntologies } from '@/api/hooks'
import * as runtime from '@/api/runtime'
import type { JsonValue, QueryResult, SavedQuery, SchemaRelationType } from '@/api/types'
import { EmptyState } from '@/components/EmptyState'
import { useDebouncedValue, useSavedQuerySearch } from '@/components/palette/usePaletteSearch'
import { coerceTypedValue } from '@/components/studio/lib'
import { TypedValueInput } from '@/components/studio/TypedValueInput'
import { Badge } from '@/components/ui/badge'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { Label } from '@/components/ui/label'
import { Skeleton } from '@/components/ui/skeleton'
import { cn } from '@/lib/utils'
import { QueryErrorBlock, ResultsPanel } from './ResultsPanel'
import { formatQueryError } from './resultUtils'

/* --------------------------------- run panel --------------------------------- */

function RunPanel({
  ontologyKey,
  query,
  relationTypes,
  autoRun,
}: {
  ontologyKey: string
  query: SavedQuery
  relationTypes: readonly SchemaRelationType[]
  /** Fire the run immediately on mount (palette `?run=` hand-off). */
  autoRun: boolean
}) {
  const [raw, setRaw] = useState<Record<string, string>>({})
  const [run, setRun] = useState<{ result: QueryResult; ms: number } | null>(null)
  const [error, setError] = useState<string | null>(null)

  const buildParams = () => {
    const params: Record<string, JsonValue> = {}
    for (const p of query.parameters) {
      const value = coerceTypedValue(p.dataType, raw[p.name] ?? '')
      if (value !== null) params[p.name] = value
    }
    return params
  }

  const execute = useMutation({
    mutationFn: async () => {
      const started = performance.now()
      const result = await runtime.runSavedQuery(ontologyKey, query.key, buildParams())
      return { result, ms: Math.round(performance.now() - started) }
    },
    onSuccess: (data) => {
      setRun(data)
      setError(null)
    },
    onError: (err) => {
      setRun(null)
      setError(formatQueryError(err))
    },
  })

  // `mutate` is referentially stable — auto-run fires once per panel mount.
  const { mutate } = execute
  useEffect(() => {
    if (autoRun) mutate()
  }, [autoRun, mutate])

  const allParamsFilled = query.parameters.every((p) => (raw[p.name] ?? '').trim() !== '')

  const copyCurl = () => {
    const url = `${window.location.origin}/api/runtime/${ontologyKey}/saved-queries/${query.key}/run`
    const body = JSON.stringify({ params: buildParams() })
    const command = `curl -X POST '${url}' -H 'Content-Type: application/json' -d '${body.replaceAll("'", "'\\''")}'`
    navigator.clipboard
      .writeText(command)
      .then(() => toast.success('cURL command copied'))
      .catch(() => toast.error('Could not access the clipboard'))
  }

  return (
    <div className="space-y-3 border-t bg-muted/20 px-4 py-3">
      {query.parameters.length > 0 && (
        <div className="grid gap-2 sm:grid-cols-2">
          {query.parameters.map((p) => (
            <div key={p.name} className="grid gap-1">
              <Label htmlFor={`lib-run-${query.key}-${p.name}`} className="text-xs">
                <span className="font-mono">{p.name}</span>
                <span className="ml-1 font-normal text-muted-foreground">
                  ({p.dataType})
                </span>
                <span className="text-destructive">*</span>
              </Label>
              <TypedValueInput
                id={`lib-run-${query.key}-${p.name}`}
                dataType={p.dataType}
                value={raw[p.name] ?? ''}
                onChange={(v) => setRaw((prev) => ({ ...prev, [p.name]: v }))}
                placeholder={p.description ?? undefined}
                allowEmptyBoolean={false}
              />
              {p.description !== null && p.description !== '' && (
                <p className="text-[11px] text-muted-foreground">{p.description}</p>
              )}
            </div>
          ))}
        </div>
      )}

      <div className="flex items-center gap-2">
        <Button
          size="sm"
          onClick={() => execute.mutate()}
          disabled={execute.isPending || !allParamsFilled}
        >
          <Play className="size-3.5" />
          {execute.isPending ? 'Running…' : 'Run'}
        </Button>
        <Button variant="ghost" size="xs" onClick={copyCurl}>
          Copy as cURL
        </Button>
      </div>

      {error !== null && <QueryErrorBlock message={error} />}

      {run !== null && (
        <ResultsPanel
          ontologyKey={ontologyKey}
          result={run.result}
          elapsedMs={run.ms}
          relationTypes={relationTypes}
          csvName={`${ontologyKey}-${query.key}`}
        />
      )}
    </div>
  )
}

/* ----------------------------------- cards ----------------------------------- */

function stepBadges(query: SavedQuery) {
  const queryCount = query.steps.filter((s) => s.type === 'oql').length
  const semanticCount = query.steps.filter((s) => s.type === 'semantic_search').length
  const badges: string[] = []
  if (queryCount > 0) badges.push(`${queryCount} query`)
  if (semanticCount > 0) badges.push(`${semanticCount} semantic`)
  return badges
}

interface LibraryTabProps {
  ontologyKey: string
  relationTypes: readonly SchemaRelationType[]
  /** `?run=` — open (and, when parameterless, immediately run) this query. */
  runKey: string | null
  /** Switch the page to the Console tab (zero-state CTA). */
  onOpenConsole: () => void
}

/**
 * Read/run-focused saved-query library: semantic search box (substring
 * fallback), cards with step/param badges, inline run panel per card and an
 * "Edit in Studio" link — management lives in the Studio.
 */
export function LibraryTab({
  ontologyKey,
  relationTypes,
  runKey,
  onOpenConsole,
}: LibraryTabProps) {
  const { data: features } = useFeatures()
  const { data: ontologies } = useOntologies()
  const ontologyId = ontologies?.find((o) => o.key === ontologyKey)?.ontologyId
  const studioHref =
    ontologyId !== undefined ? `/studio/ontologies/${ontologyId}?tab=queries` : '/studio/ontologies'

  const [search, setSearch] = useState('')
  const debounced = useDebouncedValue(search.trim(), 250)
  const semantic = features?.semanticSearch === true
  const queriesQuery = useSavedQuerySearch(ontologyKey, debounced, semantic, true)
  const queries = queriesQuery.data

  const [expandedKey, setExpandedKey] = useState<string | null>(runKey)
  const [lastRunKey, setLastRunKey] = useState(runKey)
  if (runKey !== lastRunKey) {
    setLastRunKey(runKey)
    if (runKey !== null) setExpandedKey(runKey)
  }

  return (
    <div className="mx-auto max-w-3xl space-y-3">
      <div className="relative">
        <Search className="pointer-events-none absolute left-2.5 top-1/2 size-3.5 -translate-y-1/2 text-muted-foreground" />
        <Input
          value={search}
          onChange={(e) => setSearch(e.target.value)}
          placeholder={
            semantic
              ? 'Search the library semantically — e.g. "who works where"'
              : 'Filter saved queries…'
          }
          className="h-8 pl-8 text-[13px]"
          aria-label="Search saved queries"
        />
      </div>

      {queriesQuery.isPending && (
        <div className="space-y-2">
          <Skeleton className="h-16 rounded-xl" />
          <Skeleton className="h-16 rounded-xl" />
        </div>
      )}

      {queries !== undefined && queries.length === 0 && debounced === '' && (
        <EmptyState
          icon={BookMarked}
          title="No saved queries yet"
          description="Save a query from the console with “Save as query”, or build multi-step pipelines in the Studio."
          action={
            <div className="flex items-center gap-2">
              <Button onClick={onOpenConsole}>
                <Terminal className="size-4" /> Open Console
              </Button>
              <Button variant="outline" asChild>
                <Link to={studioHref}>
                  <SquarePen className="size-4" /> Open Studio
                </Link>
              </Button>
            </div>
          }
        />
      )}

      {queries !== undefined && queries.length === 0 && debounced !== '' && (
        <p className="rounded-xl border bg-card p-6 text-center text-[13px] text-muted-foreground">
          No saved queries match “{debounced}”.
        </p>
      )}

      {queries !== undefined &&
        queries.map((q) => {
          const expanded = expandedKey === q.key
          return (
            <div key={q.key} className="overflow-hidden rounded-xl border bg-card">
              <div className="flex items-center gap-1.5 px-4 py-3 hover:bg-muted/40">
                <button
                  type="button"
                  onClick={() => setExpandedKey(expanded ? null : q.key)}
                  aria-expanded={expanded}
                  className="flex min-w-0 flex-1 items-center gap-3 text-left"
                >
                  <BookMarked className="size-4 shrink-0 text-muted-foreground" />
                  <div className="min-w-0 flex-1">
                    <div className="flex flex-wrap items-center gap-2">
                      <span className="truncate text-[13px] font-medium">{q.name}</span>
                      <span className="font-mono text-[11px] text-muted-foreground">
                        {q.key}
                      </span>
                      {stepBadges(q).map((b) => (
                        <Badge key={b} variant="secondary" className="font-mono text-[10px]">
                          {b}
                        </Badge>
                      ))}
                      {q.parameters.length > 0 && (
                        <Badge variant="outline" className="text-[10px]">
                          {q.parameters.length} param{q.parameters.length === 1 ? '' : 's'}
                        </Badge>
                      )}
                    </div>
                    {q.description !== null && q.description !== '' && (
                      <p className="truncate text-[12px] text-muted-foreground">
                        {q.description}
                      </p>
                    )}
                  </div>
                </button>
                <Button
                  variant="ghost"
                  size="icon-sm"
                  asChild
                  aria-label={`Edit ${q.key} in Studio`}
                >
                  <Link to={studioHref}>
                    <SquarePen className="size-3.5" />
                  </Link>
                </Button>
                <button
                  type="button"
                  onClick={() => setExpandedKey(expanded ? null : q.key)}
                  aria-label={expanded ? `Collapse ${q.key}` : `Expand ${q.key}`}
                  className="rounded p-1 text-muted-foreground hover:bg-muted hover:text-foreground"
                >
                  <ChevronDown
                    className={cn(
                      'size-4 shrink-0 transition-transform',
                      expanded && 'rotate-180',
                    )}
                  />
                </button>
              </div>
              {expanded && (
                <RunPanel
                  ontologyKey={ontologyKey}
                  query={q}
                  relationTypes={relationTypes}
                  autoRun={runKey === q.key && q.parameters.length === 0}
                />
              )}
            </div>
          )
        })}
    </div>
  )
}
