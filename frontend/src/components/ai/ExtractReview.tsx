import { useQueryClient } from '@tanstack/react-query'
import {
  AlertCircle,
  ArrowLeft,
  ArrowRight,
  Braces,
  Check,
  ChevronRight,
  Link2,
  Loader2,
  TriangleAlert,
  Users,
  Waypoints,
} from 'lucide-react'
import { useMemo, useState } from 'react'
import { Link } from 'react-router-dom'
import { toast } from 'sonner'
import { ApiError } from '@/api/http'
import { createEntity, createRelation } from '@/api/runtime'
import type {
  ExtractResponse,
  JsonValue,
  RuntimeSchema,
  SemanticSearchResult,
} from '@/api/types'
import { TypeChip } from '@/components/TypeChip'
import {
  buildReviewModel,
  missingRequired,
  proposedLabel,
  relationBlocker,
  visibleProperties,
  type ReviewEntityItem,
  type ReviewRelationItem,
} from '@/components/ai/reviewModel'
import { useSimilarEntities } from '@/components/ai/useSimilarEntities'
import { PropertyField } from '@/components/schema/PropertyField'
import { coerceDrafts } from '@/components/schema/propertyDraft'
import { Badge } from '@/components/ui/badge'
import { Button } from '@/components/ui/button'
import { Checkbox } from '@/components/ui/checkbox'
import { Label } from '@/components/ui/label'
import { RadioGroup, RadioGroupItem } from '@/components/ui/radio-group'
import { displayLabel } from '@/lib/displayLabel'
import { cn } from '@/lib/utils'

/* --------------------------------- helpers ---------------------------------- */

function liveLabel(item: ReviewEntityItem): string {
  const nonEmpty: Record<string, JsonValue> = {}
  for (const [key, value] of Object.entries(item.drafts)) {
    if (value.trim() !== '') nonEmpty[key] = value
  }
  return proposedLabel(nonEmpty)
}

function StatusBadge({ item }: { item: { status: string; error?: string } }) {
  if (item.status === 'created') {
    return (
      <Badge className="gap-1 border-emerald-500/30 bg-emerald-500/10 text-emerald-600 dark:text-emerald-400">
        <Check className="size-3" />
        Created
      </Badge>
    )
  }
  if (item.status === 'creating') {
    return (
      <Badge variant="outline" className="gap-1 text-muted-foreground">
        <Loader2 className="size-3 animate-spin" />
        Creating
      </Badge>
    )
  }
  return null
}

/* ------------------------------- entity card -------------------------------- */

