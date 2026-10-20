import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import { ChevronLeft, Loader2 } from 'lucide-react'
import { useMemo, useState } from 'react'
import { toast } from 'sonner'
import { useDisplayLabel } from '@/api/hooks'
import { ApiError } from '@/api/http'
import { qk } from '@/api/queryKeys'
import * as runtime from '@/api/runtime'
import type { Anchor, EntityInstance, PathStep, SchemaEntityType, SchemaRelationType } from '@/api/types'
import { TypeChip, TypeDot } from '@/components/TypeChip'
import { anchorKeyProblem, repointConfirmation } from '@/components/anchors/anchors'
import { EntityTargetPicker } from '@/components/entity/EntityTargetPicker'
import { formatPath } from '@/components/entity/hierarchy'
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

/**
 * What the dialog does: create a new anchor, or point an existing one at an
 * entity — "Anchor…" (unanchored), Re-anchor (dangling) or Re-point
 * (anchored, which asks first, naming the old path).
 */
export type AnchorDialogTarget =
  | { mode: 'create' }
  | { mode: 'point'; anchor: Anchor; oldPath: readonly PathStep[] }

interface AnchorDialogProps {
  ontologyKey: string
  lensKey: string
  entityTypes: readonly SchemaEntityType[]
  relationTypes: readonly SchemaRelationType[]
  existingKeys: readonly string[]
  target: AnchorDialogTarget | null
  onClose: () => void
}

export function AnchorDialog({ target, onClose, ...rest }: AnchorDialogProps) {
  return (
    <Dialog open={target !== null} onOpenChange={(open) => !open && onClose()}>
      {target !== null && <AnchorFlow target={target} onClose={onClose} {...rest} />}
    </Dialog>
  )
}

/** One entity's path through the lens, as one muted line. */
function usePath(ontologyKey: string, lensKey: string, entity: EntityInstance | null) {
  return useQuery({
    queryKey: qk.path(ontologyKey, lensKey, entity?._entityTypeKey ?? '', entity?._id ?? ''),
    queryFn: () => runtime.getPath(ontologyKey, lensKey, entity!._entityTypeKey, entity!._id),
    enabled: entity !== null,
  })
}

