import { useMemo, useState, type ReactNode } from 'react'
import { useMutation } from '@tanstack/react-query'
import { Info, Play, Search, X } from 'lucide-react'
import { useFeatures, useSearchCatalog } from '@/api/hooks'
import { ApiError } from '@/api/http'
import * as runtime from '@/api/runtime'
import type { EntitySearchResponse, PassageSearchResponse, RuntimeSchema } from '@/api/types'
import { EmptyState } from '@/components/EmptyState'
import { QueryErrorBlock } from '@/components/query/ResultsPanel'
import { formatQueryError } from '@/components/query/resultUtils'
import { FilterChips } from '@/components/table/FilterChips'
import { FilterPopover } from '@/components/table/FilterPopover'
import {
  filtersToParam,
  relationSubjects,
  withCondition,
  type FilterCondition,
  type FilterSubjects,
} from '@/components/table/filters'
import { Button } from '@/components/ui/button'
import { Checkbox } from '@/components/ui/checkbox'
import { Input } from '@/components/ui/input'
import { Label } from '@/components/ui/label'
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@/components/ui/select'
import { getTypeColor } from '@/lib/typeColors'
import { cn } from '@/lib/utils'
import {
  fieldErrorsAt,
  searchBody,
  unplacedFieldErrors,
  type ScopeField,
  type SearchControl,
  type SearchMode,
} from './searchModel'
import { EntitySearchResult, PassageSearchResult } from './SearchResults'

type Outcome =
  | { mode: 'entities'; response: EntitySearchResponse }
  | { mode: 'passages'; response: PassageSearchResponse }

/** The search route rejects substring operators. */
const EXCLUDED_OPS = ['contains'] as const

/** A segmented control, as the results panel's table/graph toggle. */
function Segmented<T extends string>({
  value,
  options,
  onChange,
}: {
  value: T
  options: readonly { value: T; label: string }[]
  onChange: (next: T) => void
}) {
  return (
    <div className="flex w-fit items-center rounded-lg border p-0.5">
      {options.map((o) => (
        <button
          key={o.value}
          type="button"
          onClick={() => onChange(o.value)}
          aria-pressed={value === o.value}
          className={cn(
            'rounded-md px-2 py-0.5 text-[12px]',
            value === o.value
              ? 'bg-muted text-foreground'
              : 'text-muted-foreground hover:text-foreground',
          )}
        >
          {o.label}
        </button>
      ))}
    </div>
  )
}

/** A labelled row of the form, with the field errors at its request path. */
function Field({
  label,
  errors,
  children,
}: {
  label: string
  errors: readonly string[]
  children: ReactNode
}) {
  return (
    <div className="grid gap-1.5 sm:grid-cols-[6rem_1fr] sm:items-start">
      <Label className="pt-1.5 text-xs text-muted-foreground">{label}</Label>
      <div className="min-w-0 space-y-1.5">
        {children}
        {errors.map((message) => (
          <p key={message} className="text-xs text-destructive">
            {message}
          </p>
        ))}
      </div>
    </div>
  )
}

/** A number field that may stay empty: its placeholder names the empty
 * meaning, and a clear button brings it back once a value is set. */
function OptionalNumber({
  value,
  onChange,
  emptyLabel,
  label,
  className,
  ...bounds
}: {
  value: string
  onChange: (value: string) => void
  emptyLabel: string
  label: string
  className: string
  min: number
  max: number
  step?: number
  disabled?: boolean
}) {
  return (
    <div className="flex items-center gap-0.5">
      <Input
        type="number"
        {...bounds}
        value={value}
        onChange={(e) => onChange(e.target.value)}
        placeholder={emptyLabel}
        aria-label={label}
        className={className}
      />
      {value !== '' && !bounds.disabled && (
        <Button
          type="button"
          variant="ghost"
          size="icon-xs"
          onClick={() => onChange('')}
          aria-label={`${label}: ${emptyLabel}`}
          title={emptyLabel}
        >
          <X />
        </Button>
      )}
    </div>
  )
}

interface AdvancedSearchProps {
  ontologyKey: string
  lensKey: string
  schema: RuntimeSchema
}