function EntityCard({
  item,
  similar,
  disabled,
  onChange,
}: {
  item: ReviewEntityItem
  similar: SemanticSearchResult[]
  disabled: boolean
  onChange: (patch: Partial<ReviewEntityItem>) => void
}) {
  const missing = missingRequired(item)
  const locked = disabled || item.status === 'created' || item.status === 'creating'
  const usingExisting = item.useExisting !== null

  return (
    <div
      className={cn(
        'rounded-lg border bg-card p-3 transition-colors',
        item.status === 'created' && 'border-emerald-500/40',
        item.status === 'error' && 'border-destructive/50',
        !item.checked && item.status === 'idle' && !usingExisting && 'opacity-60',
      )}
    >
      <div className="flex items-center gap-2.5">
        <Checkbox
          checked={item.checked}
          disabled={locked || item.type === undefined}
          onCheckedChange={(c) => onChange({ checked: c === true })}
          aria-label={`Include ${liveLabel(item)}`}
        />
        <span className="min-w-0 flex-1 truncate text-[13px] font-medium">
          {liveLabel(item)}
        </span>
        {missing.length > 0 && item.status !== 'created' && !usingExisting && (
          <Badge
            variant="outline"
            className="gap-1 border-amber-500/40 text-amber-600 dark:text-amber-400"
          >
            <TriangleAlert className="size-3" />
            {missing.length} required missing
          </Badge>
        )}
        <StatusBadge item={item} />
      </div>

      {item.type === undefined ? (
        <p className="mt-2 text-xs text-destructive">
          Entity type <span className="font-mono">{item.entityTypeKey}</span> is not in
          this lens&apos;s scope — cannot be created.
        </p>
      ) : (
        <>
          {!usingExisting && item.status !== 'created' && (
            <div className="mt-3 grid gap-2.5 sm:grid-cols-2">
              {visibleProperties(item).map((p) => (
                <PropertyField
                  key={p.key}
                  property={p}
                  draft={item.drafts[p.key] ?? ''}
                  onDraftChange={(d) =>
                    onChange({
                      drafts: { ...item.drafts, [p.key]: d },
                      fieldErrors: undefined,
                      ...(item.status === 'error' ? { status: 'idle' as const, error: undefined } : {}),
                    })
                  }
                  error={item.fieldErrors?.[p.key]}
                  disabled={locked}
                  idPrefix={`x-${item.id}`}
                />
              ))}
            </div>
          )}

          {Object.keys(item.unknownProps).length > 0 && (
            <p className="mt-2 text-[11px] text-muted-foreground">
              Ignored (not in schema):{' '}
              <span className="font-mono">
                {Object.entries(item.unknownProps)
                  .map(([k, v]) => `${k}: ${String(v)}`)
                  .join(', ')}
              </span>
            </p>
          )}

          {similar.length > 0 && item.status !== 'created' && (
            <div className="mt-3 rounded-md border border-dashed bg-muted/30 p-2.5">
              <p className="flex items-center gap-1.5 text-[11px] font-medium text-muted-foreground">
                <Users className="size-3" />
                Similar existing:
              </p>
              <RadioGroup
                value={item.useExisting ?? '__new__'}
                onValueChange={(value) => {
                  const hit =
                    value === '__new__'
                      ? undefined
                      : similar.find((s) => s.entity._id === value)
                  onChange({
                    useExisting: value === '__new__' ? null : value,
                    useExistingLabel: hit !== undefined ? displayLabel(hit.entity) : undefined,
                  })
                }}
                className="mt-1.5 gap-1.5"
                disabled={locked}
              >
                <Label className="flex cursor-pointer items-center gap-2 text-xs font-normal">
                  <RadioGroupItem value="__new__" />
                  Create new
                </Label>
                {similar.map(({ entity, score, matchedVia }) => (
                  <Label
                    key={entity._id}
                    className="flex cursor-pointer items-center gap-2 text-xs font-normal"
                  >
                    <RadioGroupItem value={entity._id} />
                    <span className="min-w-0 truncate">
                      Use existing <span className="font-medium">{displayLabel(entity)}</span>
                    </span>
                    <span className="ml-auto shrink-0 font-mono text-[10px] text-muted-foreground">
                      {/* Raw cosine similarity — top-level score is RRF-fused. */}
                      {Math.round((matchedVia?.similarity ?? score) * 100)}%
                    </span>
                  </Label>
                ))}
              </RadioGroup>
            </div>
          )}

          {usingExisting && (
            <p className="mt-2 flex items-center gap-1.5 text-xs text-muted-foreground">
              <Link2 className="size-3" />
              Will link to existing{' '}
              <span className="font-medium text-foreground">{item.useExistingLabel}</span>{' '}
              — nothing new is created.
            </p>
          )}
        </>
      )}

      {item.status === 'error' && item.error !== undefined && (
        <p className="mt-2 flex items-start gap-1.5 text-xs text-destructive">
          <AlertCircle className="mt-px size-3 shrink-0" />
          {item.error}
        </p>
      )}
    </div>
  )
}

/* ------------------------------- relation row -------------------------------- */