function PathLine({
  ontologyKey,
  lensKey,
  entity,
}: {
  ontologyKey: string
  lensKey: string
  entity: EntityInstance
}) {
  const path = usePath(ontologyKey, lensKey, entity)
  if (path.data === undefined || path.data.length < 2) return null
  return (
    <span className="truncate text-[11px] font-medium text-(--tc-violet)">{formatPath(path.data)}</span>
  )
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

function AnchorFlow({
  ontologyKey,
  lensKey,
  entityTypes,
  relationTypes,
  existingKeys,
  target,
  onClose,
}: Omit<AnchorDialogProps, 'target'> & { target: AnchorDialogTarget }) {
  const queryClient = useQueryClient()
  const displayLabel = useDisplayLabel()
  const creating = target.mode === 'create'
  const anchor = target.mode === 'point' ? target.anchor : null

  const [key, setKey] = useState('')
  const [keyTouched, setKeyTouched] = useState(false)
  const [unanchored, setUnanchored] = useState(false)
  // Re-point and re-anchor start at the anchor's own type.
  const [typeKey, setTypeKey] = useState(() => {
    const current = anchor?.entity?.type
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

  const anchorKey = creating ? key : anchor!.key
  const keyProblem = useMemo(
    () => (creating ? anchorKeyProblem(key, existingKeys) : null),
    [creating, key, existingKeys],
  )
  const keyError = (keyTouched ? keyProblem : null) ?? serverKeyError

  const save = useMutation({
    mutationFn: () =>
      runtime.putAnchor(
        ontologyKey,
        anchorKey,
        unanchored || picked === null ? null : { type: picked._entityTypeKey, id: picked._id },
      ),
    onSuccess: (saved) => {
      void queryClient.invalidateQueries({ queryKey: qk.anchors(ontologyKey) })
      toast.success(
        saved.entity === null
          ? `${saved.key} created, unanchored`
          : `${saved.key} anchored at ${picked === null ? 'the entity' : displayLabel(picked)}`,
      )
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
        setFormError(err instanceof Error ? err.message : 'Failed to save the anchor')
      }
    },
  })

  const ready = (creating ? keyProblem === null : true) && (unanchored || picked !== null)
  const repoint = anchor?.state === 'anchored'

  const submit = () => {
    setKeyTouched(true)
    setFormError(null)
    if (!ready || save.isPending) return
    if (repoint && !confirming) {
      setConfirming(true)
      return
    }
    save.mutate()
  }

  const title = creating
    ? 'New anchor'
    : anchor!.state === 'anchored'
      ? `Re-point ${anchor!.key}`
      : anchor!.state === 'dangling'
        ? `Re-anchor ${anchor!.key}`
        : `Anchor ${anchor!.key}`
  const action = creating ? 'Create' : repoint ? 'Re-point' : 'Anchor'

  if (confirming && target.mode === 'point') {
    return (
      <DialogContent className="sm:max-w-md">
        <DialogHeader>
          <DialogTitle>{title}?</DialogTitle>
          <DialogDescription>
            {repointConfirmation(anchor!.key, target.oldPath, pickedPath.data ?? [])}
          </DialogDescription>
        </DialogHeader>
        {formError !== null && <p className="text-[13px] text-destructive">{formError}</p>}
        <DialogFooter className="gap-2 sm:justify-between">
          <Button variant="ghost" size="sm" disabled={save.isPending} onClick={() => setConfirming(false)}>
            <ChevronLeft className="size-3.5" /> Back
          </Button>
          <div className="flex gap-2">
            <Button variant="outline" size="sm" disabled={save.isPending} onClick={onClose}>
              Cancel
            </Button>
            <Button size="sm" disabled={save.isPending || pickedPath.data === undefined} onClick={submit}>
              {save.isPending && <Loader2 className="size-3.5 animate-spin" />}
              Re-point
            </Button>
          </div>
        </DialogFooter>
      </DialogContent>
    )
  }

  const entityChoice = (
    <div className="space-y-2">
      {picked !== null ? (
        <div className="flex items-center gap-2 rounded-lg border px-3 py-2">
          <span className="flex min-w-0 flex-1 flex-col gap-0.5">
            <span className="flex min-w-0 items-center gap-2 text-[13px]">
              <span className="truncate font-medium">{displayLabel(picked)}</span>
              <TypeChip typeKey={picked._entityTypeKey} displayName={typeName(picked._entityTypeKey)} size="sm" />
            </span>
            <PathLine ontologyKey={ontologyKey} lensKey={lensKey} entity={picked} />
          </span>
          <Button variant="ghost" size="xs" disabled={save.isPending} onClick={() => setPicked(null)}>
            Change
          </Button>
        </div>
      ) : (
        <>
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
        </>
      )}
    </div>
  )

  return (
    <DialogContent className="sm:max-w-md">
      <DialogHeader>
        <DialogTitle>{title}</DialogTitle>
        <DialogDescription>
          {creating
            ? "Hold an agent's writes in one entity's hierarchy to that entity and its descendants."
            : 'Its next call works under the entity you pick.'}
        </DialogDescription>
      </DialogHeader>

      <form
        className="space-y-4"
        onSubmit={(e) => {
          e.preventDefault()
          submit()
        }}
      >
        {creating && (
          <div className="grid gap-1.5">
            <Label htmlFor="anchor-key">Key</Label>
            <Input
              id="anchor-key"
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

        <div className="grid gap-1.5">
          <Label>Anchored at</Label>
          {creating ? (
            <RadioGroup
              value={unanchored ? 'none' : 'entity'}
              onValueChange={(value) => setUnanchored(value === 'none')}
              className="gap-2"
            >
              <label className="flex items-center gap-2 text-[13px]">
                <RadioGroupItem value="entity" />
                An entity
              </label>
              {!unanchored && <div className="ml-6">{entityChoice}</div>}
              <label className="flex items-center gap-2 text-[13px]">
                <RadioGroupItem value="none" />
                Unanchored: no restriction
              </label>
            </RadioGroup>
          ) : (
            entityChoice
          )}
        </div>

        {formError !== null && <p className="text-[13px] text-destructive">{formError}</p>}

        <DialogFooter className="gap-2">
          <Button type="button" variant="outline" size="sm" disabled={save.isPending} onClick={onClose}>
            Cancel
          </Button>
          <Button type="submit" size="sm" disabled={!ready || save.isPending}>
            {save.isPending && <Loader2 className="size-3.5 animate-spin" />}
            {action}
          </Button>
        </DialogFooter>
      </form>
    </DialogContent>
  )
}
