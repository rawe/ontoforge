import type { RuntimeSchema } from '@/api/types'
import { NAVIGATOR_LIMITS } from '@/api/navigators'
import { TypeDot } from '@/components/TypeChip'
import { Checkbox } from '@/components/ui/checkbox'
import { Input } from '@/components/ui/input'
import { Label } from '@/components/ui/label'
import { Switch } from '@/components/ui/switch'
import { Textarea } from '@/components/ui/textarea'
import { cn } from '@/lib/utils'
import type { DraftField, NavigatorDraft } from './navigatorDraft'

interface NavigatorEditorProps {
  draft: NavigatorDraft
  onChange: (patch: Partial<NavigatorDraft>) => void
  schema: RuntimeSchema
  problems: Partial<Record<DraftField, string>>
  disabled: boolean
}

const HOPS = [1, 2, 3] as const
const HOP_TEXT: Record<number, string> = {
  1: 'Only the anchors’ direct neighbours.',
  2: 'Neighbours, and their neighbours.',
  3: 'Up to three relations away — broad, and slower on dense data.',
}

/** The navigator's configuration: how far it walks, along which relations, from which anchors, and how it answers. */
export function NavigatorEditor({ draft, onChange, schema, problems, disabled }: NavigatorEditorProps) {
  const typeName = (key: string) => schema.entityTypes.find((t) => t.key === key)?.displayName ?? key
  return (
    <>
      <section className="grid gap-4 rounded-xl border bg-card p-4">
        <h3 className="text-[13px] font-semibold">Walk</h3>
        <div className="grid gap-1.5">
          <Label id="navigator-hops">Hops</Label>
          <div role="radiogroup" aria-labelledby="navigator-hops" className="inline-flex w-fit rounded-md border p-0.5 text-xs">
            {HOPS.map((hops) => (
              <button
                key={hops}
                type="button"
                role="radio"
                aria-checked={draft.hops === hops}
                disabled={disabled}
                onClick={() => onChange({ hops })}
                className={cn('w-9 rounded py-0.5 tabular-nums', draft.hops === hops ? 'bg-muted font-medium' : 'text-muted-foreground hover:text-foreground')}
              >
                {hops}
              </button>
            ))}
          </div>
          <p className="text-xs text-muted-foreground">How far the walk goes from an anchor. {HOP_TEXT[draft.hops]}</p>
        </div>
        <TypeChecklist
          id="navigator-relations"
          label="Relation types"
          help="The relations the walk may follow."
          allLabel="Every relation type the lens shows"
          options={schema.relationTypes.map((r) => ({
            key: r.key,
            name: r.displayName,
            detail: `${typeName(r.fromEntityTypeKey)} → ${typeName(r.toEntityTypeKey)}`,
          }))}
          value={draft.relationTypes}
          onChange={(relationTypes) => onChange({ relationTypes })}
          error={problems.relationTypes}
          disabled={disabled}
        />
        <TypeChecklist
          id="navigator-anchors"
          label="Anchor types"
          help="The entity types a name in the question may resolve to — where the walk starts."
          allLabel="Every entity type the lens shows"
          options={schema.entityTypes.map((t) => ({ key: t.key, name: t.displayName, typeKey: t.key }))}
          value={draft.anchorTypes}
          onChange={(anchorTypes) => onChange({ anchorTypes })}
          error={problems.anchorTypes}
          disabled={disabled}
        />
      </section>

      <section className="grid gap-4 rounded-xl border bg-card p-4">
        <h3 className="text-[13px] font-semibold">Answer</h3>
        <div className="grid gap-1.5">
          <Label htmlFor="navigator-max">Evidence cards</Label>
          <Input
            id="navigator-max"
            type="number"
            inputMode="numeric"
            min={NAVIGATOR_LIMITS.maxEntities.min}
            max={NAVIGATOR_LIMITS.maxEntities.max}
            step={1}
            value={draft.maxEntities}
            disabled={disabled}
            onChange={(e) => onChange({ maxEntities: e.target.value })}
            aria-invalid={problems.maxEntities !== undefined}
            className={cn('w-28 tabular-nums', problems.maxEntities !== undefined && 'border-destructive')}
          />
          {problems.maxEntities !== undefined
            ? <p className="text-xs text-destructive">{problems.maxEntities}</p>
            : <p className="text-xs text-muted-foreground">At most this many entities are handed to the answer model ({NAVIGATOR_LIMITS.maxEntities.min}–{NAVIGATOR_LIMITS.maxEntities.max}). More cards, more context, slower answers.</p>}
        </div>
        <div className="grid gap-1.5">
          <Label htmlFor="navigator-instructions">Instructions</Label>
          <Textarea
            id="navigator-instructions"
            rows={4}
            maxLength={NAVIGATOR_LIMITS.instructions}
            value={draft.instructions}
            disabled={disabled}
            onChange={(e) => onChange({ instructions: e.target.value })}
            placeholder="Answer in short bullet points. Name the project for every person."
          />
          {problems.instructions !== undefined
            ? <p className="text-xs text-destructive">{problems.instructions}</p>
            : <p className="text-xs text-muted-foreground">Optional guidance for the answer: tone, focus, format.</p>}
        </div>
      </section>
    </>
  )
}

