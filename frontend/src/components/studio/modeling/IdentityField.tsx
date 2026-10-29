/**
 * An entity type's identity, in its header: the identity properties in
 * order ("Identity: — / code · year"), and an editor that picks 1 to 5 of
 * the type's string, integer and date properties, orders them and shows an
 * example of the text form. Setting it may need the cascade (the
 * properties become required, lose their defaults and join lens
 * allowlists): the page's cascade dialog asks. A refusal by the stored data
 * shows its report in place (the identity is unchanged). Renders a
 * fragment: the field, then the report as its own row.
 */

import { useState } from 'react'
import { ArrowDown, ArrowUp, Fingerprint, X } from 'lucide-react'
import type { EntityType } from '@/api/types'
import { Button } from '@/components/ui/button'
import { Checkbox } from '@/components/ui/checkbox'
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from '@/components/ui/dialog'
import { cn } from '@/lib/utils'
import {
  identityEligible,
  identityExample,
  identityReport,
  identityViolationsOf,
  MAX_IDENTITY_PROPERTIES,
} from './identity'
import { useSetIdentity } from './mutations'
import { useModelSchema } from './useModelSchema'

export function IdentityField({
  ontologyKey,
  entityType,
  variant,
}: {
  ontologyKey: string
  entityType: EntityType
  variant: 'panel' | 'page'
}) {
  const [editing, setEditing] = useState(false)
  const setIdentity = useSetIdentity(ontologyKey, entityType.entityTypeId)
  const violations = identityViolationsOf(setIdentity.error)
  const current = entityType.identityProperties

  return (
    <>
      <span
        className={cn(
          'flex items-center gap-2 text-[12px] text-muted-foreground',
          variant === 'panel' && 'justify-between pt-1',
        )}
      >
        Identity
        <Button
          variant="outline"
          size="xs"
          className="font-mono"
          title="Identity — the properties whose values, in order, identify an entity of this type"
          onClick={() => setEditing(true)}
          disabled={setIdentity.isPending}
        >
          <Fingerprint className="opacity-60" />
          {current === null ? '—' : current.join(' · ')}
        </Button>
      </span>

      {violations !== null && (
        <div
          role="alert"
          className="grid basis-full gap-1.5 rounded-lg border border-destructive/40 bg-destructive/5 p-3 text-[12px]"
        >
          <p className="font-medium text-destructive">
            Identity not saved: the stored entities cannot take it. Nothing was changed.
          </p>
          <ul className="grid gap-1">
            {identityReport(violations).map((line) => (
              <li key={line.rule}>
                <span className="font-medium">{line.summary}</span>
                <span className="mt-0.5 flex flex-wrap gap-x-2 gap-y-0.5">
                  {line.entities.map((e) => (
                    <span key={e.id} className="font-mono text-[11px]" title={e.id}>
                      {e.id.slice(0, 8)}
                    </span>
                  ))}
                  {line.more > 0 && <span className="text-muted-foreground">and {line.more} more</span>}
                </span>
              </li>
            ))}
          </ul>
          <p className="text-muted-foreground">
            Every entity needs a value for each identity property, and no two entities may share
            an identity. Fix the data in the Workbench, then retry.
          </p>
          <Button variant="ghost" size="xs" className="justify-self-start" onClick={() => setIdentity.reset()}>
            Dismiss
          </Button>
        </div>
      )}

      {editing && (
        <IdentityEditor
          ontologyKey={ontologyKey}
          entityType={entityType}
          onClose={() => setEditing(false)}
          onSave={(keys) => {
            setEditing(false)
            setIdentity.set(keys)
          }}
        />
      )}
    </>
  )
}

