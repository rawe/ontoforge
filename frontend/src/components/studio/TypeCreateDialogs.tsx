import { useState } from 'react'
import { ArrowRight } from 'lucide-react'
import type { EntityType, RelationType } from '@/api/types'
import { TypeDot } from '@/components/TypeChip'
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
import { Textarea } from '@/components/ui/textarea'
import { deriveKey, isValidSchemaKey } from './lib'
import { fieldErrorsOf } from './modeling/errors'
import { useCreateEntityType, useCreateRelationType } from './modeling/mutations'
import { KeyField } from './shared'

/** Form state shared by both create dialogs. */
function useTypeForm(open: boolean) {
  const [key, setKey] = useState('')
  const [keyTouched, setKeyTouched] = useState(false)
  const [displayName, setDisplayName] = useState('')
  const [description, setDescription] = useState('')
  const [fieldErrors, setFieldErrors] = useState<Record<string, string>>({})
  const [formError, setFormError] = useState<string | null>(null)

  // Reset whenever the dialog is (re)opened.
  const [wasOpen, setWasOpen] = useState(open)
  if (open !== wasOpen) {
    setWasOpen(open)
    if (open) {
      setKey('')
      setKeyTouched(false)
      setDisplayName('')
      setDescription('')
      setFieldErrors({})
      setFormError(null)
    }
  }

  const onDisplayNameChange = (value: string) => {
    setDisplayName(value)
    if (!keyTouched) setKey(deriveKey(value))
  }
  const onKeyChange = (value: string) => {
    setKeyTouched(true)
    setKey(value)
  }

  /** Before a submit: forget the last attempt's errors. */
  const clearErrors = () => {
    setFieldErrors({})
    setFormError(null)
  }
  /** A failed create (already toasted): field errors under their fields, anything else as one line. */
  const showError = (error: unknown) => {
    const fields = fieldErrorsOf(error)
    setFieldErrors(fields)
    setFormError(
      Object.keys(fields).length === 0
        ? error instanceof Error
          ? error.message
          : String(error)
        : null,
    )
  }

  return {
    key,
    displayName,
    description,
    fieldErrors,
    formError,
    clearErrors,
    showError,
    onDisplayNameChange,
    onKeyChange,
    setDescription,
    valid: isValidSchemaKey(key) && displayName.trim() !== '',
  }
}

interface CreateDialogProps<T> {
  ontologyKey: string
  open: boolean
  onOpenChange: (open: boolean) => void
  /** After the type exists and the dialog has closed — the caller decides where to go. */
  onCreated: (created: T) => void
}

function FormError({ message }: { message: string | null }) {
  if (message === null) return null
  return <p className="text-xs text-destructive">{message}</p>
}

/**
 * "New entity type" dialog — key, display name, description and the key of
 * the name property the server creates with the type (default `name`).
 */
export function EntityTypeCreateDialog({
  ontologyKey,
  open,
  onOpenChange,
  onCreated,
}: CreateDialogProps<EntityType>) {
  const form = useTypeForm(open)
  const [nameProperty, setNameProperty] = useState('name')
  const { create, isPending } = useCreateEntityType(ontologyKey)

  const [wasOpen, setWasOpen] = useState(open)
  if (open !== wasOpen) {
    setWasOpen(open)
    if (open) setNameProperty('name')
  }

  const valid = form.valid && isValidSchemaKey(nameProperty)

  const submit = () => {
    form.clearErrors()
    create({
      key: form.key,
      displayName: form.displayName.trim(),
      description: form.description.trim() === '' ? null : form.description.trim(),
      nameProperty,
    }).then((created) => {
      onOpenChange(false)
      onCreated(created)
    }, form.showError)
  }

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="sm:max-w-md">
        <DialogHeader>
          <DialogTitle>New entity type</DialogTitle>
          <DialogDescription>
            Entity types belong to this ontology — every lens of this ontology can
            include them in its scope. The
            name property is a string property created with the type; its value labels
            instances.
          </DialogDescription>
        </DialogHeader>
        <form
          className="grid gap-4"
          onSubmit={(e) => {
            e.preventDefault()
            if (valid && !isPending) submit()
          }}
        >
          <div className="grid gap-1.5">
            <Label htmlFor="et-name">Display name</Label>
            <Input
              id="et-name"
              value={form.displayName}
              onChange={(e) => form.onDisplayNameChange(e.target.value)}
              placeholder="Person"
              autoFocus
            />
            {form.fieldErrors.displayName !== undefined && (
              <p className="text-xs text-destructive">{form.fieldErrors.displayName}</p>
            )}
          </div>
          <KeyField
            id="et-key"
            value={form.key}
            onChange={form.onKeyChange}
            error={form.fieldErrors.key}
          />
          <KeyField
            id="et-name-property"
            label="Name property key"
            value={nameProperty}
            onChange={setNameProperty}
            error={form.fieldErrors.nameProperty}
          />
          <div className="grid gap-1.5">
            <Label htmlFor="et-desc">Description</Label>
            <Textarea
              id="et-desc"
              value={form.description}
              onChange={(e) => form.setDescription(e.target.value)}
              placeholder="What does this type represent?"
              rows={2}
            />
          </div>
          <FormError message={form.formError} />
          <DialogFooter>
            <Button type="button" variant="ghost" onClick={() => onOpenChange(false)}>
              Cancel
            </Button>
            <Button type="submit" disabled={!valid || isPending}>
              Create entity type
            </Button>
          </DialogFooter>
        </form>
      </DialogContent>
    </Dialog>
  )
}

