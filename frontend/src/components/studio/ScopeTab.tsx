import { useRef, useState } from 'react'
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import { ArrowRight, ChevronDown, ChevronRight, Globe, ShieldCheck } from 'lucide-react'
import * as model from '@/api/model'
import { useLensScope, useRuntimeSchema } from '@/api/hooks'
import { qk } from '@/api/queryKeys'
import type {
  EntityType,
  Lens,
  RelationType,
  ScopeInclude,
  ValidationResult,
} from '@/api/types'
import { TypeChip, TypeDot } from '@/components/TypeChip'
import { Badge } from '@/components/ui/badge'
import { Button } from '@/components/ui/button'
import { Checkbox } from '@/components/ui/checkbox'
import { RadioGroup, RadioGroupItem } from '@/components/ui/radio-group'
import { Skeleton } from '@/components/ui/skeleton'
import { ValidationPanel } from './ValidationPanel'
import { toastError } from './lib'

type Kind = 'entity-types' | 'relation-types'

const scopeApi = {
  'entity-types': {
    add: model.addScopeEntityType,
    update: model.updateScopeEntityType,
    remove: model.removeScopeEntityType,
  },
  'relation-types': {
    add: model.addScopeRelationType,
    update: model.updateScopeRelationType,
    remove: model.removeScopeRelationType,
  },
} as const

interface RowType {
  typeId: string
  key: string
  displayName: string
  source?: string
  target?: string
}

/** Per-property scope editor shown when an included type row is expanded. */
function PropertyScopeEditor({
  kind,
  lensId,
  type,
  include,
  onInvalidate,
}: {
  kind: Kind
  lensId: string
  type: RowType
  include: ScopeInclude
  onInvalidate: () => void
}) {
  const propertiesQuery = useQuery({
    queryKey: qk.model(kind, type.typeId, 'properties'),
    queryFn: () => model.listProperties(kind, type.typeId),
  })
  const properties = propertiesQuery.data

  const update = useMutation({
    mutationFn: (properties: string[] | null) =>
      scopeApi[kind].update(lensId, type.typeId, { key: type.key, properties }),
    onSuccess: onInvalidate,
    onError: toastError,
  })

  if (properties === undefined) {
    return <Skeleton className="ml-7 h-16 rounded-lg" />
  }

  const lockedKeys = properties
    .filter((p) => p.required && p.defaultValue === null)
    .map((p) => p.key)
  const explicit = include.properties !== null
  const selected = new Set([...(include.properties ?? []), ...lockedKeys])

  const toggleProperty = (key: string, checked: boolean) => {
    const next = new Set(selected)
    if (checked) next.add(key)
    else next.delete(key)
    update.mutate([...next])
  }

  return (
    <div className="mb-1 ml-7 rounded-lg border bg-muted/30 p-3">
      <RadioGroup
        value={explicit ? 'explicit' : 'all'}
        onValueChange={(v) => {
          if (v === 'all') update.mutate(null)
          else update.mutate([...new Set([...properties.map((p) => p.key)])])
        }}
        className="gap-1.5"
      >
        <label className="flex items-center gap-2 text-[13px]">
          <RadioGroupItem value="all" id={`${type.typeId}-all`} />
          All properties
        </label>
        <label className="flex items-center gap-2 text-[13px]">
          <RadioGroupItem value="explicit" id={`${type.typeId}-explicit`} />
          Explicit selection
        </label>
      </RadioGroup>
      {explicit && (
        <div className="mt-2 space-y-1 border-t pt-2">
          {properties.length === 0 && (
            <p className="text-xs text-muted-foreground">This type has no properties.</p>
          )}
          {properties.map((p) => {
            const locked = lockedKeys.includes(p.key)
            return (
              <label
                key={p.propertyId}
                className="flex items-center gap-2 text-[13px]"
                title={locked ? 'Required without default — always included' : undefined}
              >
                <Checkbox
                  checked={selected.has(p.key)}
                  disabled={locked || update.isPending}
                  onCheckedChange={(checked) => toggleProperty(p.key, checked === true)}
                />
                <span className="font-mono text-xs">{p.key}</span>
                <span className="text-muted-foreground">{p.displayName}</span>
                {locked && (
                  <Badge variant="secondary" className="ml-auto text-[10px]">
                    required — locked
                  </Badge>
                )}
              </label>
            )
          })}
        </div>
      )}
    </div>
  )
}

