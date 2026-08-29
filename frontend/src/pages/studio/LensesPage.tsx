import { useState } from 'react'
import { useMutation, useQueryClient } from '@tanstack/react-query'
import { Layers, Plus } from 'lucide-react'
import { Link, useNavigate } from 'react-router-dom'
import { toast } from 'sonner'
import * as model from '@/api/model'
import { ApiError } from '@/api/http'
import { useLenses, useLensScope } from '@/api/hooks'
import type { Lens } from '@/api/types'
import { EmptyState } from '@/components/EmptyState'
import { PageHeader } from '@/components/PageHeader'
import { deriveKey, invalidateModeling, isValidKey, toastError } from '@/components/studio/lib'
import { KeyField } from '@/components/studio/shared'
import { Badge } from '@/components/ui/badge'
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
import { Skeleton } from '@/components/ui/skeleton'
import { Textarea } from '@/components/ui/textarea'

/** Scoped/unscoped badge with include counts — needs its own scope query. */
export function ScopeBadge({ lensId }: { lensId: string }) {
  const { data: scope } = useLensScope(lensId)
  if (scope === undefined) return null
  if (!scope.scoped) {
    return (
      <Badge variant="outline" className="text-[11px]">
        Unscoped
      </Badge>
    )
  }
  return (
    <Badge variant="secondary" className="text-[11px]">
      Scoped · {scope.entityTypes.length + scope.relationTypes.length} types
    </Badge>
  )
}

function LensCard({ lens }: { lens: Lens }) {
  return (
    <Link
      to={`/studio/lenses/${lens.lensId}`}
      className="rounded-xl border bg-card p-4 transition-colors duration-150 hover:border-ring/40 focus-visible:outline-2 focus-visible:outline-ring/60"
    >
      <div className="flex items-center gap-2">
        <span className="truncate text-sm font-medium">{lens.name}</span>
        <span className="font-mono text-[11px] text-muted-foreground">{lens.key}</span>
        <span className="ml-auto shrink-0">
          <ScopeBadge lensId={lens.lensId} />
        </span>
      </div>
      <p className="mt-1 line-clamp-2 text-[13px] text-muted-foreground">
        {lens.description ?? 'No description.'}
      </p>
    </Link>
  )
}

interface CreateLensDialogProps {
  open: boolean
  onOpenChange: (open: boolean) => void
}

/** "New lens" dialog with live key validation; the key is immutable. */
export function CreateLensDialog({ open, onOpenChange }: CreateLensDialogProps) {
  const queryClient = useQueryClient()
  const navigate = useNavigate()
  const [name, setName] = useState('')
  const [key, setKey] = useState('')
  const [keyTouched, setKeyTouched] = useState(false)
  const [description, setDescription] = useState('')
  const [fieldErrors, setFieldErrors] = useState<Record<string, string>>({})

  const [wasOpen, setWasOpen] = useState(false)
  if (open !== wasOpen) {
    setWasOpen(open)
    if (open) {
      setName('')
      setKey('')
      setKeyTouched(false)
      setDescription('')
      setFieldErrors({})
    }
  }

  const create = useMutation({
    mutationFn: () =>
      model.createLens({
        key,
        name: name.trim(),
        description: description.trim() === '' ? null : description.trim(),
      }),
    onSuccess: (created) => {
      invalidateModeling(queryClient)
      toast.success(`Lens "${created.name}" created`)
      onOpenChange(false)
      void navigate(`/studio/lenses/${created.lensId}`)
    },
    onError: (error) => {
      if (error instanceof ApiError && error.fieldErrors !== undefined) {
        setFieldErrors(error.fieldErrors)
      }
      toastError(error)
    },
  })

  const valid = isValidKey(key) && name.trim() !== ''

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="sm:max-w-md">
        <DialogHeader>
          <DialogTitle>New lens</DialogTitle>
          <DialogDescription>
            A named lens over the global schema. New lenses start unscoped — they
            expose the full schema until you scope them.
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
            <Label htmlFor="lens-name">Name</Label>
            <Input
              id="lens-name"
              value={name}
              autoFocus
              onChange={(e) => {
                setName(e.target.value)
                if (!keyTouched) setKey(deriveKey(e.target.value))
              }}
              placeholder="My Lens"
            />
            {fieldErrors.name !== undefined && (
              <p className="text-xs text-destructive">{fieldErrors.name}</p>
            )}
          </div>
          <KeyField
            id="lens-key"
            value={key}
            onChange={(v) => {
              setKeyTouched(true)
              setKey(v)
            }}
            error={fieldErrors.key}
          />
          <div className="grid gap-1.5">
            <Label htmlFor="lens-desc">Description</Label>
            <Textarea
              id="lens-desc"
              value={description}
              onChange={(e) => setDescription(e.target.value)}
              rows={2}
              placeholder="What is this lens for?"
            />
          </div>
          <DialogFooter>
            <Button type="button" variant="ghost" onClick={() => onOpenChange(false)}>
              Cancel
            </Button>
            <Button type="submit" disabled={!valid || create.isPending}>
              Create lens
            </Button>
          </DialogFooter>
        </form>
      </DialogContent>
    </Dialog>
  )
}

/** `/studio/lenses` — lens list + creation. */
export function LensesPage() {
  const { data: lenses, isPending } = useLenses()
  const [createOpen, setCreateOpen] = useState(false)

  return (
    <div>
      <PageHeader
        title="Lenses"
        description="Named lenses over the global schema — unscoped or filtered to a subset of types."
        actions={
          <Button size="sm" onClick={() => setCreateOpen(true)}>
            <Plus className="size-3.5" /> New lens
          </Button>
        }
      />
      <div className="p-6">
        {isPending && (
          <div className="grid gap-3 sm:grid-cols-2">
            <Skeleton className="h-24 rounded-xl" />
            <Skeleton className="h-24 rounded-xl" />
          </div>
        )}
        {lenses !== undefined && lenses.length === 0 && (
          <EmptyState
            icon={Layers}
            title="No lenses"
            description="Create a lens to expose the schema to the workbench, REST and MCP."
            action={
              <Button onClick={() => setCreateOpen(true)}>
                <Plus className="size-4" /> New lens
              </Button>
            }
          />
        )}
        {lenses !== undefined && lenses.length > 0 && (
          <div className="grid gap-3 sm:grid-cols-2">
            {lenses.map((o) => (
              <LensCard key={o.lensId} lens={o} />
            ))}
          </div>
        )}
      </div>
      <CreateLensDialog open={createOpen} onOpenChange={setCreateOpen} />
    </div>
  )
}
