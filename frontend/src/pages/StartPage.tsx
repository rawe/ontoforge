import { useState } from 'react'
import { useMutation, useQueryClient } from '@tanstack/react-query'
import { Boxes, Ellipsis, Layers, Pencil, Plus, Trash2 } from 'lucide-react'
import { Link, useNavigate } from 'react-router-dom'
import { toast } from 'sonner'
import * as registry from '@/api/registry'
import { ApiError } from '@/api/http'
import { useLenses, useOntologies } from '@/api/hooks'
import { qk } from '@/api/queryKeys'
import type { Ontology } from '@/api/types'
import { EmptyState } from '@/components/EmptyState'
import { Logo } from '@/components/Logo'
import { deriveKey, isValidKey, toastError } from '@/components/studio/lib'
import { KeyField } from '@/components/studio/shared'
import {
  AlertDialog,
  AlertDialogAction,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
} from '@/components/ui/alert-dialog'
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
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuTrigger,
} from '@/components/ui/dropdown-menu'
import { Skeleton } from '@/components/ui/skeleton'

/* --------------------------------- create ---------------------------------- */

/** "+ New ontology" dialog — key (immutable) + optional display name. */
function CreateOntologyDialog({
  open,
  onOpenChange,
}: {
  open: boolean
  onOpenChange: (open: boolean) => void
}) {
  const queryClient = useQueryClient()
  const navigate = useNavigate()
  const [name, setName] = useState('')
  const [key, setKey] = useState('')
  const [keyTouched, setKeyTouched] = useState(false)
  const [fieldErrors, setFieldErrors] = useState<Record<string, string>>({})

  const [wasOpen, setWasOpen] = useState(false)
  if (open !== wasOpen) {
    setWasOpen(open)
    if (open) {
      setName('')
      setKey('')
      setKeyTouched(false)
      setFieldErrors({})
    }
  }

  const create = useMutation({
    mutationFn: () =>
      registry.createOntology({
        key,
        ...(name.trim() === '' ? {} : { displayName: name.trim() }),
      }),
    onSuccess: (created) => {
      void queryClient.invalidateQueries({ queryKey: qk.ontologies })
      toast.success(`Ontology "${created.displayName ?? created.key}" created`)
      onOpenChange(false)
      void navigate(`/o/${created.key}/studio`)
    },
    onError: (error) => {
      if (error instanceof ApiError && error.fieldErrors !== undefined) {
        setFieldErrors(error.fieldErrors)
      }
      toastError(error)
    },
  })

  // Pattern-checked client-side like every key form; the server enforces
  // the ontology key length cap and answers 422, surfaced via toast.
  const valid = isValidKey(key)

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="sm:max-w-md">
        <DialogHeader>
          <DialogTitle>New ontology</DialogTitle>
          <DialogDescription>
            An independent ontology with its own schema, lenses and data.
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
            <Label htmlFor="ontology-name">Display name</Label>
            <Input
              id="ontology-name"
              value={name}
              autoFocus
              onChange={(e) => {
                setName(e.target.value)
                if (!keyTouched) setKey(deriveKey(e.target.value))
              }}
              placeholder="My Ontology"
            />
            {fieldErrors.displayName !== undefined && (
              <p className="text-xs text-destructive">{fieldErrors.displayName}</p>
            )}
            <p className="text-xs text-muted-foreground">Optional — can be changed later.</p>
          </div>
          <KeyField
            id="ontology-key"
            value={key}
            onChange={(v) => {
              setKeyTouched(true)
              setKey(v)
            }}
            error={fieldErrors.key}
          />
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

/* --------------------------------- rename ---------------------------------- */

/** Rename dialog — changes the display name only; the key is immutable. */
function RenameOntologyDialog({
  ontology,
  open,
  onOpenChange,
}: {
  ontology: Ontology
  open: boolean
  onOpenChange: (open: boolean) => void
}) {
  const queryClient = useQueryClient()
  const [name, setName] = useState('')
  const [fieldErrors, setFieldErrors] = useState<Record<string, string>>({})

  const [wasOpen, setWasOpen] = useState(false)
  if (open !== wasOpen) {
    setWasOpen(open)
    if (open) {
      setName(ontology.displayName ?? '')
      setFieldErrors({})
    }
  }

  const rename = useMutation({
    mutationFn: () => registry.renameOntology(ontology.key, { displayName: name.trim() }),
    onSuccess: () => {
      void queryClient.invalidateQueries({ queryKey: qk.ontologies })
      toast.success('Saved')
      onOpenChange(false)
    },
    onError: (error) => {
      if (error instanceof ApiError && error.fieldErrors !== undefined) {
        setFieldErrors(error.fieldErrors)
      }
      toastError(error)
    },
  })

  const valid = name.trim() !== ''

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="sm:max-w-md">
        <DialogHeader>
          <DialogTitle>Rename ontology</DialogTitle>
          <DialogDescription>
            Changes the display name only — the key{' '}
            <span className="font-mono text-xs">{ontology.key}</span> is immutable.
          </DialogDescription>
        </DialogHeader>
        <form
          className="grid gap-4"
          onSubmit={(e) => {
            e.preventDefault()
            if (valid && !rename.isPending) rename.mutate()
          }}
        >
          <div className="grid gap-1.5">
            <Label htmlFor="ontology-rename">Display name</Label>
            <Input
              id="ontology-rename"
              value={name}
              autoFocus
              onChange={(e) => setName(e.target.value)}
              placeholder="My Ontology"
            />
            {fieldErrors.displayName !== undefined && (
              <p className="text-xs text-destructive">{fieldErrors.displayName}</p>
            )}
          </div>
          <DialogFooter>
            <Button type="button" variant="ghost" onClick={() => onOpenChange(false)}>
              Cancel
            </Button>
            <Button type="submit" disabled={!valid || rename.isPending}>
              Save
            </Button>
          </DialogFooter>
        </form>
      </DialogContent>
    </Dialog>
  )
}