interface ChecklistOption {
  key: string
  name: string
  detail?: string
  /** Shows the entity type's color dot. */
  typeKey?: string
}

/** A list of type keys, or null for all: an "all" switch, and checkboxes when it is off. */
function TypeChecklist({ id, label, help, allLabel, options, value, onChange, error, disabled }: {
  id: string
  label: string
  help: string
  allLabel: string
  options: ChecklistOption[]
  value: string[] | null
  onChange: (value: string[] | null) => void
  error: string | undefined
  disabled: boolean
}) {
  // Keys the configuration names that the lens does not show: listed so they can be removed.
  const missing = (value ?? []).filter((key) => !options.some((o) => o.key === key))
  const items: (ChecklistOption & { missing: boolean })[] = [
    ...options.map((o) => ({ ...o, missing: false })),
    ...missing.map((key) => ({ key, name: key, missing: true })),
  ]
  const toggle = (key: string, checked: boolean) =>
    onChange(checked ? [...(value ?? []), key] : (value ?? []).filter((k) => k !== key))
  return (
    <div className="grid gap-2">
      <Label id={id}>{label}</Label>
      <p className="-mt-1 text-xs text-muted-foreground">{help}</p>
      <label className="flex w-fit items-center gap-2 text-[13px]">
        <Switch
          checked={value === null}
          disabled={disabled}
          // Off: start from every type, so narrowing down is unchecking a few.
          onCheckedChange={(all) => onChange(all ? null : options.map((o) => o.key))}
        />
        {allLabel}
      </label>
      {value !== null && (
        <div role="group" aria-labelledby={id} className="grid max-h-64 gap-1.5 overflow-y-auto rounded-lg border p-3 sm:grid-cols-2">
          {items.map((option) => (
            <label key={option.key} className="flex min-w-0 items-start gap-2 text-[13px]">
              <Checkbox
                className="mt-0.5"
                checked={value.includes(option.key)}
                disabled={disabled}
                onCheckedChange={(checked) => toggle(option.key, checked === true)}
              />
              <span className="min-w-0">
                <span className="flex items-center gap-1.5">
                  {option.typeKey !== undefined && <TypeDot typeKey={option.typeKey} />}
                  <span className={cn('truncate', option.missing && 'font-mono text-xs text-destructive')}>{option.name}</span>
                </span>
                {option.missing
                  ? <span className="block text-[11px] text-destructive">Not in this lens — uncheck it</span>
                  : option.detail !== undefined && <span className="block truncate text-[11px] text-muted-foreground">{option.detail}</span>}
              </span>
            </label>
          ))}
          {items.length === 0 && <p className="text-xs text-muted-foreground">This lens shows none.</p>}
        </div>
      )}
      {error !== undefined && <p className="text-xs text-destructive">{error}</p>}
    </div>
  )
}