/**
 * Advanced search: one control per field of `POST /search/entities` and
 * `/search/passages` — mode, query text, one scope field, the method blocks,
 * a filter (when the scope names one type), limit and per entity — and the
 * ranked items with what ran and what could not.
 */
export function AdvancedSearch({ ontologyKey, lensKey, schema }: AdvancedSearchProps) {
  const { data: features } = useFeatures()
  const semanticAvailable = features?.semanticSearch === true
  const catalog = useSearchCatalog(ontologyKey, lensKey).data ?? []

  const [mode, setMode] = useState<SearchMode>('entities')
  const [query, setQuery] = useState('')
  const [scope, setScope] = useState<{ field: ScopeField; keys: string[] }>({
    field: 'types',
    keys: [],
  })
  const [keyword, setKeyword] = useState<{ on: boolean; match: 'any' | 'all' }>({
    on: false,
    match: 'any',
  })
  const [semantic, setSemantic] = useState({ on: false, minSimilarity: '' })
  const [filter, setFilter] = useState<{ typeKey: string; conditions: FilterCondition[] }>({
    typeKey: '',
    conditions: [],
  })
  const [limit, setLimit] = useState('')
  const [perEntity, setPerEntity] = useState('')

  const [outcome, setOutcome] = useState<Outcome | null>(null)
  const [error, setError] = useState<unknown>(null)

  const typesByKey = useMemo(
    () => new Map(schema.entityTypes.map((t) => [t.key, t])),
    [schema.entityTypes],
  )
  const documentOptions = useMemo(
    () =>
      schema.entityTypes.flatMap((t) =>
        t.properties
          .filter((p) => p.dataType === 'document')
          .map((p) => ({ key: `${t.key}.${p.key}`, type: t, property: p })),
      ),
    [schema.entityTypes],
  )
  const indexOptions = mode === 'passages' ? catalog.filter((i) => i.documentProperty !== null) : catalog

  // Decision A: the filter editor works on one type — the scope must name exactly one.
  const filterTypeKey =
    scope.keys.length !== 1
      ? undefined
      : scope.field === 'types'
        ? scope.keys[0]
        : scope.field === 'documents'
          ? scope.keys[0].split('.')[0]
          : undefined
  const filterType = filterTypeKey !== undefined ? typesByKey.get(filterTypeKey) : undefined
  const conditions = filter.typeKey === filterTypeKey ? filter.conditions : []
  const filterSubjects = useMemo<FilterSubjects>(
    () => ({
      properties: filterType?.properties ?? [],
      relations:
        filterType === undefined
          ? []
          : relationSubjects(filterType.key, schema.relationTypes, schema.entityTypes),
    }),
    [filterType, schema.relationTypes, schema.entityTypes],
  )
  const setConditions = (next: (prev: FilterCondition[]) => FilterCondition[]) => {
    if (filterTypeKey !== undefined) setFilter({ typeKey: filterTypeKey, conditions: next(conditions) })
  }

  const switchMode = (next: SearchMode) => {
    setMode(next)
    // Documents and index choices are mode-specific; types carry over.
    if (scope.field !== 'types') setScope({ field: 'types', keys: [] })
  }

  const toggleScopeKey = (key: string) =>
    setScope((prev) => ({
      ...prev,
      keys: prev.keys.includes(key) ? prev.keys.filter((k) => k !== key) : [...prev.keys, key],
    }))

  const execute = useMutation({
    mutationFn: async (): Promise<Outcome> => {
      const body = searchBody({
        mode,
        query,
        scope,
        keyword,
        semantic: { ...semantic, on: semanticAvailable && semantic.on },
        filter: filtersToParam(conditions, filterSubjects.properties),
        limit,
        perEntity,
      })
      return mode === 'entities'
        ? { mode, response: await runtime.searchEntities(ontologyKey, lensKey, body) }
        : { mode, response: await runtime.searchPassages(ontologyKey, lensKey, body) }
    },
    onSuccess: (data) => {
      setOutcome(data)
      setError(null)
    },
    onError: (err) => {
      setOutcome(null)
      setError(err)
    },
  })

  const run = () => {
    if (query.trim() === '' || execute.isPending) return
    execute.mutate()
  }

  const fields = error instanceof ApiError ? (error.fieldErrors ?? {}) : {}
  const errorsAt = (control: SearchControl) => fieldErrorsAt(fields, control)
  const featureDisabled = error instanceof ApiError && error.details?.code === 'FEATURE_DISABLED'
  const otherError =
    error === null || featureDisabled
      ? null
      : error instanceof ApiError && error.fieldErrors !== undefined
        ? unplacedFieldErrors(fields).join('\n') || null
        : formatQueryError(error)

  const scopeOptions: { value: ScopeField; label: string }[] = [
    { value: 'types', label: 'Types' },
    { value: 'indices', label: 'Indices' },
    ...(mode === 'passages' ? [{ value: 'documents' as const, label: 'Documents' }] : []),
  ]
  const scopeChoices =
    scope.field === 'types'
      ? schema.entityTypes.map((t) => ({ key: t.key, label: t.displayName, typeKey: t.key }))
      : scope.field === 'indices'
        ? indexOptions.map((i) => ({ key: i.key, label: i.name, typeKey: i.entityType }))
        : documentOptions.map((d) => ({
            key: d.key,
            label: `${d.type.displayName} · ${d.property.displayName}`,
            typeKey: d.type.key,
          }))

  return (
    <div className="mx-auto max-w-4xl space-y-3">
      <div className="space-y-3 rounded-xl border bg-card p-4">
        <div className="flex flex-wrap items-center gap-2">
          <Segmented
            value={mode}
            options={[
              { value: 'entities', label: 'Entities' },
              { value: 'passages', label: 'Passages' },
            ]}
            onChange={switchMode}
          />
          <div className="relative min-w-48 flex-1">
            <Search className="pointer-events-none absolute left-2.5 top-1/2 size-3.5 -translate-y-1/2 text-muted-foreground" />
            <Input
              value={query}
              onChange={(e) => setQuery(e.target.value)}
              onKeyDown={(e) => {
                if (e.key === 'Enter') run()
              }}
              placeholder={mode === 'entities' ? 'Search entities…' : 'Search passages…'}
              className="h-8 pl-8 text-[13px]"
              aria-label="Search text"
              aria-invalid={errorsAt('query').length > 0}
            />
          </div>
          <Button size="sm" onClick={run} disabled={query.trim() === '' || execute.isPending}>
            <Play className="size-3.5" />
            {execute.isPending ? 'Running…' : 'Run'}
          </Button>
        </div>
        {errorsAt('query').map((message) => (
          <p key={message} className="text-xs text-destructive">
            {message}
          </p>
        ))}

        <Field
          label="Scope"
          errors={[...errorsAt('types'), ...errorsAt('indices'), ...errorsAt('documents')]}
        >
          <Segmented
            value={scope.field}
            options={scopeOptions}
            onChange={(field) => setScope({ field, keys: [] })}
          />
          <div className="flex flex-wrap items-center gap-1">
            {scopeChoices.map((c) => {
              const selected = scope.keys.includes(c.key)
              const color = getTypeColor(c.typeKey)
              return (
                <button
                  key={c.key}
                  type="button"
                  onClick={() => toggleScopeKey(c.key)}
                  aria-pressed={selected}
                  title={c.key}
                  className={cn(
                    'inline-flex items-center gap-1.5 rounded-md border px-2 py-0.5 text-[11px] font-medium transition-opacity',
                    color.chip,
                    !selected && 'opacity-40 hover:opacity-70',
                  )}
                >
                  <span className={cn('size-1.5 rounded-full', color.dot)} aria-hidden />
                  {c.label}
                </button>
              )
            })}
            {scopeChoices.length === 0 && (
              <span className="text-xs text-muted-foreground">Nothing to choose in this lens.</span>
            )}
          </div>
          <p className="text-[11px] text-muted-foreground">
            {scope.keys.length === 0
              ? 'None chosen: every type this lens shows is searched.'
              : `${scope.keys.length} chosen.`}
          </p>
        </Field>

        <Field label="Methods" errors={[...errorsAt('keyword'), ...errorsAt('semantic')]}>
          <div className="flex flex-wrap items-center gap-x-5 gap-y-2">
            <div className="flex items-center gap-2">
              <label className="flex items-center gap-2 text-[13px]">
                <Checkbox
                  checked={keyword.on}
                  onCheckedChange={(checked) => setKeyword((k) => ({ ...k, on: checked === true }))}
                />
                Keyword
              </label>
              <Select
                value={keyword.match}
                onValueChange={(match) => setKeyword((k) => ({ ...k, match: match as 'any' | 'all' }))}
                disabled={!keyword.on}
              >
                <SelectTrigger size="sm" className="w-36" aria-label="Keyword match">
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value="any">match any word</SelectItem>
                  <SelectItem value="all">match all words</SelectItem>
                </SelectContent>
              </Select>
            </div>
            {semanticAvailable && (
              <div className="flex items-center gap-2">
                <label className="flex items-center gap-2 text-[13px]">
                  <Checkbox
                    checked={semantic.on}
                    onCheckedChange={(checked) => setSemantic((s) => ({ ...s, on: checked === true }))}
                  />
                  Semantic
                </label>
                <OptionalNumber
                  min={0}
                  max={1}
                  step={0.05}
                  value={semantic.minSimilarity}
                  onChange={(minSimilarity) => setSemantic((s) => ({ ...s, minSimilarity }))}
                  disabled={!semantic.on}
                  emptyLabel="no floor"
                  label="Minimum similarity"
                  className="h-8 w-28 text-[13px]"
                />
              </div>
            )}
          </div>
          {!keyword.on && !semantic.on && (
            <p className="text-[11px] text-muted-foreground">
              None checked: the server runs what can run.
            </p>
          )}
        </Field>

        {filterType !== undefined && (
          <Field label="Filter" errors={errorsAt('filter')}>
            <FilterPopover
              subjects={filterSubjects}
              active={conditions}
              onAdd={(f) => setConditions((prev) => withCondition(prev, f))}
              excludedOps={EXCLUDED_OPS}
            />
            <FilterChips
              filters={conditions}
              subjects={filterSubjects}
              onRemove={(id) => setConditions((prev) => prev.filter((f) => f.id !== id))}
              onClearAll={() => setConditions(() => [])}
            />
          </Field>
        )}

        <Field label="Limit" errors={[...errorsAt('limit'), ...errorsAt('perEntity')]}>
          <div className="flex flex-wrap items-center gap-2">
            <Input
              type="number"
              min={1}
              max={100}
              value={limit}
              onChange={(e) => setLimit(e.target.value)}
              placeholder="10"
              aria-label="Limit"
              className="h-8 w-24 text-[13px]"
            />
            {mode === 'passages' && (
              <>
                <span className="text-xs text-muted-foreground">per entity</span>
                <OptionalNumber
                  min={1}
                  max={100}
                  value={perEntity}
                  onChange={setPerEntity}
                  emptyLabel="no cap"
                  label="Passages per entity"
                  className="h-8 w-24 text-[13px]"
                />
              </>
            )}
          </div>
        </Field>
      </div>

      {featureDisabled && error instanceof ApiError && (
        <p className="flex items-start gap-2 rounded-xl border bg-muted/30 p-3 text-[13px] text-muted-foreground">
          <Info className="mt-0.5 size-3.5 shrink-0" />
          {error.message}
        </p>
      )}

      {otherError !== null && <QueryErrorBlock message={otherError} />}

      {outcome !== null && outcome.mode === 'entities' && (
        <EntitySearchResult
          ontologyKey={ontologyKey}
          lensKey={lensKey}
          schema={schema}
          response={outcome.response}
        />
      )}

      {outcome !== null && outcome.mode === 'passages' && (
        <PassageSearchResult
          ontologyKey={ontologyKey}
          lensKey={lensKey}
          schema={schema}
          response={outcome.response}
        />
      )}

      {outcome === null && error === null && (
        <EmptyState
          icon={Search}
          title="Search this lens"
          description="Rank entities, or passages of their documents, for a text — by keyword, by meaning, or both."
        />
      )}
    </div>
  )
}
