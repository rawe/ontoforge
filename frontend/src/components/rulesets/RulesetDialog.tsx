import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import {
  Anchor as AnchorIcon,
  ChevronLeft,
  EyeOff,
  ListTree,
  Loader2,
  PencilLine,
  TriangleAlert,
  type LucideIcon,
} from 'lucide-react'
import { useMemo, useState, type ReactNode } from 'react'
import { toast } from 'sonner'
import { useDisplayLabel } from '@/api/hooks'
import { ApiError } from '@/api/http'
import { qk } from '@/api/queryKeys'
import * as runtime from '@/api/runtime'
import type {
  EntityInstance,
  PathStep,
  Ruleset,
  SchemaEntityType,
  SchemaRelationType,
  WriteAccess,
} from '@/api/types'
import { TypeChip, TypeDot } from '@/components/TypeChip'
import { EntityTargetPicker } from '@/components/entity/EntityTargetPicker'
import { formatPath, stepLabel } from '@/components/entity/hierarchy'
import { WriteAccessChip } from '@/components/rulesets/WriteAccessChip'
import {
  anchorPlacement,
  DEFAULT_RULES,
  loosenedRules,
  rulesetKeyProblem,
  rulesetPatch,
  WRITE_ACCESS_LEVELS,
  type RuleValues,
} from '@/components/rulesets/rulesets'
import { Button } from '@/components/ui/button'
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from '@/components/ui/dialog'
import { Input } from '@/components/ui/input'
import { Label } from '@/components/ui/label'
import { RadioGroup, RadioGroupItem } from '@/components/ui/radio-group'
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@/components/ui/select'
import { cn } from '@/lib/utils'

/** What the dialog does: create a new ruleset, or edit an existing one's rules. */
export type RulesetDialogTarget = { mode: 'create' } | { mode: 'edit'; ruleset: Ruleset }

interface RulesetDialogProps {
  ontologyKey: string
  lensKey: string
  entityTypes: readonly SchemaEntityType[]
  relationTypes: readonly SchemaRelationType[]
  existingKeys: readonly string[]
  target: RulesetDialogTarget | null
  onClose: () => void
}

export function RulesetDialog({ target, onClose, ...rest }: RulesetDialogProps) {
  return (
    <Dialog open={target !== null} onOpenChange={(open) => !open && onClose()}>
      {target !== null && <RulesetFlow target={target} onClose={onClose} {...rest} />}
    </Dialog>
  )
}

/** One entity's path through the lens. */
function usePath(ontologyKey: string, lensKey: string, entity: EntityInstance | null) {
  return useQuery({
    queryKey: qk.path(ontologyKey, lensKey, entity?._entityTypeKey ?? '', entity?._id ?? ''),
    queryFn: () => runtime.getPath(ontologyKey, lensKey, entity!._entityTypeKey, entity!._id),
    enabled: entity !== null,
  })
}

/** A path as one violet line, from the root's child on; a root has none. */
function PathText({ path, icon = false }: { path: readonly PathStep[] | undefined; icon?: boolean }) {
  if (path === undefined || path.length < 2) return null
  return (
    <span className="flex min-w-0 items-center gap-1 text-[11px] font-medium text-(--tc-violet)">
      {icon && <ListTree className="size-3 shrink-0" />}
      <span className="truncate">{formatPath(path)}</span>
    </span>
  )
}

function PathLine({
  ontologyKey,
  lensKey,
  entity,
  icon,
}: {
  ontologyKey: string
  lensKey: string
  entity: EntityInstance
  icon?: boolean
}) {
  const path = usePath(ontologyKey, lensKey, entity)
  return <PathText path={path.data} icon={icon} />
}

/** The first type that is a parent end, else the first type: where anchors usually point. */
function defaultTypeKey(
  entityTypes: readonly SchemaEntityType[],
  relationTypes: readonly SchemaRelationType[],
): string {
  const parentEnds = new Set(
    relationTypes.flatMap((rt) =>
      rt.parent === null ? [] : [rt.parent === 'source' ? rt.fromEntityTypeKey : rt.toEntityTypeKey],
    ),
  )
  return (entityTypes.find((t) => parentEnds.has(t.key)) ?? entityTypes[0])?.key ?? ''
}

/** One rule of the ruleset: its icon, title and help line above its control. */
function RuleSection({
  icon: Icon,
  title,
  optional = false,
  help,
  children,
}: {
  icon: LucideIcon
  title: string
  optional?: boolean
  help: string
  children: ReactNode
}) {
  return (
    <section className="grid gap-2 border-t pt-4 first:border-t-0 first:pt-0">
      <div className="grid gap-0.5">
        <h3 className="flex items-center gap-1.5 text-[13px] font-medium">
          <Icon className="size-3.5 text-muted-foreground" />
          {title}
          {optional && <span className="font-normal text-muted-foreground">(optional)</span>}
        </h3>
        <p className="text-xs text-muted-foreground">{help}</p>
      </div>
      {children}
    </section>
  )
}

