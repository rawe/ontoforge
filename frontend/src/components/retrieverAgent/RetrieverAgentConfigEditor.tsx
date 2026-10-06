import { Plus, Trash2 } from 'lucide-react'
import type { ReactNode } from 'react'
import type { RetrieverAgentConfig, RetrieverAgentFilter } from '@/api/retrieverAgents'
import type { RuntimeSchema, SearchCatalogEntry, ValidationError } from '@/api/types'
import { TypeChip } from '@/components/TypeChip'
import { Badge } from '@/components/ui/badge'
import { Button } from '@/components/ui/button'
import { Checkbox } from '@/components/ui/checkbox'
import { Input } from '@/components/ui/input'
import { cn } from '@/lib/utils'
import {
  MAX_ANSWER_FIELDS, MAX_ANSWER_FIELD_CHARACTERS, MIN_ANSWER_FIELD_CHARACTERS,
  answerFieldOptions, filterChoices, filterFieldOptions, filterLabel, groupRelationTypes, newFilter, pathKey, resultTypes,
  withIndex, withRelations, withoutIndex,
} from './retrieverAgentModel'

const selectClass = 'h-8 rounded-md border bg-background px-2 text-sm disabled:opacity-50'
const KIND_LABEL: Record<SearchCatalogEntry['kind'], string> = { default: 'default', passage: 'passages', custom: 'custom' }

interface ConfigEditorProps {
  config: RetrieverAgentConfig
  onChange: (config: RetrieverAgentConfig) => void
  catalog: SearchCatalogEntry[]
  schema: RuntimeSchema
  disabled: boolean
  /** Client and server issues; shown next to the section their path starts with. */
  issues: ValidationError[]
}

function Section({ title, description, issues, children }: { title: string; description: string; issues: ValidationError[]; children: ReactNode }) {
  return <section className="space-y-3 rounded-xl border bg-card p-4">
    <div><h3 className="text-[13px] font-semibold">{title}</h3><p className="mt-0.5 text-xs text-muted-foreground">{description}</p></div>
    {children}
    {issues.length > 0 && <ul className="space-y-0.5 text-xs text-destructive">{issues.map((issue, i) => <li key={i}>{issue.message}</li>)}</ul>}
  </section>
}

const at = (issues: ValidationError[], prefix: string) => issues.filter((i) => i.path === prefix || i.path.startsWith(`${prefix}[`) || i.path.startsWith(`${prefix}.`))

/**
 * Editor of a retriever agent's config v2: indices (with relation groups),
 * hard filters, answer fields per result type, threshold and answer size.
 * Controlled; the caller owns the draft and the Save.
 */