/** One type row in the scope checklist. */
function ScopeRow({
  kind,
  lensId,
  type,
  include,
  onInvalidate,
}: {
  kind: Kind
  lensId: string
  type: RowType
  include: ScopeInclude | undefined
  onInvalidate: () => void
}) {
  const [expanded, setExpanded] = useState(false)
  const included = include !== undefined

  const toggle = useMutation({
    mutationFn: (checked: boolean) =>
      checked
        ? scopeApi[kind].add(lensId, { key: type.key, properties: null })
        : scopeApi[kind].remove(lensId, type.typeId),
    onSuccess: onInvalidate,
    onError: toastError,
  })

  return (
    <div>
      <div className="flex h-9 items-center gap-2 rounded-md px-1.5 hover:bg-muted/50">
        <Checkbox
          checked={included}
          disabled={toggle.isPending}
          onCheckedChange={(checked) => toggle.mutate(checked === true)}
          aria-label={`Include ${type.displayName}`}
        />
        <button
          type="button"
          className="flex min-w-0 flex-1 items-center gap-2 text-left"
          onClick={() => included && setExpanded((e) => !e)}
          disabled={!included}
          aria-expanded={expanded}
        >
          <TypeChip typeKey={type.key} displayName={type.displayName} size="sm" />
          {type.source !== undefined && type.target !== undefined && (
            <span className="flex items-center gap-1 text-[11px] text-muted-foreground">
              <TypeDot typeKey={type.source} />
              <span className="font-mono">{type.source}</span>
              <ArrowRight className="size-3 opacity-60" />
              <TypeDot typeKey={type.target} />
              <span className="font-mono">{type.target}</span>
            </span>
          )}
          {included && include.properties !== null && (
            <Badge variant="secondary" className="text-[10px]">
              {include.properties.length} props
            </Badge>
          )}
          {included && (
            <span className="ml-auto text-muted-foreground">
              {expanded ? (
                <ChevronDown className="size-3.5" />
              ) : (
                <ChevronRight className="size-3.5" />
              )}
            </span>
          )}
        </button>
      </div>
      {included && expanded && (
        <PropertyScopeEditor
          kind={kind}
          lensId={lensId}
          type={type}
          include={include}
          onInvalidate={onInvalidate}
        />
      )}
    </div>
  )
}

/** Live preview of what the lens exposes — rendered from the runtime schema. */
function LensPreview({ lensKey }: { lensKey: string }) {
  const { data: schema, isPending, isFetching } = useRuntimeSchema(lensKey)

  return (
    <div className="rounded-xl border bg-card p-4">
      <div className="mb-3 flex items-center gap-2">
        <h3 className="text-[13px] font-semibold">Lens preview</h3>
        <span className="text-[11px] text-muted-foreground">
          what this lens exposes at runtime
        </span>
        {isFetching && !isPending && (
          <span className="ml-auto size-2 animate-pulse rounded-full bg-primary" aria-label="Refreshing" />
        )}
      </div>
      {isPending && <Skeleton className="h-40 rounded-lg" />}
      {schema !== undefined && (
        <div className="space-y-4">
          <div>
            <h4 className="mb-1.5 text-[11px] font-medium uppercase tracking-wider text-muted-foreground">
              Entity types ({schema.entityTypes.length})
            </h4>
            <div className="space-y-2">
              {schema.entityTypes.map((t) => (
                <div key={t.key} className="rounded-lg border px-2.5 py-1.5">
                  <TypeChip typeKey={t.key} displayName={t.displayName} size="sm" />
                  <div className="mt-1 flex flex-wrap gap-x-2 gap-y-0.5">
                    {t.properties.length === 0 && (
                      <span className="text-[11px] text-muted-foreground">no properties</span>
                    )}
                    {t.properties.map((p) => (
                      <span key={p.key} className="font-mono text-[11px] text-muted-foreground">
                        {p.key}
                        {p.required && <span className="text-destructive">*</span>}
                      </span>
                    ))}
                  </div>
                </div>
              ))}
              {schema.entityTypes.length === 0 && (
                <p className="text-[12px] text-muted-foreground">No entity types exposed.</p>
              )}
            </div>
          </div>
          <div>
            <h4 className="mb-1.5 text-[11px] font-medium uppercase tracking-wider text-muted-foreground">
              Relation types ({schema.relationTypes.length})
            </h4>
            <div className="space-y-2">
              {schema.relationTypes.map((t) => (
                <div key={t.key} className="rounded-lg border px-2.5 py-1.5">
                  <div className="flex flex-wrap items-center gap-2">
                    <TypeChip typeKey={t.key} displayName={t.displayName} size="sm" />
                    <span className="flex items-center gap-1 text-[11px] text-muted-foreground">
                      <TypeDot typeKey={t.fromEntityTypeKey} />
                      <span className="font-mono">{t.fromEntityTypeKey}</span>
                      <ArrowRight className="size-3 opacity-60" />
                      <TypeDot typeKey={t.toEntityTypeKey} />
                      <span className="font-mono">{t.toEntityTypeKey}</span>
                    </span>
                  </div>
                  {t.properties.length > 0 && (
                    <div className="mt-1 flex flex-wrap gap-x-2 gap-y-0.5">
                      {t.properties.map((p) => (
                        <span key={p.key} className="font-mono text-[11px] text-muted-foreground">
                          {p.key}
                        </span>
                      ))}
                    </div>
                  )}
                </div>
              ))}
              {schema.relationTypes.length === 0 && (
                <p className="text-[12px] text-muted-foreground">No relation types exposed.</p>
              )}
            </div>
          </div>
        </div>
      )}
    </div>
  )
}