/** A checked radio card or line: the kit's radio item carries `data-state="checked"`. */
const CHECKED_CARD = 'has-[[data-state=checked]]:border-primary has-[[data-state=checked]]:bg-primary/5'

/** The picked entity's card: name, type, "Change", its path, and what the anchor covers. */
function AnchorCard({
  label,
  typeChip,
  path,
  tone = 'plain',
  icon: Icon,
  disabled,
  onChange,
}: {
  label: string
  typeChip?: ReactNode
  path?: ReactNode
  tone?: 'plain' | 'bad' | 'muted'
  icon?: LucideIcon
  disabled: boolean
  onChange: () => void
}) {
  return (
    <div className="grid gap-1">
      <div
        className={cn(
          'flex items-center gap-2 rounded-lg border px-3 py-2',
          tone === 'bad' && 'border-destructive bg-destructive/10',
        )}
      >
        <span className="flex min-w-0 flex-1 flex-col gap-0.5">
          <span
            className={cn(
              'flex min-w-0 items-center gap-2 text-[13px]',
              tone === 'bad' && 'text-destructive',
              tone === 'muted' && 'text-muted-foreground',
            )}
          >
            {Icon !== undefined && <Icon className="size-3.5 shrink-0" />}
            <span className={cn('truncate', tone === 'plain' && 'font-medium')}>{label}</span>
            {typeChip}
          </span>
          {path}
        </span>
        <Button type="button" variant="outline" size="xs" disabled={disabled} onClick={onChange}>
          Change
        </Button>
      </div>
      {tone === 'plain' && (
        <p className="text-[11px] text-muted-foreground">Covered: {label} and everything below it.</p>
      )}
    </div>
  )
}

