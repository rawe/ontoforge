import { useMemo, useState, type ReactNode } from 'react'
import { useMutation } from '@tanstack/react-query'
import { ChevronDown, Info, Play, Search, SlidersHorizontal, X } from 'lucide-react'
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
import { Input } from '@/components/ui/input'
import { cn } from '@/lib/utils'
import { SearchExplainerButton } from './explainer/SearchExplainer'
import { ScopePicker, type ScopeChoice } from './ScopePicker'
import {
  fieldErrorsAt,
  scopeSummary,
  searchBody,
  sharedType,
  unplacedFieldErrors,
  type MethodChoice,
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

const microLabel = 'text-[10px] font-semibold tracking-wider text-muted-foreground uppercase'

/** A segmented control, as the results panel's table/graph toggle. */
function Segmented<T extends string>({
  value,
  options,
  onChange,
  label,
  className,
}: {
  value: T
  options: readonly { value: T; label: string }[]
  onChange: (next: T) => void
  label: string
  className?: string
}) {
  return (
    <div role="group" aria-label={label} className={cn('flex w-fit items-center rounded-lg border p-0.5', className)}>
      {options.map((o) => (
        <button
          key={o.value}
          type="button"
          onClick={() => onChange(o.value)}
          aria-pressed={value === o.value}
          className={cn(
            'flex-1 rounded-md px-2 py-0.5 text-[12px] whitespace-nowrap',
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

/** One section of the settings panel: a small heading, its controls, and the
 * field errors at its request paths. */
function Section({
  title,
  aside,
  errors,
  children,
}: {
  title: string
  aside?: ReactNode
  errors: readonly string[]
  children: ReactNode
}) {
  return (
    <section className="space-y-2 p-3" aria-label={title}>
      <div className="flex items-center justify-between gap-2">
        <h3 className={microLabel}>{title}</h3>
        {aside}
      </div>
      {children}
      {errors.map((message) => (
        <p key={message} className="text-xs text-destructive">
          {message}
        </p>
      ))}
    </section>
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

const METHOD_HINTS: Record<MethodChoice, string> = {
  keyword: 'Finds the words you typed, in any of their forms.',
  semantic: 'Finds texts close in meaning, even without the same words.',
  both: 'Runs both and fuses their rankings: being found by both moves an entity up.',
}

interface AdvancedSearchProps {
  ontologyKey: string
  lensKey: string
  schema: RuntimeSchema
}

/**
 * Advanced search: one control per field of `POST /search/entities` and
 * `/search/passages` — mode and query text on top; scope, methods, a filter
 * and the limits in a settings panel beside the ranked items (above them on
 * a narrow screen, folded); the items with what ran and what could not.
 */
export function AdvancedSearch({ ontologyKey, lensKey, schema }: AdvancedSearchProps) {
  const { data: features } = useFeatures()
  const semanticAvailable = features?.semanticSearch === true
  const catalogData = useSearchCatalog(ontologyKey, lensKey).data
  const catalog = useMemo(() => catalogData ?? [], [catalogData])

  const [mode, setMode] = useState<SearchMode>('entities')
  const [query, setQuery] = useState('')
  // One scope field is sent; each keeps its own choice while another is shown.
  const [scopeField, setScopeField] = useState<ScopeField>('types')
  const [chosen, setChosen] = useState<Record<ScopeField, string[]>>({
    types: [],
    indices: [],
    documents: [],
  })
  // Unset until the person picks: both where semantic search is available.
  const [methodPick, setMethodPick] = useState<MethodChoice | null>(null)
  const [match, setMatch] = useState<'any' | 'all'>('any')
  const [minSimilarity, setMinSimilarity] = useState('')
  const [filter, setFilter] = useState<{ typeKey: string; conditions: FilterCondition[] }>({
    typeKey: '',
    conditions: [],
  })
  const [limit, setLimit] = useState('')
  const [perEntity, setPerEntity] = useState('')
  const [settingsOpen, setSettingsOpen] = useState(false)

  const [outcome, setOutcome] = useState<Outcome | null>(null)
  const [error, setError] = useState<unknown>(null)

  const typesByKey = useMemo(
    () => new Map(schema.entityTypes.map((t) => [t.key, t])),
    [schema.entityTypes],
  )
  const choices = useMemo<Record<ScopeField, ScopeChoice[]>>(() => {
    const byName = (a: { label: string }, b: { label: string }) => a.label.localeCompare(b.label)
    const kindOrder = { default: 0, passage: 1, custom: 2 }
    const indices = catalog
      .filter((i) => mode === 'entities' || i.documentProperty !== null)
      .map((i) => {
        const type = typesByKey.get(i.entityType)
        const document = type?.properties.find((p) => p.key === i.documentProperty)
        return {
          key: i.key,
          label:
            i.kind === 'default'
              ? 'Own fields'
              : i.kind === 'passage'
                ? `${document?.displayName ?? i.documentProperty} passages`
                : i.name,
          typeKey: i.entityType,
          group: type?.displayName ?? i.entityType,
          description: i.description,
          index: { kind: i.kind, modes: i.modes, status: i.status },
          order: kindOrder[i.kind],
        }
      })
      .sort((a, b) => a.group.localeCompare(b.group) || a.order - b.order || byName(a, b))
    return {
      types: schema.entityTypes
        .map((t) => ({ key: t.key, label: t.displayName, typeKey: t.key }))
        .sort(byName),
      indices,
      documents: schema.entityTypes
        .flatMap((t) =>
          t.properties
            .filter((p) => p.dataType === 'document')
            .map((p) => ({ key: `${t.key}.${p.key}`, label: p.displayName, typeKey: t.key, group: t.displayName })),
        )
        .sort((a, b) => a.group.localeCompare(b.group) || byName(a, b)),
    }
  }, [catalog, mode, schema.entityTypes, typesByKey])

  // Only keys the current mode offers are sent: an index without a document
  // stays chosen in Entities while Passages leaves it out.
  const offered = new Set(choices[scopeField].map((c) => c.key))
  const scopeKeys = chosen[scopeField].filter((k) => offered.has(k))

  const method: MethodChoice | null =
    features === undefined ? null : semanticAvailable ? (methodPick ?? 'both') : 'keyword'

  // The filter editor works on one type: every chosen scope item must share it.
  const filterTypeKey = sharedType(scopeKeys, (key) =>
    scopeField === 'types'
      ? key
      : scopeField === 'documents'
        ? key.split('.')[0]
        : catalog.find((i) => i.key === key)?.entityType,
  )
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
    // Documents are the passage search's only.
    if (next === 'entities' && scopeField === 'documents') setScopeField('types')
  }

  const request = {
    mode,
    body: searchBody({
      mode,
      query,
      scope: { field: scopeField, keys: scopeKeys },
      keyword: { on: method === 'keyword' || method === 'both', match },
      semantic: { on: method === 'semantic' || method === 'both', minSimilarity },
      filter: filtersToParam(conditions, filterSubjects),
      limit,
      perEntity,
    }),
  }
  // What the shown results were searched with: a change since then marks them stale.
  const [ranWith, setRanWith] = useState('')
  const stale = outcome !== null && ranWith !== JSON.stringify(request)

  const execute = useMutation({
    mutationFn: async ({ mode, body }: typeof request): Promise<Outcome> =>
      mode === 'entities'
        ? { mode, response: await runtime.searchEntities(ontologyKey, lensKey, body) }
        : { mode, response: await runtime.searchPassages(ontologyKey, lensKey, body) },
    onSuccess: (data, sent) => {
      setOutcome(data)
      setError(null)
      setRanWith(JSON.stringify(sent))
    },
    onError: (err) => {
      setOutcome(null)
      setError(err)
    },
  })

  const run = () => {
    if (query.trim() === '' || execute.isPending) return
    execute.mutate(request)
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
  const settingErrors = (['types', 'indices', 'documents', 'keyword', 'semantic', 'filter', 'limit', 'perEntity'] as const)
    .some((control) => errorsAt(control).length > 0)

  const scopeOptions: { value: ScopeField; label: string }[] = [
    { value: 'types', label: 'Types' },
    { value: 'indices', label: 'Indices' },
    ...(mode === 'passages' ? [{ value: 'documents' as const, label: 'Documents' }] : []),
  ]
  const methodOptions: { value: MethodChoice; label: string }[] = semanticAvailable
    ? [
        { value: 'both', label: 'Both' },
        { value: 'keyword', label: 'Keyword' },
        { value: 'semantic', label: 'Semantic' },
      ]
    : [{ value: 'keyword', label: 'Keyword' }]
  const methodName = method === null ? 'Methods' : methodOptions.find((o) => o.value === method)?.label
  const summary = [
    scopeSummary(scopeField, scopeKeys.length, choices[scopeField].length),
    methodName,
    conditions.length > 0 ? `${conditions.length} filter${conditions.length === 1 ? '' : 's'}` : null,
    `limit ${limit === '' ? 10 : limit}`,
  ]
    .filter((part) => part !== null)
    .join(' · ')

  return (
    <div className="mx-auto max-w-7xl space-y-4">
      <div className="flex flex-wrap items-center gap-2 rounded-xl border bg-card p-3">
        <Segmented
          label="Search for"
          value={mode}
          options={[
            { value: 'entities', label: 'Entities' },
            { value: 'passages', label: 'Passages' },
          ]}
          onChange={switchMode}
        />
        <div className="flex min-w-0 flex-[1_1_16rem] items-center gap-2">
          <div className="relative min-w-0 flex-1">
            <Search className="pointer-events-none absolute top-1/2 left-2.5 size-3.5 -translate-y-1/2 text-muted-foreground" />
            <Input
              value={query}
              onChange={(e) => setQuery(e.target.value)}
              onKeyDown={(e) => {
                if (e.key === 'Enter') run()
              }}
              placeholder={mode === 'entities' ? 'Search entities…' : 'Search passages of documents…'}
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
          <p key={message} className="w-full text-xs text-destructive">
            {message}
          </p>
        ))}
      </div>

      <div className="grid gap-4 lg:grid-cols-[20rem_minmax(0,1fr)] lg:items-start">
        <aside
          className="rounded-xl border bg-card lg:sticky lg:top-4 lg:max-h-[calc(100dvh-2rem)] lg:overflow-y-auto"
          aria-label="Search settings"
        >
          <button
            type="button"
            onClick={() => setSettingsOpen((open) => !open)}
            aria-expanded={settingsOpen}
            className="flex w-full items-center gap-2 px-3 py-2.5 text-left lg:hidden"
          >
            <SlidersHorizontal className="size-3.5 shrink-0 text-muted-foreground" />
            <span className="min-w-0 flex-1 truncate text-[12.5px]">
              <span className="font-medium">Settings</span>
              <span className="text-muted-foreground"> · {summary}</span>
            </span>
            {settingErrors && (
              <span className="size-1.5 rounded-full bg-destructive">
                <span className="sr-only">Has errors</span>
              </span>
            )}
            <ChevronDown className={cn('size-4 text-muted-foreground transition-transform', settingsOpen && 'rotate-180')} />
          </button>
          <div className={cn('divide-y border-t lg:border-t-0', !settingsOpen && 'hidden lg:block')}>
            <Section
              title="Where to look"
              errors={[...errorsAt('types'), ...errorsAt('indices'), ...errorsAt('documents')]}
            >
              <Segmented
                label="Choose by"
                value={scopeField}
                options={scopeOptions}
                onChange={setScopeField}
                className="w-full"
              />
              <ScopePicker
                key={`${scopeField}/${mode}`}
                field={scopeField}
                semanticAvailable={semanticAvailable}
                mode={mode}
                choices={choices[scopeField]}
                chosen={scopeKeys}
                onChange={(keys) =>
                  setChosen((prev) => ({
                    ...prev,
                    // Keys this mode does not offer stay chosen for the other.
                    [scopeField]: [...prev[scopeField].filter((k) => !offered.has(k)), ...keys],
                  }))
                }
              />
            </Section>

            <Section title="How to match" errors={[...errorsAt('keyword'), ...errorsAt('semantic')]}>
              {method === null ? (
                <p className="text-[11px] text-muted-foreground">The server runs what can run.</p>
              ) : (
                <>
                  <Segmented
                    label="Methods"
                    value={method}
                    options={methodOptions}
                    onChange={setMethodPick}
                    className="w-full"
                  />
                  <p className="text-[11px] leading-snug text-muted-foreground">
                    {METHOD_HINTS[method]}
                    {!semanticAvailable && ' Semantic search is not set up on this server.'}
                  </p>
                  {method !== 'semantic' && (
                    <div className="flex items-center justify-between gap-2">
                      <span className="text-[12px]">Keyword match</span>
                      <Segmented
                        label="Keyword match"
                        value={match}
                        options={[
                          { value: 'any', label: 'Any word' },
                          { value: 'all', label: 'All words' },
                        ]}
                        onChange={setMatch}
                      />
                    </div>
                  )}
                  {method !== 'keyword' && (
                    <div className="flex items-center justify-between gap-2">
                      <span className="grid text-[12px]">
                        Minimum similarity
                        <span className="text-[10.5px] text-muted-foreground">0–1; drops less similar matches</span>
                      </span>
                      <OptionalNumber
                        min={0}
                        max={1}
                        step={0.05}
                        value={minSimilarity}
                        onChange={setMinSimilarity}
                        emptyLabel="none"
                        label="Minimum similarity"
                        className="h-7 w-20 text-[12.5px]"
                      />
                    </div>
                  )}
                </>
              )}
            </Section>

            <Section
              title="Filter"
              errors={errorsAt('filter')}
              aside={
                filterType !== undefined && (
                  <FilterPopover
                    subjects={filterSubjects}
                    active={conditions}
                    onAdd={(f) => setConditions((prev) => withCondition(prev, f))}
                    excludedOps={EXCLUDED_OPS}
                    values={{ ontologyKey, lensKey, typeKey: filterType.key }}
                  />
                )
              }
            >
              {filterType === undefined ? (
                <p className="text-[11px] leading-snug text-muted-foreground">
                  Filters work on one type’s properties: choose one type — or indices or documents of one type —
                  under Where to look.
                </p>
              ) : conditions.length === 0 ? (
                <p className="text-[11px] leading-snug text-muted-foreground">
                  No filter: every {filterType.displayName} can be found. A filter keeps only those that match it.
                </p>
              ) : (
                <FilterChips
                  filters={conditions}
                  subjects={filterSubjects}
                  onRemove={(id) => setConditions((prev) => prev.filter((f) => f.id !== id))}
                  onClearAll={() => setConditions(() => [])}
                />
              )}
            </Section>

            <Section title="How many" errors={[...errorsAt('limit'), ...errorsAt('perEntity')]}>
              <div className="flex items-center justify-between gap-2">
                <span className="text-[12px]">{mode === 'entities' ? 'Entities' : 'Passages'}</span>
                <Input
                  type="number"
                  min={1}
                  max={100}
                  value={limit}
                  onChange={(e) => setLimit(e.target.value)}
                  placeholder="10"
                  aria-label="Limit"
                  className="h-7 w-20 text-[12.5px]"
                />
              </div>
              {mode === 'passages' && (
                <div className="flex items-center justify-between gap-2">
                  <span className="text-[12px]">Per entity, at most</span>
                  <OptionalNumber
                    min={1}
                    max={100}
                    value={perEntity}
                    onChange={setPerEntity}
                    emptyLabel="no cap"
                    label="Passages per entity"
                    className="h-7 w-20 text-[12.5px]"
                  />
                </div>
              )}
            </Section>
          </div>
        </aside>

        <div className="min-w-0 space-y-3">
          {featureDisabled && error instanceof ApiError && (
            <p className="flex items-start gap-2 rounded-xl border bg-muted/30 p-3 text-[13px] text-muted-foreground">
              <Info className="mt-0.5 size-3.5 shrink-0" />
              {error.message}
            </p>
          )}

          {otherError !== null && <QueryErrorBlock message={otherError} />}

          {stale && (
            <div className="flex flex-wrap items-center gap-2 rounded-lg border border-dashed px-3 py-1.5 text-[12px] text-muted-foreground">
              <Info className="size-3.5 shrink-0" />
              <span className="flex-1">The search changed since these results.</span>
              <Button size="xs" variant="outline" onClick={run} disabled={query.trim() === '' || execute.isPending}>
                <Play className="size-3" /> Run again
              </Button>
            </div>
          )}

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
              description={`Rank ${mode === 'entities' ? 'entities' : 'passages of documents'} for a text — by keyword, by meaning, or both.`}
              action={<SearchExplainerButton labeled />}
              className="rounded-xl border border-dashed"
            />
          )}
        </div>
      </div>
    </div>
  )
}