interface RelationTypeCreateDialogProps extends CreateDialogProps<RelationType> {
  entityTypes: EntityType[]
}

/** "New relation type" dialog — adds source/target selects (immutable after). */
export function RelationTypeCreateDialog({
  ontologyKey,
  open,
  onOpenChange,
  onCreated,
  entityTypes,
}: RelationTypeCreateDialogProps) {
  const form = useTypeForm(open)
  const [source, setSource] = useState('')
  const [target, setTarget] = useState('')
  const { create, isPending } = useCreateRelationType(ontologyKey)

  const [wasOpen, setWasOpen] = useState(open)
  if (open !== wasOpen) {
    setWasOpen(open)
    if (open) {
      setSource('')
      setTarget('')
    }
  }

  const valid = form.valid && source !== '' && target !== ''

  const submit = () => {
    form.clearErrors()
    create({
      key: form.key,
      displayName: form.displayName.trim(),
      description: form.description.trim() === '' ? null : form.description.trim(),
      sourceEntityTypeKey: source,
      targetEntityTypeKey: target,
    }).then((created) => {
      onOpenChange(false)
      onCreated(created)
    }, form.showError)
  }

  const typeSelect = (
    id: string,
    label: string,
    value: string,
    onChange: (v: string) => void,
  ) => (
    <div className="grid flex-1 gap-1.5">
      <Label htmlFor={id}>{label}</Label>
      <Select value={value} onValueChange={onChange}>
        <SelectTrigger id={id} className="w-full">
          <SelectValue placeholder="Select type…" />
        </SelectTrigger>
        <SelectContent>
          {entityTypes.map((t) => (
            <SelectItem key={t.entityTypeId} value={t.key}>
              <span className="flex items-center gap-2">
                <TypeDot typeKey={t.key} />
                {t.displayName}
              </span>
            </SelectItem>
          ))}
        </SelectContent>
      </Select>
    </div>
  )

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="sm:max-w-md">
        <DialogHeader>
          <DialogTitle>New relation type</DialogTitle>
          <DialogDescription>
            Relations connect two entity types. Source and target are permanent once
            created.
          </DialogDescription>
        </DialogHeader>
        <form
          className="grid gap-4"
          onSubmit={(e) => {
            e.preventDefault()
            if (valid && !isPending) submit()
          }}
        >
          <div className="grid gap-1.5">
            <Label htmlFor="rt-name">Display name</Label>
            <Input
              id="rt-name"
              value={form.displayName}
              onChange={(e) => form.onDisplayNameChange(e.target.value)}
              placeholder="Works For"
              autoFocus
            />
            {form.fieldErrors.displayName !== undefined && (
              <p className="text-xs text-destructive">{form.fieldErrors.displayName}</p>
            )}
          </div>
          <KeyField
            id="rt-key"
            value={form.key}
            onChange={form.onKeyChange}
            error={form.fieldErrors.key}
          />
          <div className="flex items-end gap-2">
            {typeSelect('rt-source', 'Source', source, setSource)}
            <ArrowRight className="mb-2 size-4 shrink-0 text-muted-foreground" />
            {typeSelect('rt-target', 'Target', target, setTarget)}
          </div>
          <div className="grid gap-1.5">
            <Label htmlFor="rt-desc">Description</Label>
            <Textarea
              id="rt-desc"
              value={form.description}
              onChange={(e) => form.setDescription(e.target.value)}
              placeholder="What does this relation mean?"
              rows={2}
            />
          </div>
          <FormError message={form.formError} />
          <DialogFooter>
            <Button type="button" variant="ghost" onClick={() => onOpenChange(false)}>
              Cancel
            </Button>
            <Button type="submit" disabled={!valid || isPending}>
              Create relation type
            </Button>
          </DialogFooter>
        </form>
      </DialogContent>
    </Dialog>
  )
}