function RelationRow({
  item,
  blocker,
  disabled,
  onChange,
}: {
  item: ReviewRelationItem
  blocker: string | null
  disabled: boolean
  onChange: (patch: Partial<ReviewRelationItem>) => void
}) {
  const locked = disabled || item.status === 'created' || item.status === 'creating'
  const blocked = blocker !== null && item.status !== 'created'
  const props = item.type?.properties ?? []

  return (
    <div
      className={cn(
        'rounded-lg border bg-card p-3',
        item.status === 'created' && 'border-emerald-500/40',
        item.status === 'error' && 'border-destructive/50',
        (blocked || (!item.checked && item.status === 'idle')) && 'opacity-60',
      )}
    >
      <div className="flex items-center gap-2.5">
        <Checkbox
          checked={item.checked && !blocked}
          disabled={locked || blocked}
          onCheckedChange={(c) => onChange({ checked: c === true })}
          aria-label={`Include relation ${item.relationTypeKey}`}
        />
        <span className="flex min-w-0 flex-1 flex-wrap items-center gap-x-1.5 gap-y-1 text-[13px]">
          <span className="truncate font-medium">{item.sourceLabel}</span>
          <ArrowRight className="size-3 shrink-0 text-muted-foreground" />
          <TypeChip typeKey={item.relationTypeKey} displayName={item.relationTypeKey} size="sm" />
          <ArrowRight className="size-3 shrink-0 text-muted-foreground" />
          <span className="truncate font-medium">{item.targetLabel}</span>
        </span>
        <StatusBadge item={item} />
      </div>

      {blocked && (
        <p className="mt-1.5 pl-6 text-[11px] text-muted-foreground">{blocker}</p>
      )}

      {!blocked && props.length > 0 && item.status !== 'created' && (
        <div className="mt-2.5 grid gap-2.5 pl-6 sm:grid-cols-2">
          {props.map((p) => (
            <PropertyField
              key={p.key}
              property={p}
              draft={item.drafts[p.key] ?? ''}
              onDraftChange={(d) => onChange({ drafts: { ...item.drafts, [p.key]: d } })}
              disabled={locked}
              idPrefix={`x-${item.id}`}
            />
          ))}
        </div>
      )}

      {Object.keys(item.unknownProps).length > 0 && (
        <p className="mt-1.5 pl-6 text-[11px] text-muted-foreground">
          Ignored (not in schema):{' '}
          <span className="font-mono">
            {Object.entries(item.unknownProps)
              .map(([k, v]) => `${k}: ${String(v)}`)
              .join(', ')}
          </span>
        </p>
      )}

      {item.status === 'error' && item.error !== undefined && (
        <p className="mt-1.5 flex items-start gap-1.5 pl-6 text-xs text-destructive">
          <AlertCircle className="mt-px size-3 shrink-0" />
          {item.error}
        </p>
      )}
    </div>
  )
}

/* --------------------------------- review ----------------------------------- */

interface ExtractReviewProps {
  ontologyKey: string
  lensKey: string
  schema: RuntimeSchema
  response: ExtractResponse
  semanticEnabled: boolean
  /** Back to the input stage (text preserved by the parent). */
  onBack: () => void
}

/**
 * Review stage for AI extraction: proposed entities (left, grouped by type,
 * inline-editable, semantic dedupe with "use existing") and proposed
 * relations (right, endpoint-aware). Accept creates checked items
 * sequentially — entities first, then relations with endpoints resolved from
 * the created/existing id mapping. Failed items stay editable for retry.
 */
