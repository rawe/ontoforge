import { useState } from 'react'
import { useMutation, useQueryClient } from '@tanstack/react-query'
import { Layers, Plus } from 'lucide-react'
import { Link, useNavigate } from 'react-router-dom'
import { toast } from 'sonner'
import * as model from '@/api/model'
import { ApiError } from '@/api/http'
import { useOntologies, useOntologyScope } from '@/api/hooks'
import type { Ontology } from '@/api/types'
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
export function ScopeBadge({ ontologyId }: { ontologyId: string }) {
  const { data: scope } = useOntologyScope(ontologyId)
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

function OntologyCard({ ontology }: { ontology: Ontology }) {
  return (
    <Link
      to={`/studio/ontologies/${ontology.ontologyId}`}
      className="rounded-xl border bg-card p-4 transition-colors duration-150 hover:border-ring/40 focus-visible:outline-2 focus-visible:outline-ring/60"
    >
      <div className="flex items-center gap-2">
        <span className="truncate text-sm font-medium">{ontology.name}</span>
        <span className="font-mono text-[11px] text-muted-foreground">{ontology.key}</span>
        <span className="ml-auto shrink-0">
          <ScopeBadge ontologyId={ontology.ontologyId} />
        </span>
      </div>
      <p className="mt-1 line-clamp-2 text-[13px] text-muted-foreground">
        {ontology.description ?? 'No description.'}
      </p>
    </Link>
  )
}

interface CreateOntologyDialogProps {
  open: boolean
  onOpenChange: (open: boolean) => void
}

/** "New ontology" dialog with live key validation; the key is immutable. */
export function CreateOntologyDialog({ open, onOpenChange }: CreateOntologyDialogProps) {
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
      model.createOntology({
        key,
        name: name.trim(),
        description: description.trim() === '' ? null : description.trim(),
      }),
    onSuccess: (created) => {
      invalidateModeling(queryClient)
      toast.success(`Ontology "${created.name}" created`)
      onOpenChange(false)
      void navigate(`/studio/ontologies/${created.ontologyId}`)
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
          <DialogTitle>New ontology</DialogTitle>
          <DialogDescription>
            A named lens over the global schema. New ontologies start unscoped — they
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
            <Label htmlFor="ont-name">Name</Label>
            <Input
              id="ont-name"
              value={name}
              autoFocus
              onChange={(e) => {
                setName(e.target.value)
                if (!keyTouched) setKey(deriveKey(e.target.value))
              }}
              placeholder="My Ontology"
            />
            {fieldErrors.name !== undefined && (
              <p className="text-xs text-destructive">{fieldErrors.name}</p>
            )}
          </div>
          <KeyField
            id="ont-key"
            value={key}
            onChange={(v) => {
              setKeyTouched(true)
              setKey(v)
            }}
            error={fieldErrors.key}
          />
          <div className="grid gap-1.5">
            <Label htmlFor="ont-desc">Description</Label>
            <Textarea
              id="ont-desc"
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
              Create ontology
            </Button>
          </DialogFooter>
        </form>
      </DialogContent>
    </Dialog>
  )
}

/** `/studio/ontologies` — ontology list + creation. */
export function OntologiesPage() {
  const { data: ontologies, isPending } = useOntologies()
  const [createOpen, setCreateOpen] = useState(false)

  return (
    <div>
      <PageHeader
        title="Ontologies"
        description="Named lenses over the global schema — unscoped or filtered to a subset of types."
        actions={
          <Button size="sm" onClick={() => setCreateOpen(true)}>
            <Plus className="size-3.5" /> New ontology
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
        {ontologies !== undefined && ontologies.length === 0 && (
          <EmptyState
            icon={Layers}
            title="No ontologies"
            description="Create an ontology to expose the schema to the workbench, REST and MCP."
            action={
              <Button onClick={() => setCreateOpen(true)}>
                <Plus className="size-4" /> New ontology
              </Button>
            }
          />
        )}
        {ontologies !== undefined && ontologies.length > 0 && (
          <div className="grid gap-3 sm:grid-cols-2">
            {ontologies.map((o) => (
              <OntologyCard key={o.ontologyId} ontology={o} />
            ))}
          </div>
        )}
      </div>
      <CreateOntologyDialog open={createOpen} onOpenChange={setCreateOpen} />
    </div>
  )
}
