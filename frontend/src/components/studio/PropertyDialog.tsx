import { useState } from 'react'
import { useMutation, useQueryClient } from '@tanstack/react-query'
import { toast } from 'sonner'
import * as model from '@/api/model'
import { ApiError } from '@/api/http'
import type { DataType, PropertyDefinition } from '@/api/types'
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
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@/components/ui/select'
import { Switch } from '@/components/ui/switch'
import { Textarea } from '@/components/ui/textarea'
import { CascadeDialog } from './CascadeDialog'
import { useCascade } from './useCascade'
import { TypedValueInput } from './TypedValueInput'
import { DATA_TYPES, coerceTypedValue, deriveKey, invalidateModeling, isValidKey, toastError } from './lib'
import { KeyField } from './shared'

interface PropertyDialogProps {
  kind: 'entity-types' | 'relation-types'
  typeId: string
  /** null → create mode. */
  property: PropertyDefinition | null
  open: boolean
  onOpenChange: (open: boolean) => void
}

/**
 * Add/edit property dialog. On edit, key and dataType are immutable. Creating
 * a required property may 409 with CASCADE_REQUIRED — handled inline.
 */
export function PropertyDialog({
  kind,
  typeId,
  property,
  open,
  onOpenChange,
}: PropertyDialogProps) {
  const isEdit = property !== null
  const queryClient = useQueryClient()
  const { cascade, guard, clear } = useCascade()

  const [key, setKey] = useState('')
  const [keyTouched, setKeyTouched] = useState(false)
  const [displayName, setDisplayName] = useState('')
  const [description, setDescription] = useState('')
  const [dataType, setDataType] = useState<DataType>('string')
  const [required, setRequired] = useState(false)
  const [defaultRaw, setDefaultRaw] = useState('')
  const [fieldErrors, setFieldErrors] = useState<Record<string, string>>({})

  // Re-seed the form each time the dialog opens.
  const [wasOpen, setWasOpen] = useState(false)
  if (open !== wasOpen) {
    setWasOpen(open)
    if (open) {
      setKey(property?.key ?? '')
      setKeyTouched(isEdit)
      setDisplayName(property?.displayName ?? '')
      setDescription(property?.description ?? '')
      setDataType(property?.dataType ?? 'string')
      setRequired(property?.required ?? false)
      setDefaultRaw(
        property?.defaultValue === null || property === null
          ? ''
          : String(property.defaultValue),
      )
      setFieldErrors({})
    }
  }

  const body = () => ({
    ...(isEdit ? {} : { key }),
    displayName: displayName.trim(),
    description: description.trim() === '' ? null : description.trim(),
    ...(isEdit ? {} : { dataType }),
    required,
    defaultValue: coerceTypedValue(dataType, defaultRaw),
  })

  const save = useMutation({
    mutationFn: (cascadeFlag: boolean) =>
      isEdit
        ? model.updateProperty(kind, typeId, property.propertyId, body())
        : model.createProperty(kind, typeId, body(), cascadeFlag),
    onSuccess: (saved) => {
      invalidateModeling(queryClient)
      toast.success(isEdit ? `Property "${saved.key}" updated` : `Property "${saved.key}" added`)
      onOpenChange(false)
    },
    onError: (error) => {
      if (guard(error, () => save.mutate(true))) return
      if (error instanceof ApiError && error.fieldErrors !== undefined) {
        setFieldErrors(error.fieldErrors)
      }
      toastError(error)
    },
  })

  const valid = (isEdit || isValidKey(key)) && displayName.trim() !== ''

  return (
    <>
      <Dialog open={open} onOpenChange={onOpenChange}>
        <DialogContent className="sm:max-w-md">
          <DialogHeader>
            <DialogTitle>{isEdit ? `Edit property` : 'Add property'}</DialogTitle>
            <DialogDescription>
              {isEdit
                ? 'Key and data type are immutable; everything else can change.'
                : 'Properties define the fields instances of this type carry.'}
            </DialogDescription>
          </DialogHeader>
          <form
            className="grid gap-4"
            onSubmit={(e) => {
              e.preventDefault()
              if (valid && !save.isPending) save.mutate(false)
            }}
          >
            <div className="grid gap-1.5">
              <Label htmlFor="prop-name">Display name</Label>
              <Input
                id="prop-name"
                value={displayName}
                autoFocus
                onChange={(e) => {
                  setDisplayName(e.target.value)
                  if (!keyTouched) setKey(deriveKey(e.target.value))
                }}
                placeholder="Name"
              />
              {fieldErrors.displayName !== undefined && (
                <p className="text-xs text-destructive">{fieldErrors.displayName}</p>
              )}
            </div>
            <KeyField
              id="prop-key"
              value={key}
              onChange={(v) => {
                setKeyTouched(true)
                setKey(v)
              }}
              disabled={isEdit}
              error={fieldErrors.key}
            />
            <div className="grid grid-cols-2 items-end gap-3">
              <div className="grid gap-1.5">
                <Label htmlFor="prop-type">Data type</Label>
                <Select
                  value={dataType}
                  onValueChange={(v) => {
                    setDataType(v as DataType)
                    setDefaultRaw('')
                  }}
                  disabled={isEdit}
                >
                  <SelectTrigger id="prop-type" className="w-full">
                    <SelectValue />
                  </SelectTrigger>
                  <SelectContent>
                    {DATA_TYPES.map((t) => (
                      <SelectItem key={t} value={t}>
                        <span className="font-mono text-xs">{t}</span>
                      </SelectItem>
                    ))}
                  </SelectContent>
                </Select>
                {isEdit && (
                  <p className="text-xs text-muted-foreground">Immutable after creation.</p>
                )}
              </div>
              <label className="mb-1 flex h-8 items-center gap-2 text-[13px] font-medium">
                <Switch checked={required} onCheckedChange={setRequired} />
                Required
              </label>
            </div>
            <div className="grid gap-1.5">
              <Label htmlFor="prop-default">Default value</Label>
              <TypedValueInput
                id="prop-default"
                dataType={dataType}
                value={defaultRaw}
                onChange={setDefaultRaw}
                placeholder="No default"
              />
              {fieldErrors.defaultValue !== undefined && (
                <p className="text-xs text-destructive">{fieldErrors.defaultValue}</p>
              )}
            </div>
            <div className="grid gap-1.5">
              <Label htmlFor="prop-desc">Description</Label>
              <Textarea
                id="prop-desc"
                value={description}
                onChange={(e) => setDescription(e.target.value)}
                rows={2}
                placeholder="What does this property hold?"
              />
            </div>
            <DialogFooter>
              <Button type="button" variant="ghost" onClick={() => onOpenChange(false)}>
                Cancel
              </Button>
              <Button type="submit" disabled={!valid || save.isPending}>
                {isEdit ? 'Save changes' : 'Add property'}
              </Button>
            </DialogFooter>
          </form>
        </DialogContent>
      </Dialog>
      <CascadeDialog cascade={cascade} onClose={clear} />
    </>
  )
}