function RulesetFlow({
  ontologyKey,
  lensKey,
  entityTypes,
  relationTypes,
  existingKeys,
  target,
  onClose,
}: Omit<RulesetDialogProps, 'target'> & { target: RulesetDialogTarget }) {
  const queryClient = useQueryClient()
  const displayLabel = useDisplayLabel()
  const creating = target.mode === 'create'
  const ruleset = target.mode === 'edit' ? target.ruleset : null
  // The anchor's name and path through the lens; the row has read it already.
  const view = useQuery({
    queryKey: qk.rulesets(ontologyKey, lensKey, ruleset?.key ?? ''),
    queryFn: () => runtime.getRulesetView(ontologyKey, lensKey, ruleset!.key),
    enabled: ruleset !== null,
  })

  const before: RuleValues =
    ruleset === null
      ? DEFAULT_RULES
      : {
          writeAccess: ruleset.writeAccess,
          anchor: ruleset.anchor === null ? null : { type: ruleset.anchor.type, id: ruleset.anchor.id },
        }

  const [key, setKey] = useState('')
  const [keyTouched, setKeyTouched] = useState(false)
  const [writeAccess, setWriteAccess] = useState<WriteAccess>(before.writeAccess)
  const [anchorMode, setAnchorMode] = useState<'none' | 'entity'>(before.anchor === null ? 'none' : 'entity')
  // Edit starts at the stored anchor; "Change" swaps it for the picker.
  const [keepCurrent, setKeepCurrent] = useState(before.anchor !== null)
  const [typeKey, setTypeKey] = useState(() => {
    const current = before.anchor?.type
    return current !== undefined && entityTypes.some((t) => t.key === current)
      ? current
      : defaultTypeKey(entityTypes, relationTypes)
  })
  const [query, setQuery] = useState('')
  const [picked, setPicked] = useState<EntityInstance | null>(null)
  const [confirming, setConfirming] = useState(false)
  const [formError, setFormError] = useState<string | null>(null)
  const [serverKeyError, setServerKeyError] = useState<string | null>(null)

  const pickedPath = usePath(ontologyKey, lensKey, picked)
  const type = entityTypes.find((t) => t.key === typeKey)
  const typeName = (k: string) => entityTypes.find((t) => t.key === k)?.displayName ?? k

  const rulesetKey = creating ? key : ruleset!.key
  const keyProblem = useMemo(
    () => (creating ? rulesetKeyProblem(key, existingKeys) : null),
    [creating, key, existingKeys],
  )
  const keyError = (keyTouched ? keyProblem : null) ?? serverKeyError

  // The chosen anchor; undefined while "An entity" has none picked yet.
  const anchor: RuleValues['anchor'] | undefined =
    anchorMode === 'none'
      ? null
      : keepCurrent
        ? before.anchor
        : picked === null
          ? undefined
          : { type: picked._entityTypeKey, id: picked._id }
  const patch = anchor === undefined ? null : rulesetPatch(before, { writeAccess, anchor })
  const loosened =
    ruleset === null || patch === null
      ? []
      : loosenedRules(ruleset, patch, {
          lensKey,
          fromPath: view.data?.anchor?.path ?? [],
          toPath: pickedPath.data ?? [],
        })

  const save = useMutation({
    mutationFn: () => runtime.putRuleset(ontologyKey, rulesetKey, patch!),
    onSuccess: (saved) => {
      void queryClient.invalidateQueries({ queryKey: qk.rulesets(ontologyKey) })
      toast.success(creating ? `${saved.key} created` : `${saved.key} saved`)
      onClose()
    },
    onError: (err) => {
      setConfirming(false)
      if (err instanceof ApiError) {
        const fields = err.fieldErrors
        if (fields !== undefined) setFormError(Object.values(fields).join(' · '))
        else if (creating && err.status === 422) setServerKeyError(err.message)
        else setFormError(err.message)
      } else {
        setFormError(err instanceof Error ? err.message : 'Failed to save the ruleset')
      }
    },
  })

  // Whether a save loosens is known once both paths are read.
  const pathsLoading =
    !creating && patch?.anchor != null && (pickedPath.data === undefined || view.data === undefined)
  const ready =
    (creating ? keyProblem === null : true) &&
    patch !== null &&
    (creating || Object.keys(patch).length > 0) &&
    !pathsLoading

  const submit = () => {
    setKeyTouched(true)
    setFormError(null)
    if (!ready || save.isPending) return
    if (loosened.length > 0 && !confirming) {
      setConfirming(true)
      return
    }
    save.mutate()
  }

  if (confirming) {
    return (
      <DialogContent className="sm:max-w-md">
        <DialogHeader>
          <DialogTitle>Save the new rules for {rulesetKey}?</DialogTitle>
          <DialogDescription className="sr-only">The rules this save loosens.</DialogDescription>
        </DialogHeader>
        <ul className="grid gap-2 text-[13px]">
          {loosened.map((line) => (
            <li key={line.rule}>
              <span className="font-medium">{line.rule}:</span> {line.text}
            </li>
          ))}
        </ul>
        {formError !== null && <p className="text-[13px] text-destructive">{formError}</p>}
        <DialogFooter className="gap-2 sm:justify-between">
          <Button variant="ghost" size="sm" disabled={save.isPending} onClick={() => setConfirming(false)}>
            <ChevronLeft className="size-3.5" /> Back
          </Button>
          <div className="flex gap-2">
            <Button variant="outline" size="sm" disabled={save.isPending} onClick={onClose}>
              Cancel
            </Button>
            <Button size="sm" disabled={save.isPending} onClick={submit}>
              {save.isPending && <Loader2 className="size-3.5 animate-spin" />}
              Save
            </Button>
          </div>
        </DialogFooter>
      </DialogContent>
    )
  }

  const change = () => {
    setKeepCurrent(false)
    setPicked(null)
    setFormError(null)
  }

  const currentCard = () => {
    const placement = anchorPlacement(ruleset!, view.data, typeName)
    const seen = view.data?.anchor
    if (placement.kind === 'path' && seen?.type != null && seen.id !== null) {
      return (
        <AnchorCard
          label={stepLabel({ type: seen.type, id: seen.id, name: seen.name })}
          typeChip={<TypeChip typeKey={seen.type} displayName={typeName(seen.type)} size="sm" />}
          path={<PathText path={seen.path} icon />}
          disabled={save.isPending}
          onChange={change}
        />
      )
    }
    return (
      <AnchorCard
        label={placement.primary}
        tone={placement.kind === 'deleted' ? 'bad' : 'muted'}
        icon={placement.kind === 'deleted' ? TriangleAlert : placement.kind === 'hidden' ? EyeOff : undefined}
        disabled={save.isPending}
        onChange={change}
      />
    )
  }

  const entityChoice =
    keepCurrent && ruleset?.anchor != null ? (
      currentCard()
    ) : picked !== null ? (
      <AnchorCard
        label={displayLabel(picked)}
        typeChip={
          <TypeChip typeKey={picked._entityTypeKey} displayName={typeName(picked._entityTypeKey)} size="sm" />
        }
        path={<PathLine ontologyKey={ontologyKey} lensKey={lensKey} entity={picked} icon />}
        disabled={save.isPending}
        onChange={change}
      />
    ) : (
      <div className="space-y-2">
        <Select
          value={typeKey}
          onValueChange={(value) => {
            setTypeKey(value)
            setQuery('')
          }}
        >
          <SelectTrigger aria-label="Entity type" className="w-full">
            <SelectValue placeholder="Select type…" />
          </SelectTrigger>
          <SelectContent>
            {entityTypes.map((t) => (
              <SelectItem key={t.key} value={t.key}>
                <span className="flex items-center gap-2">
                  <TypeDot typeKey={t.key} />
                  {t.displayName}
                </span>
              </SelectItem>
            ))}
          </SelectContent>
        </Select>
        {type !== undefined && (
          <EntityTargetPicker
            key={type.key}
            ontologyKey={ontologyKey}
            lensKey={lensKey}
            targetType={type}
            query={query}
            onQueryChange={setQuery}
            autoFocus={!creating}
            onPick={(entity) => {
              setFormError(null)
              setPicked(entity)
            }}
            detail={(entity) => <PathLine ontologyKey={ontologyKey} lensKey={lensKey} entity={entity} />}
          />
        )}
      </div>
    )

  return (
    <DialogContent className="sm:max-w-lg">
      <DialogHeader>
        <DialogTitle>{creating ? 'New ruleset' : `Edit ${rulesetKey}`}</DialogTitle>
        <DialogDescription>
          {creating
            ? "An AI client's own MCP URL, with rules it must follow."
            : "The client's next call follows the new rules."}
        </DialogDescription>
      </DialogHeader>

      <form
        className="space-y-4"
        onSubmit={(e) => {
          e.preventDefault()
          submit()
        }}
      >
        <div className="grid gap-4">
          {creating && (
            <div className="grid gap-1.5">
              <Label htmlFor="ruleset-key">Key</Label>
              <Input
                id="ruleset-key"
                value={key}
                autoFocus
                spellCheck={false}
                autoComplete="off"
                placeholder="agent-a"
                className={cn('font-mono', keyError !== null && 'border-destructive')}
                aria-invalid={keyError !== null}
                onChange={(e) => {
                  setKey(e.target.value)
                  setKeyTouched(e.target.value !== '')
                  setServerKeyError(null)
                }}
              />
              {keyError !== null && <p className="text-xs text-destructive">{keyError}</p>}
              <p className="text-xs text-muted-foreground">Part of the MCP URL. Cannot be renamed.</p>
            </div>
          )}

          <RuleSection icon={PencilLine} title="Write access" help="What the client may do.">
            <RadioGroup
              value={writeAccess}
              onValueChange={(value) => setWriteAccess(value as WriteAccess)}
              aria-label="Write access"
              className="gap-2"
            >
              {WRITE_ACCESS_LEVELS.map((level) => (
                <label
                  key={level.level}
                  className={cn(
                    'flex cursor-pointer items-start gap-3 rounded-lg border px-3 py-2.5',
                    CHECKED_CARD,
                  )}
                >
                  <RadioGroupItem value={level.level} className="mt-0.5" />
                  <span className="grid min-w-0 flex-1 gap-1">
                    <span className="flex items-center gap-2 text-[13px] font-medium">
                      <WriteAccessChip level={level.level} />
                      {level.title}
                      {level.level === DEFAULT_RULES.writeAccess && (
                        <span className="ml-auto text-[11px] font-normal text-muted-foreground">Default</span>
                      )}
                    </span>
                    <span className="text-xs text-muted-foreground">{level.line}</span>
                  </span>
                </label>
              ))}
            </RadioGroup>
          </RuleSection>

          <RuleSection
            icon={AnchorIcon}
            title="Anchor"
            optional
            help="Where the client may write. Writes in the anchor's hierarchy stay in its subtree; other types are free."
          >
            <RadioGroup
              value={anchorMode}
              onValueChange={(value) => setAnchorMode(value as 'none' | 'entity')}
              aria-label="Anchor"
              className="gap-2"
            >
              <label className="flex items-center gap-2 text-[13px]">
                <RadioGroupItem value="none" />
                No anchor: no limit on where
              </label>
              <label className="flex items-center gap-2 text-[13px]">
                <RadioGroupItem value="entity" />
                An entity
              </label>
            </RadioGroup>
            {anchorMode === 'entity' && <div className="ml-6">{entityChoice}</div>}
          </RuleSection>
        </div>

        {formError !== null && <p className="text-[13px] text-destructive">{formError}</p>}

        <DialogFooter className="gap-2">
          <Button type="button" variant="outline" size="sm" disabled={save.isPending} onClick={onClose}>
            Cancel
          </Button>
          <Button type="submit" size="sm" disabled={!ready || save.isPending}>
            {save.isPending && <Loader2 className="size-3.5 animate-spin" />}
            {creating ? 'Create' : 'Save'}
          </Button>
        </DialogFooter>
      </form>
    </DialogContent>
  )
}
