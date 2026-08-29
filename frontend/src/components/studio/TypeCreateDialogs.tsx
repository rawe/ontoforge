import { useState } from 'react'
import { useMutation, useQueryClient } from '@tanstack/react-query'
import { ArrowRight } from 'lucide-react'
import { useNavigate } from 'react-router-dom'
import { toast } from 'sonner'
import * as model from '@/api/model'
import type { EntityType } from '@/api/types'
import { ApiError } from '@/api/http'
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
import { deriveKey, invalidateModeling, isValidKey, toastError } from './lib'
import { KeyField } from './shared'

/** Form state shared by both create dialogs. */
function useTypeForm(open: boolean) {
  const [key, setKey] = useState('')
  const [keyTouched, setKeyTouched] = useState(false)
  const [displayName, setDisplayName] = useState('')
  const [description, setDescription] = useState('')
  const [fieldErrors, setFieldErrors] = useState<Record<string, string>>({})

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

  return {
    key,
    displayName,
    description,
    fieldErrors,
    setFieldErrors,
    onDisplayNameChange,
    onKeyChange,
    setDescription,
    valid: isValidKey(key) && displayName.trim() !== '',
  }
}

function applyApiError(
  error: unknown,
  setFieldErrors: (errors: Record<string, string>) => void,
) {
  if (error instanceof ApiError && error.fieldErrors !== undefined) {
    setFieldErrors(error.fieldErrors)
  }
  toastError(error)
}

interface CreateDialogProps {
  open: boolean
  onOpenChange: (open: boolean) => void
}

/** "New entity type" dialog — key, display name, description. */
export function EntityTypeCreateDialog({ open, onOpenChange }: CreateDialogProps) {
  const form = useTypeForm(open)
  const queryClient = useQueryClient()
  const navigate = useNavigate()

  const create = useMutation({
    mutationFn: () =>
      model.createEntityType({
        key: form.key,
        displayName: form.displayName.trim(),
        description: form.description.trim() === '' ? null : form.description.trim(),
      }),
    onSuccess: (created) => {
      invalidateModeling(queryClient)
      toast.success(`Entity type "${created.displayName}" created`)
      onOpenChange(false)
      void navigate(`/studio/entity-types/${created.entityTypeId}`)
    },
    onError: (error) => applyApiError(error, form.setFieldErrors),
  })

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="sm:max-w-md">
        <DialogHeader>
          <DialogTitle>New entity type</DialogTitle>
          <DialogDescription>
            Entity types are global — every lens can include them in its scope.
          </DialogDescription>
        </DialogHeader>
        <form
          className="grid gap-4"
          onSubmit={(e) => {
            e.preventDefault()
            if (form.valid && !create.isPending) create.mutate()
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
          <DialogFooter>
            <Button type="button" variant="ghost" onClick={() => onOpenChange(false)}>
              Cancel
            </Button>
            <Button type="submit" disabled={!form.valid || create.isPending}>
              Create entity type
            </Button>
          </DialogFooter>
        </form>
      </DialogContent>
    </Dialog>
  )
}

interface RelationTypeCreateDialogProps extends CreateDialogProps {
  entityTypes: EntityType[]
}

/** "New relation type" dialog — adds source/target selects (immutable after). */
export function RelationTypeCreateDialog({
  open,
  onOpenChange,
  entityTypes,
}: RelationTypeCreateDialogProps) {
  const form = useTypeForm(open)
  const [source, setSource] = useState('')
  const [target, setTarget] = useState('')
  const queryClient = useQueryClient()
  const navigate = useNavigate()

  const [wasOpen, setWasOpen] = useState(open)
  if (open !== wasOpen) {
    setWasOpen(open)
    if (open) {
      setSource('')
      setTarget('')
    }
  }

  const create = useMutation({
    mutationFn: () =>
      model.createRelationType({
        key: form.key,
        displayName: form.displayName.trim(),
        description: form.description.trim() === '' ? null : form.description.trim(),
        sourceEntityTypeKey: source,
        targetEntityTypeKey: target,
      }),
    onSuccess: (created) => {
      invalidateModeling(queryClient)
      toast.success(`Relation type "${created.displayName}" created`)
      onOpenChange(false)
      void navigate(`/studio/relation-types/${created.relationTypeId}`)
    },
    onError: (error) => applyApiError(error, form.setFieldErrors),
  })

  const valid = form.valid && source !== '' && target !== ''

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
            if (valid && !create.isPending) create.mutate()
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
          <DialogFooter>
            <Button type="button" variant="ghost" onClick={() => onOpenChange(false)}>
              Cancel
            </Button>
            <Button type="submit" disabled={!valid || create.isPending}>
              Create relation type
            </Button>
          </DialogFooter>
        </form>
      </DialogContent>
    </Dialog>
  )
}