/** Scope editor tab: checklists of all global types + live lens preview. */
export function ScopeTab({ lens }: { lens: Lens }) {
  const queryClient = useQueryClient()
  const [validation, setValidation] = useState<ValidationResult | null>(null)
  const listRef = useRef<HTMLDivElement>(null)

  const entityTypesQuery = useQuery({
    queryKey: qk.model('entity-types'),
    queryFn: model.listEntityTypes,
  })
  const relationTypesQuery = useQuery({
    queryKey: qk.model('relation-types'),
    queryFn: model.listRelationTypes,
  })
  const scope = useLensScope(lens.lensId)

  const invalidate = () => {
    void queryClient.invalidateQueries({
      queryKey: qk.model('lenses', lens.lensId, 'includes'),
    })
    void queryClient.invalidateQueries({ queryKey: ['schema'] })
  }

  const validate = useMutation({
    mutationFn: () => model.validateLens(lens.lensId),
    onSuccess: setValidation,
    onError: toastError,
  })

  const loading =
    entityTypesQuery.isPending || relationTypesQuery.isPending || scope.isPending

  if (loading) {
    return (
      <div className="grid gap-6 lg:grid-cols-2">
        <Skeleton className="h-64 rounded-xl" />
        <Skeleton className="h-64 rounded-xl" />
      </div>
    )
  }

  const entityRows: RowType[] = (entityTypesQuery.data ?? []).map((t: EntityType) => ({
    typeId: t.entityTypeId,
    key: t.key,
    displayName: t.displayName,
  }))
  const relationRows: RowType[] = (relationTypesQuery.data ?? []).map((t: RelationType) => ({
    typeId: t.relationTypeId,
    key: t.key,
    displayName: t.displayName,
    source: t.sourceEntityTypeKey,
    target: t.targetEntityTypeKey,
  }))
  const entityIncludes = new Map(
    (scope.data?.entityTypes ?? []).map((i) => [i.key, i] as const),
  )
  const relationIncludes = new Map(
    (scope.data?.relationTypes ?? []).map((i) => [i.key, i] as const),
  )
  const unscoped = scope.data !== undefined && !scope.data.scoped

  return (
    <div className="space-y-4">
      {validation !== null && (
        <ValidationPanel result={validation} onDismiss={() => setValidation(null)} />
      )}
      {unscoped && (
        <div className="flex items-center gap-3 rounded-xl border border-primary/30 bg-primary/5 p-4">
          <Globe className="size-5 shrink-0 text-primary" />
          <div className="min-w-0 flex-1">
            <p className="text-[13px] font-medium">
              Unscoped — this lens exposes the full schema
            </p>
            <p className="text-[12px] text-muted-foreground">
              Every entity and relation type is visible. Check any type below to start
              scoping; only checked types will remain visible.
            </p>
          </div>
          <Button
            variant="outline"
            size="sm"
            onClick={() =>
              listRef.current?.querySelector<HTMLButtonElement>('[role="checkbox"]')?.focus()
            }
          >
            Start scoping
          </Button>
        </div>
      )}
      <div className="grid items-start gap-6 lg:grid-cols-2">
        <div ref={listRef} className="space-y-5">
          <div className="flex items-center gap-2">
            <h3 className="text-[13px] font-semibold">Included types</h3>
            <Button
              variant="outline"
              size="sm"
              className="ml-auto"
              onClick={() => validate.mutate()}
              disabled={validate.isPending}
            >
              <ShieldCheck className="size-3.5" />
              {validate.isPending ? 'Validating…' : 'Validate lens'}
            </Button>
          </div>
          <section>
            <h4 className="mb-1 text-[11px] font-medium uppercase tracking-wider text-muted-foreground">
              Entity types
            </h4>
            {entityRows.map((t) => (
              <ScopeRow
                key={t.typeId}
                kind="entity-types"
                lensId={lens.lensId}
                type={t}
                include={entityIncludes.get(t.key)}
                onInvalidate={invalidate}
              />
            ))}
            {entityRows.length === 0 && (
              <p className="text-[12px] text-muted-foreground">No global entity types.</p>
            )}
          </section>
          <section>
            <h4 className="mb-1 text-[11px] font-medium uppercase tracking-wider text-muted-foreground">
              Relation types
            </h4>
            {relationRows.map((t) => (
              <ScopeRow
                key={t.typeId}
                kind="relation-types"
                lensId={lens.lensId}
                type={t}
                include={relationIncludes.get(t.key)}
                onInvalidate={invalidate}
              />
            ))}
            {relationRows.length === 0 && (
              <p className="text-[12px] text-muted-foreground">No global relation types.</p>
            )}
          </section>
          <p className="text-[11px] text-muted-foreground">
            A relation type is only usable at runtime when its source and target entity
            types are also in scope — run Validate to check.
          </p>
        </div>
        <LensPreview lensKey={lens.key} />
      </div>
    </div>
  )
}