/** The ordered picker: eligible properties to tick, the chosen ones to reorder, an example. */
function IdentityEditor({
  ontologyKey,
  entityType,
  onClose,
  onSave,
}: {
  ontologyKey: string
  entityType: EntityType
  onClose: () => void
  onSave: (keys: string[] | null) => void
}) {
  const schema = useModelSchema(ontologyKey)
  const properties = schema.properties[entityType.entityTypeId] ?? []
  const eligible = properties.filter((p) => identityEligible(p.dataType))
  const [chosen, setChosen] = useState<string[]>(entityType.identityProperties ?? [])
  const byKey = new Map(properties.map((p) => [p.key, p]))
  const chosenProps = chosen.flatMap((key) => {
    const p = byKey.get(key)
    return p === undefined ? [] : [p]
  })
  const full = chosen.length >= MAX_IDENTITY_PROPERTIES
  const move = (index: number, by: number) => {
    const next = [...chosen]
    const [key] = next.splice(index, 1)
    next.splice(index + by, 0, key!)
    setChosen(next)
  }
  const unchanged = JSON.stringify(chosen) === JSON.stringify(entityType.identityProperties ?? [])

  return (
    <Dialog open onOpenChange={(open) => !open && onClose()}>
      <DialogContent>
        <DialogHeader>
          <DialogTitle>Identity of "{entityType.displayName}"</DialogTitle>
          <DialogDescription>
            Pick 1 to {MAX_IDENTITY_PROPERTIES} properties whose values, in order, identify an
            entity of this type. They must be string, integer or date properties; they become
            required, without a default, and stay locked while they are part of the identity.
          </DialogDescription>
        </DialogHeader>

        {eligible.length === 0 ? (
          <p className="text-[13px] text-muted-foreground">
            This type has no string, integer or date property to build an identity from.
          </p>
        ) : (
          <ul className="grid gap-1 text-[13px]">
            {eligible.map((p) => {
              const checked = chosen.includes(p.key)
              return (
                <li key={p.propertyId}>
                  <label className="flex items-center gap-2">
                    <Checkbox
                      checked={checked}
                      disabled={!checked && full}
                      onCheckedChange={(on) =>
                        setChosen(on === true ? [...chosen, p.key] : chosen.filter((k) => k !== p.key))
                      }
                    />
                    <span className="font-mono">{p.key}</span>
                    <span className="text-[11px] text-muted-foreground">{p.dataType}</span>
                  </label>
                </li>
              )
            })}
          </ul>
        )}

        {chosen.length > 0 && (
          <div className="grid gap-1.5">
            <h3 className="text-[12px] font-medium text-muted-foreground">Order</h3>
            <ol className="grid gap-1 rounded-md border bg-muted/40 px-3 py-2 text-[13px]">
              {chosen.map((key, index) => (
                <li key={key} className="flex items-center gap-2">
                  <span className="w-4 text-muted-foreground">{index + 1}.</span>
                  <span className="font-mono">{key}</span>
                  <span className="ml-auto flex gap-0.5">
                    <Button
                      variant="ghost"
                      size="icon-xs"
                      aria-label={`Move ${key} up`}
                      disabled={index === 0}
                      onClick={() => move(index, -1)}
                    >
                      <ArrowUp />
                    </Button>
                    <Button
                      variant="ghost"
                      size="icon-xs"
                      aria-label={`Move ${key} down`}
                      disabled={index === chosen.length - 1}
                      onClick={() => move(index, 1)}
                    >
                      <ArrowDown />
                    </Button>
                    <Button
                      variant="ghost"
                      size="icon-xs"
                      aria-label={`Remove ${key}`}
                      onClick={() => setChosen(chosen.filter((k) => k !== key))}
                    >
                      <X />
                    </Button>
                  </span>
                </li>
              ))}
            </ol>
            <p className="text-[12px] text-muted-foreground">
              An identity reads like <span className="font-mono text-foreground">{identityExample(chosenProps)}</span>:
              the values in this order, joined with <span className="font-mono">~</span>.
            </p>
          </div>
        )}

        <DialogFooter>
          {entityType.identityProperties !== null && (
            <Button variant="ghost" className="mr-auto" onClick={() => onSave(null)}>
              Clear identity
            </Button>
          )}
          <Button variant="outline" onClick={onClose}>
            Cancel
          </Button>
          <Button disabled={chosen.length === 0 || unchanged} onClick={() => onSave(chosen)}>
            Save
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  )
}