export function RetrieverAgentConfigEditor({ config, onChange, catalog, schema, disabled, issues }: ConfigEditorProps) {
  const types = resultTypes(config, catalog)
  const typeName = (key: string) => schema.entityTypes.find((t) => t.key === key)?.displayName ?? key
  const relationLabel = (entry: SearchCatalogEntry, relationType: string) =>
    entry.relations.find((g) => g.relationType === relationType && g.label !== null)?.label ?? schema.relationTypes.find((r) => r.key === relationType)?.displayName ?? relationType
  const byType = [...new Set(catalog.map((entry) => entry.entityType))].map((type) => ({ type, entries: catalog.filter((entry) => entry.entityType === type) }))
  const unavailable = config.indices.filter((ref) => !catalog.some((entry) => entry.key === ref.index))
  const setFilter = (i: number, filter: RetrieverAgentFilter) => onChange({ ...config, filters: config.filters.map((f, j) => (j === i ? filter : f)) })

  return <div className="grid gap-4">
    <Section title="Search indices" description="What a question can search. Hits are always entities of an index's type; the planner picks indices and relation groups per question." issues={at(issues, 'indices')}>
      {catalog.length === 0 && <p className="text-xs text-muted-foreground">This lens offers no search index. Include indices in the Scope tab, or create them under Search.</p>}
      {unavailable.map((ref) => <div key={ref.index} className="flex items-center gap-2 rounded-lg border border-destructive/30 p-2 text-xs">
        <span className="min-w-0 flex-1 text-destructive">Index <code>{ref.index}</code> is not available in this lens. It is kept for repair.</span>
        <Button size="sm" variant="outline" disabled={disabled} onClick={() => onChange(withoutIndex(config, ref.index, catalog))}>Remove</Button>
      </div>)}
      {byType.map(({ type, entries }) => <div key={type} className="space-y-1.5">
        <TypeChip typeKey={type} displayName={typeName(type)} size="sm" />
        <ul className="space-y-1.5">{entries.map((entry) => {
          const ref = config.indices.find((r) => r.index === entry.key)
          const groups = groupRelationTypes(entry)
          return <li key={entry.key} className={cn('rounded-lg border p-2.5', ref && 'border-primary/40 bg-primary/5')}>
            <label className="flex cursor-pointer items-start gap-2 text-sm">
              <Checkbox className="mt-0.5" checked={ref !== undefined} disabled={disabled} aria-label={`Search ${entry.name}`}
                onCheckedChange={(checked) => onChange(checked === true ? withIndex(config, entry, schema) : withoutIndex(config, entry.key, catalog))} />
              <span className="min-w-0 flex-1">
                <span className="flex flex-wrap items-center gap-1.5"><span className="font-medium">{entry.name}</span><code className="text-[11px] text-muted-foreground">{entry.key}</code>
                  <Badge variant={entry.kind === 'custom' ? 'secondary' : 'outline'} className="text-[10.5px]">{KIND_LABEL[entry.kind]}</Badge>
                  {entry.status !== 'ready' && <Badge variant="outline" className="text-[10.5px] text-muted-foreground" title="Build status of the index">{entry.status}</Badge>}</span>
                {entry.description && <span className="mt-0.5 block text-xs text-muted-foreground">{entry.description}</span>}
              </span>
            </label>
            {ref !== undefined && groups.length > 0 && <div className="mt-2 ml-6 space-y-1.5 text-xs">
              <div className="flex flex-wrap gap-x-4 gap-y-1">
                <label className="flex items-center gap-1.5"><input type="radio" name={`relations-${entry.key}`} checked={ref.relations === undefined} disabled={disabled} onChange={() => onChange(withRelations(config, entry.key, undefined))} />All relation groups</label>
                <label className="flex items-center gap-1.5"><input type="radio" name={`relations-${entry.key}`} checked={ref.relations !== undefined} disabled={disabled} onChange={() => onChange(withRelations(config, entry.key, groups))} />Only these</label>
              </div>
              {ref.relations !== undefined && <div className="flex flex-wrap gap-x-4 gap-y-1">{groups.map((relationType) => <label key={relationType} className="flex items-center gap-1.5">
                <Checkbox checked={ref.relations?.includes(relationType) ?? false} disabled={disabled} onCheckedChange={(checked) => {
                  const current = ref.relations ?? []
                  onChange(withRelations(config, entry.key, checked === true ? [...current, relationType] : current.filter((r) => r !== relationType)))
                }} />{relationLabel(entry, relationType)}</label>)}
                {ref.relations.filter((r) => !groups.includes(r)).map((r) => <span key={r} className="text-destructive">{r} (no such group)</span>)}
              </div>}
            </div>}
          </li>
        })}</ul>
      </div>)}
    </Section>

    <Section title="Filters" description="Hard conditions: a value the question names must match exactly — on the result's own field or on an entity up to two relations away. A filter alone filters nothing; a question that names a value activates it." issues={at(issues, 'filters')}>
      {config.filters.map((filter, i) => {
        const choices = filterChoices(schema, filter.entityType)
        const choice = choices.find((c) => c.key === pathKey(filter.path))
        return <div key={i} className="space-y-2 rounded-lg border p-3">
          <div className="flex items-start gap-2"><div className="min-w-0 flex-1 text-sm font-medium">{filterLabel(filter, schema)}<p className="font-mono text-[11px] font-normal text-muted-foreground">{filter.id}</p></div>
            <Button size="icon" variant="ghost" disabled={disabled} aria-label={`Remove filter ${filter.id}`} className="size-6" onClick={() => onChange({ ...config, filters: config.filters.filter((_, n) => n !== i) })}><Trash2 className="size-3.5" /></Button></div>
          {/* Label column + full-width controls: rows stay aligned at every column width. */}
          <div className="grid grid-cols-[auto_minmax(0,1fr)] items-center gap-x-3 gap-y-2 text-xs">
            <span className="text-muted-foreground">Result</span>
            <select aria-label={`Result type of ${filter.id}`} className={`${selectClass} w-full`} value={filter.entityType} disabled={disabled} onChange={(e) => {
              const start = filterChoices(schema, e.target.value)[0]
              if (start) setFilter(i, { ...newFilter({ ...config, filters: config.filters.filter((_, n) => n !== i) }, e.target.value, start), id: filter.id })
            }}>
              {!types.includes(filter.entityType) && <option value={filter.entityType}>{filter.entityType} (not a result type)</option>}
              {types.map((t) => <option key={t} value={t}>{typeName(t)}</option>)}
            </select>
            <span className="text-muted-foreground">Path</span>
            <select aria-label={`Path of ${filter.id}`} className={`${selectClass} w-full`} value={choice?.key ?? '__missing'} disabled={disabled} onChange={(e) => {
              const next = choices.find((c) => c.key === e.target.value)
              if (next) setFilter(i, { ...newFilter(config, filter.entityType, next), id: filter.id })
            }}>
              {!choice && <option value="__missing">(path not visible in this lens)</option>}
              {choices.map((c) => <option key={c.key} value={c.key}>{c.path.length === 0 ? `${c.label} (own field)` : c.label}</option>)}
            </select>
            <span className="text-muted-foreground">Field</span>
            <select aria-label={`Field of ${filter.id}`} className={`${selectClass} w-full`} value={filter.field} disabled={disabled || !choice} onChange={(e) => setFilter(i, { ...filter, field: e.target.value })}>
              {choice && !filterFieldOptions(choice.target).some((p) => p.key === filter.field) && <option value={filter.field}>{choice.target.properties.find((p) => p.key === filter.field)?.displayName ?? (filter.field || 'Choose a field …')}</option>}
              {choice && filterFieldOptions(choice.target).map((p) => <option key={p.key} value={p.key}>{p.displayName}</option>)}
            </select>
          </div>
        </div>
      })}
      {types.length === 0 ? <p className="text-xs text-muted-foreground">Choose an index first; filters apply to its results.</p>
        : <label className="block text-xs"><span className="flex items-center gap-1 text-muted-foreground"><Plus className="size-3" />Add a filter</span>
          <select aria-label="Add a filter" className={`${selectClass} mt-1 w-full`} disabled={disabled} value="" onChange={(e) => {
            const [type, key] = e.target.value.split('|')
            const choice = filterChoices(schema, type).find((c) => c.key === key)
            if (choice) onChange({ ...config, filters: [...config.filters, newFilter(config, type, choice)] })
          }}>
            <option value="">Choose the field a question may name …</option>
            {types.map((type) => <optgroup key={type} label={typeName(type)}>{filterChoices(schema, type).map((c) =>
              <option key={c.key} value={`${type}|${c.key}`}>{c.path.length === 0 ? `${c.label} (own field)` : c.label}</option>)}</optgroup>)}
          </select></label>}
    </Section>

    <Section title="Answer fields" description={`Per result type, the values passed to the response model as evidence (at most ${MAX_ANSWER_FIELDS}); long values, documents included, are truncated. What is searched comes from the indices.`} issues={at(issues, 'answerFields')}>
      {types.length === 0 && <p className="text-xs text-muted-foreground">Choose an index first; its entity type gets answer fields.</p>}
      {types.map((type) => {
        const visible = schema.entityTypes.find((t) => t.key === type)
        const selected = config.answerFields[type] ?? []
        return <div key={type} className="space-y-1.5">
          <TypeChip typeKey={type} displayName={typeName(type)} size="sm" />
          <div className="flex flex-wrap gap-x-5 gap-y-2">{(visible ? answerFieldOptions(visible) : []).map((property) =>
            <label key={property.key} className="flex cursor-pointer items-center gap-2 text-sm">
              <Checkbox checked={selected.includes(property.key)} disabled={disabled || (!selected.includes(property.key) && selected.length >= MAX_ANSWER_FIELDS)}
                onCheckedChange={(checked) => onChange({ ...config, answerFields: { ...config.answerFields, [type]: checked === true ? [...selected, property.key] : selected.filter((f) => f !== property.key) } })} />
              {property.displayName}
            </label>)}</div>
        </div>
      })}
      {Object.keys(config.answerFields).filter((type) => !types.includes(type)).map((type) => <div key={type} className="flex items-center gap-2 rounded-lg border border-destructive/30 p-2 text-xs">
        <span className="min-w-0 flex-1 text-destructive">Answer fields for <code>{type}</code>, which no chosen index finds.</span>
        <Button size="sm" variant="outline" disabled={disabled} onClick={() => { const answerFields = { ...config.answerFields }; delete answerFields[type]; onChange({ ...config, answerFields }) }}>Remove</Button>
      </div>)}
    </Section>

    <Section title="Answer" description="How strict the search is and how much of each value the answer may read." issues={[...at(issues, 'threshold'), ...at(issues, 'answerFieldCharacters')]}>
      <label className="block space-y-2 text-sm"><span className="font-medium">Similarity threshold: {config.threshold.toFixed(2)}</span>
        <input className="w-full accent-primary" type="range" min="-1" max="1" step="0.05" disabled={disabled} value={config.threshold} onChange={(e) => onChange({ ...config, threshold: Number(e.target.value) })} />
        <span className="block text-xs text-muted-foreground">Scale −1 to 1. Higher = fewer results found by meaning. It does not prove correctness; keyword matches and exact filters are not cut by it.</span></label>
      <label className="block space-y-1 text-sm"><span>Maximum characters per answer field</span>
        <Input type="number" min={MIN_ANSWER_FIELD_CHARACTERS} max={MAX_ANSWER_FIELD_CHARACTERS} step={100} disabled={disabled} value={config.answerFieldCharacters}
          onChange={(e) => onChange({ ...config, answerFieldCharacters: Math.round(Number(e.target.value) || 0) })} className="w-32" />
        <span className="block text-xs text-muted-foreground">Longer values are truncated; truncation is disclosed with the evidence.</span></label>
    </Section>
  </div>
}