export function ExtractReview({
  ontologyKey,
  lensKey,
  schema,
  response,
  semanticEnabled,
  onBack,
}: ExtractReviewProps) {
  const queryClient = useQueryClient()
  const initial = useMemo(() => buildReviewModel(response, schema), [response, schema])
  const [entities, setEntities] = useState(initial.entities)
  const [relations, setRelations] = useState(initial.relations)
  const [accepting, setAccepting] = useState(false)
  const [showJson, setShowJson] = useState(false)
  const [firstCreated, setFirstCreated] = useState<{ typeKey: string; id: string } | null>(
    null,
  )

  const similar = useSimilarEntities(ontologyKey, lensKey, initial.entities, semanticEnabled)

  const entitiesById = useMemo(
    () => new Map(entities.map((e) => [e.id, e])),
    [entities],
  )

  const patchEntity = (id: string, patch: Partial<ReviewEntityItem>) =>
    setEntities((prev) => prev.map((e) => (e.id === id ? { ...e, ...patch } : e)))
  const patchRelation = (id: string, patch: Partial<ReviewRelationItem>) =>
    setRelations((prev) => prev.map((r) => (r.id === id ? { ...r, ...patch } : r)))

  const groups = useMemo(() => {
    const byType = new Map<string, ReviewEntityItem[]>()
    for (const e of entities) {
      const list = byType.get(e.entityTypeKey)
      if (list === undefined) byType.set(e.entityTypeKey, [e])
      else list.push(e)
    }
    return [...byType.entries()]
  }, [entities])

  const selectedEntities = entities.filter(
    (e) => e.checked && e.status !== 'created' && e.useExisting === null,
  ).length
  const selectedRelations = relations.filter(
    (r) =>
      r.checked && r.status !== 'created' && relationBlocker(r, entitiesById) === null,
  ).length
  const anythingToAccept = selectedEntities + selectedRelations > 0
  const createdCount =
    entities.filter((e) => e.status === 'created').length +
    relations.filter((r) => r.status === 'created').length

  const accept = async () => {
    setAccepting(true)
    // Work on local copies so the sequential loop sees its own updates;
    // state is refreshed after every item for live per-item feedback.
    const workEntities = entities.map((e) => ({ ...e }))
    const workRelations = relations.map((r) => ({ ...r }))
    const flushEntities = () => setEntities(workEntities.map((e) => ({ ...e })))
    const flushRelations = () => setRelations(workRelations.map((r) => ({ ...r })))

    const idMap = new Map<string, string>()
    let createdE = 0
    let createdR = 0
    let failed = 0
    let firstId = firstCreated

    // Pass 1 — entities (skip "use existing", remember the id mapping).
    for (const item of workEntities) {
      if (item.useExisting !== null) {
        idMap.set(item.id, item.useExisting)
        continue
      }
      if (item.status === 'created' && item.createdId !== undefined) {
        idMap.set(item.id, item.createdId)
        continue
      }
      if (!item.checked || item.type === undefined) continue

      const coerced = coerceDrafts(item.type.properties, item.drafts)
      if (!coerced.ok) {
        item.status = 'error'
        item.error = 'Fix the highlighted fields.'
        item.fieldErrors = coerced.errors
        failed++
        flushEntities()
        continue
      }
      item.status = 'creating'
      flushEntities()
      try {
        const created = await createEntity(ontologyKey, lensKey, item.entityTypeKey, coerced.values)
        item.status = 'created'
        item.createdId = created._id
        item.error = undefined
        item.fieldErrors = undefined
        idMap.set(item.id, created._id)
        createdE++
        if (firstId === null) firstId = { typeKey: item.entityTypeKey, id: created._id }
      } catch (error) {
        item.status = 'error'
        item.error = error instanceof Error ? error.message : String(error)
        if (error instanceof ApiError) item.fieldErrors = error.fieldErrors
        failed++
      }
      flushEntities()
    }

    // Pass 2 — relations, endpoints resolved via the id mapping.
    const workById = new Map(workEntities.map((e) => [e.id, e]))
    for (const item of workRelations) {
      if (!item.checked || item.status === 'created' || item.type === undefined) continue
      if (relationBlocker(item, workById) !== null) continue
      const fromId = item.sourceId !== undefined ? idMap.get(item.sourceId) : undefined
      const toId = item.targetId !== undefined ? idMap.get(item.targetId) : undefined
      if (fromId === undefined || toId === undefined) {
        item.status = 'error'
        item.error =
          fromId === undefined
            ? 'Source entity was not created — fix it above and accept again.'
            : 'Target entity was not created — fix it above and accept again.'
        failed++
        flushRelations()
        continue
      }
      const coerced = coerceDrafts(item.type.properties, item.drafts)
      if (!coerced.ok) {
        item.status = 'error'
        item.error = Object.entries(coerced.errors)
          .map(([k, v]) => `${k}: ${v}`)
          .join('; ')
        failed++
        flushRelations()
        continue
      }
      item.status = 'creating'
      flushRelations()
      try {
        await createRelation(ontologyKey, lensKey, item.relationTypeKey, {
          fromEntityId: fromId,
          toEntityId: toId,
          ...coerced.values,
        })
        item.status = 'created'
        item.error = undefined
        createdR++
      } catch (error) {
        item.status = 'error'
        item.error = error instanceof Error ? error.message : String(error)
        failed++
      }
      flushRelations()
    }

    setFirstCreated(firstId)
    setAccepting(false)
    void queryClient.invalidateQueries({ queryKey: ['entities', ontologyKey, lensKey] })

    if (failed === 0 && createdE + createdR > 0) {
      toast.success(
        `Created ${createdE} ${createdE === 1 ? 'entity' : 'entities'} and ${createdR} ${createdR === 1 ? 'relation' : 'relations'}`,
      )
    } else if (failed > 0) {
      toast.error(
        `${createdE + createdR} created, ${failed} failed — failed items stay listed for retry`,
      )
    }
  }

  return (
    <div className="flex min-h-0 flex-1 flex-col">
      <div className="min-h-0 flex-1 overflow-y-auto px-4 py-4">
        <div className="mb-3 flex items-center gap-2">
          <Button
            variant="ghost"
            size="sm"
            className="h-7 gap-1.5 text-xs text-muted-foreground"
            onClick={onBack}
            disabled={accepting}
          >
            <ArrowLeft className="size-3.5" />
            Edit text
          </Button>
          {semanticEnabled && similar.pending && (
            <span className="flex items-center gap-1.5 text-xs text-muted-foreground">
              <Loader2 className="size-3 animate-spin" />
              Checking for similar existing entities…
            </span>
          )}
          <button
            type="button"
            onClick={() => setShowJson((s) => !s)}
            className="ml-auto flex items-center gap-1.5 rounded-md px-1.5 py-0.5 text-xs text-muted-foreground transition-colors hover:bg-muted/60 hover:text-foreground"
            aria-expanded={showJson}
          >
            <Braces className="size-3" />
            Raw JSON
            <ChevronRight className={cn('size-3 transition-transform', showJson && 'rotate-90')} />
          </button>
        </div>

        {showJson && (
          <pre className="mb-4 max-h-64 overflow-auto rounded-lg border bg-muted/40 p-3 font-mono text-[11px] leading-relaxed">
            {JSON.stringify(response, null, 2)}
          </pre>
        )}

        <div className="grid items-start gap-4 xl:grid-cols-[minmax(0,1fr)_minmax(0,1fr)]">
          {/* Entities */}
          <section>
            <h3 className="mb-2 flex items-center gap-1.5 text-[11px] font-semibold uppercase tracking-wider text-muted-foreground">
              Proposed entities
              <span className="font-mono">({entities.length})</span>
            </h3>
            {entities.length === 0 && (
              <p className="rounded-lg border border-dashed p-4 text-[13px] text-muted-foreground">
                No entities were proposed from this text.
              </p>
            )}
            <div className="space-y-3">
              {groups.map(([typeKey, items]) => (
                <div key={typeKey}>
                  <div className="mb-1.5">
                    <TypeChip
                      typeKey={typeKey}
                      displayName={
                        schema.entityTypes.find((t) => t.key === typeKey)?.displayName ??
                        typeKey
                      }
                      size="sm"
                    />
                  </div>
                  <div className="space-y-2">
                    {items.map((item) => (
                      <EntityCard
                        key={item.id}
                        item={item}
                        similar={similar.hits[item.id] ?? []}
                        disabled={accepting}
                        onChange={(patch) => patchEntity(item.id, patch)}
                      />
                    ))}
                  </div>
                </div>
              ))}
            </div>
          </section>

          {/* Relations */}
          <section>
            <h3 className="mb-2 flex items-center gap-1.5 text-[11px] font-semibold uppercase tracking-wider text-muted-foreground">
              Proposed relations
              <span className="font-mono">({relations.length})</span>
            </h3>
            {relations.length === 0 && (
              <p className="rounded-lg border border-dashed p-4 text-[13px] text-muted-foreground">
                No relations were proposed from this text.
              </p>
            )}
            <div className="space-y-2">
              {relations.map((item) => (
                <RelationRow
                  key={item.id}
                  item={item}
                  blocker={relationBlocker(item, entitiesById)}
                  disabled={accepting}
                  onChange={(patch) => patchRelation(item.id, patch)}
                />
              ))}
            </div>
          </section>
        </div>
      </div>

      {/* Footer */}
      <div className="flex flex-wrap items-center gap-3 border-t px-4 py-3">
        <span className="text-[13px] tabular-nums text-muted-foreground">
          {selectedEntities} {selectedEntities === 1 ? 'entity' : 'entities'},{' '}
          {selectedRelations} {selectedRelations === 1 ? 'relation' : 'relations'} selected
          {createdCount > 0 && (
            <span className="ml-2 text-emerald-600 dark:text-emerald-400">
              · {createdCount} created
            </span>
          )}
        </span>
        <div className="ml-auto flex items-center gap-2">
          {createdCount > 0 && (
            <Button asChild variant="outline" size="sm" className="h-8 gap-1.5 text-[13px]">
              <Link
                to={`/o/${ontologyKey}/w/${lensKey}/explore${
                  firstCreated !== null
                    ? `?focus=${firstCreated.typeKey}:${firstCreated.id}`
                    : ''
                }`}
              >
                <Waypoints className="size-3.5" />
                Open Explorer
              </Link>
            </Button>
          )}
          <Button
            size="sm"
            className="h-8 gap-1.5 text-[13px]"
            disabled={!anythingToAccept || accepting}
            onClick={() => void accept()}
          >
            {accepting ? (
              <Loader2 className="size-3.5 animate-spin" />
            ) : (
              <Check className="size-3.5" />
            )}
            {accepting ? 'Creating…' : 'Accept & create'}
          </Button>
        </div>
      </div>
    </div>
  )
}