/* ---------------------------------- card ----------------------------------- */

/** One ontology: name + key, lens links into the workbench, Open Studio, ⋯ menu. */
function OntologyCard({ ontology }: { ontology: Ontology }) {
  const queryClient = useQueryClient()
  const { data: lenses } = useLenses(ontology.key)
  const [renameOpen, setRenameOpen] = useState(false)
  const [deleteOpen, setDeleteOpen] = useState(false)

  const label = ontology.displayName ?? ontology.key

  const remove = useMutation({
    mutationFn: () => registry.deleteOntology(ontology.key),
    onSuccess: async () => {
      toast.success(`Ontology "${label}" deleted`)
      // Refetch the list first — dropping the lens cache while this card
      // still observes it would refetch the deleted ontology into a 404.
      await queryClient.invalidateQueries({ queryKey: qk.ontologies })
      queryClient.removeQueries({ queryKey: qk.lenses(ontology.key) })
    },
    onError: toastError,
  })

  return (
    <div className="flex flex-col rounded-xl border bg-card p-4">
      <div className="flex items-start gap-2">
        <div className="min-w-0 flex-1">
          <div className="truncate text-sm font-medium">{label}</div>
          <div className="truncate font-mono text-[11px] text-muted-foreground">
            {ontology.key}
          </div>
        </div>
        <DropdownMenu>
          <DropdownMenuTrigger asChild>
            <Button
              variant="ghost"
              size="icon-sm"
              aria-label={`Actions for ${label}`}
              className="-mr-1 -mt-1 text-muted-foreground"
            >
              <Ellipsis className="size-4" />
            </Button>
          </DropdownMenuTrigger>
          <DropdownMenuContent align="end" className="w-40">
            <DropdownMenuItem onSelect={() => setRenameOpen(true)}>
              <Pencil className="size-4" /> Rename
            </DropdownMenuItem>
            <DropdownMenuItem variant="destructive" onSelect={() => setDeleteOpen(true)}>
              <Trash2 className="size-4" /> Delete
            </DropdownMenuItem>
          </DropdownMenuContent>
        </DropdownMenu>
      </div>
      <div className="mt-3 flex-1">
        <p className="text-[11px] font-medium uppercase tracking-wide text-muted-foreground">
          Lenses
        </p>
        {lenses === undefined && <Skeleton className="mt-1.5 h-6 w-28 rounded-md" />}
        {lenses !== undefined && lenses.length === 0 && (
          <p className="mt-1.5 text-[13px] text-muted-foreground">No lenses yet.</p>
        )}
        {lenses !== undefined && lenses.length > 0 && (
          <div className="mt-1.5 flex flex-wrap gap-1.5">
            {lenses.map((lens) => (
              <Link
                key={lens.lensId}
                to={`/o/${ontology.key}/w/${lens.key}`}
                className="inline-flex items-center gap-1 rounded-md border px-2 py-1 text-xs transition-colors duration-150 hover:border-ring/40 hover:bg-muted/60 focus-visible:outline-2 focus-visible:outline-ring/60"
              >
                <Layers className="size-3 text-muted-foreground" />
                {lens.name}
              </Link>
            ))}
          </div>
        )}
      </div>
      <div className="mt-4">
        <Button asChild variant="outline" size="sm">
          <Link to={`/o/${ontology.key}/studio`}>Open Studio</Link>
        </Button>
      </div>

      <RenameOntologyDialog
        ontology={ontology}
        open={renameOpen}
        onOpenChange={setRenameOpen}
      />
      <AlertDialog open={deleteOpen} onOpenChange={setDeleteOpen}>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>Delete "{label}"?</AlertDialogTitle>
            <AlertDialogDescription>
              This permanently deletes the ontology — its entire schema, all lenses
              and all data. This cannot be undone.
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel>Cancel</AlertDialogCancel>
            <AlertDialogAction variant="destructive" onClick={() => remove.mutate()}>
              Delete ontology
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </div>
  )
}

/* ---------------------------------- page ----------------------------------- */

/**
 * `/` — the server-level entry point: the "Ontologies" start page. A card
 * per ontology, "+ New ontology", empty state on a fresh server. `/` never
 * auto-resumes into a workbench.
 */
export function StartPage() {
  const { data: ontologies, isPending } = useOntologies()
  const [createOpen, setCreateOpen] = useState(false)

  return (
    <div className="min-h-dvh bg-background">
      <div className="mx-auto w-full max-w-3xl px-6 py-10">
        <div className="flex items-center gap-3">
          <Logo className="size-9 shrink-0 rounded-xl" />
          <div className="min-w-0">
            <h1 className="text-xl font-semibold tracking-tight">Ontologies</h1>
            <p className="text-[13px] text-muted-foreground">
              Independent ontologies on this server — each with its own schema,
              lenses and data.
            </p>
          </div>
          <div className="ml-auto shrink-0">
            <Button size="sm" onClick={() => setCreateOpen(true)}>
              <Plus className="size-3.5" /> New ontology
            </Button>
          </div>
        </div>
        <div className="mt-8">
          {isPending && (
            <div className="grid gap-3 sm:grid-cols-2">
              <Skeleton className="h-36 rounded-xl" />
              <Skeleton className="h-36 rounded-xl" />
            </div>
          )}
          {ontologies !== undefined && ontologies.length === 0 && (
            <EmptyState
              icon={Boxes}
              title="No ontologies yet"
              description="Create an ontology to start modeling a schema."
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
      </div>
      <CreateOntologyDialog open={createOpen} onOpenChange={setCreateOpen} />
    </div>
  )
}
