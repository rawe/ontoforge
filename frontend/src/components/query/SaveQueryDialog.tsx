import { useState } from 'react'
import { useMutation, useQueryClient } from '@tanstack/react-query'
import { toast } from 'sonner'
import * as model from '@/api/model'
import { qk } from '@/api/queryKeys'
import type { DataType, SavedQueryParameter } from '@/api/types'
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
import { PARAMETER_DATA_TYPES, deriveKey, isValidKey, toastError } from '@/components/studio/lib'
import { KeyField } from '@/components/studio/shared'
import { detectParams } from './resultUtils'

interface SaveQueryDialogProps {
  ontologyKey: string
  /** The console's current Cypher — becomes the single `main` step. */
  cypher: string
  open: boolean
  onOpenChange: (open: boolean) => void
  onSaved?: (queryKey: string) => void
}

/**
 * "Save as query" dialog for the console: key/name/description plus a
 * parameter row per auto-detected `$param` token. Persists via the modeling
 * API as a single-step Cypher pipeline.
 */
export function SaveQueryDialog({
  ontologyKey,
  cypher,
  open,
  onOpenChange,
  onSaved,
}: SaveQueryDialogProps) {
  const queryClient = useQueryClient()

  const [key, setKey] = useState('')
  const [keyTouched, setKeyTouched] = useState(false)
  const [name, setName] = useState('')
  const [description, setDescription] = useState('')
  const [parameters, setParameters] = useState<SavedQueryParameter[]>([])

  // Re-seed the form each time the dialog opens (params from $tokens).
  const [wasOpen, setWasOpen] = useState(false)
  if (open !== wasOpen) {
    setWasOpen(open)
    if (open) {
      setKey('')
      setKeyTouched(false)
      setName('')
      setDescription('')
      setParameters(
        detectParams(cypher).map((p) => ({ name: p, description: '', dataType: 'string' })),
      )
    }
  }

  const save = useMutation({
    // `description` is a required string on the query AND each parameter
    // (both are embedded for semantic discovery) — send '' when empty.
    mutationFn: () =>
      model.upsertSavedQuery(ontologyKey, key, {
        name: name.trim(),
        description: description.trim(),
        steps: [{ name: 'main', type: 'cypher', cypher }],
        parameters: parameters.map((p) => ({
          ...p,
          name: p.name.trim(),
          description: (p.description ?? '').trim(),
        })),
      }),
    onSuccess: (saved) => {
      void queryClient.invalidateQueries({ queryKey: qk.savedQueries(ontologyKey) })
      void queryClient.invalidateQueries({
        queryKey: qk.model('ontologies', ontologyKey, 'saved-queries'),
      })
      void queryClient.invalidateQueries({
        queryKey: ['palette', 'savedQuerySearch', ontologyKey],
      })
      toast.success(`Saved query "${saved.key}"`)
      onOpenChange(false)
      onSaved?.(saved.key)
    },
    onError: toastError,
  })

  const valid =
    isValidKey(key) &&
    name.trim() !== '' &&
    description.trim() !== '' &&
    cypher.trim() !== '' &&
    parameters.every((p) => p.name.trim() !== '')

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-h-[88dvh] overflow-y-auto sm:max-w-lg">
        <DialogHeader>
          <DialogTitle>Save as query</DialogTitle>
          <DialogDescription>
            Stores the current Cypher as a reusable saved query on this ontology —
            runnable from the Library, REST and MCP.
          </DialogDescription>
        </DialogHeader>
        <form
          className="grid gap-4"
          onSubmit={(e) => {
            e.preventDefault()
            if (valid && !save.isPending) save.mutate()
          }}
        >
          <div className="grid grid-cols-2 gap-3">
            <div className="grid gap-1.5">
              <Label htmlFor="saveq-name">Name</Label>
              <Input
                id="saveq-name"
                value={name}
                autoFocus
                onChange={(e) => {
                  setName(e.target.value)
                  if (!keyTouched) setKey(deriveKey(e.target.value))
                }}
                placeholder="Team of company"
              />
            </div>
            <KeyField
              id="saveq-key"
              value={key}
              onChange={(v) => {
                setKeyTouched(true)
                setKey(v)
              }}
            />
          </div>

          <div className="grid gap-1.5">
            <Label htmlFor="saveq-desc">
              Description <span className="text-destructive">*</span>
            </Label>
            <Textarea
              id="saveq-desc"
              value={description}
              onChange={(e) => setDescription(e.target.value)}
              rows={2}
              placeholder="What does this query answer?"
            />
            <p className="text-xs text-muted-foreground">
              Required — the description is embedded and powers semantic discovery of
              this query.
            </p>
          </div>

          <pre className="max-h-32 overflow-auto rounded-lg border bg-muted/40 p-2.5 font-mono text-[11px]">
            {cypher}
          </pre>

          {parameters.length > 0 && (
            <div className="grid gap-2">
              <Label>Parameters</Label>
              <p className="-mt-1 text-xs text-muted-foreground">
                Auto-detected from <code className="font-mono">$param</code> tokens in
                the Cypher.
              </p>
              {parameters.map((p, i) => (
                <div key={i} className="flex items-center gap-1.5">
                  <Input
                    value={p.name}
                    onChange={(e) =>
                      setParameters((prev) =>
                        prev.map((q, j) => (j === i ? { ...q, name: e.target.value } : q)),
                      )
                    }
                    placeholder="name"
                    className="h-7 w-32 font-mono text-xs"
                    aria-label="Parameter name"
                  />
                  <Input
                    value={p.description ?? ''}
                    onChange={(e) =>
                      setParameters((prev) =>
                        prev.map((q, j) =>
                          j === i ? { ...q, description: e.target.value } : q,
                        ),
                      )
                    }
                    placeholder="description"
                    className="h-7 flex-1 text-xs"
                    aria-label="Parameter description"
                  />
                  <Select
                    value={p.dataType}
                    onValueChange={(v) =>
                      setParameters((prev) =>
                        prev.map((q, j) =>
                          j === i ? { ...q, dataType: v as DataType } : q,
                        ),
                      )
                    }
                  >
                    <SelectTrigger
                      className="h-7 w-28 text-xs"
                      aria-label="Parameter data type"
                    >
                      <SelectValue />
                    </SelectTrigger>
                    <SelectContent>
                      {PARAMETER_DATA_TYPES.map((t) => (
                        <SelectItem key={t} value={t}>
                          <span className="font-mono text-xs">{t}</span>
                        </SelectItem>
                      ))}
                    </SelectContent>
                  </Select>
                </div>
              ))}
            </div>
          )}

          <DialogFooter>
            <Button type="button" variant="ghost" onClick={() => onOpenChange(false)}>
              Cancel
            </Button>
            <Button type="submit" disabled={!valid || save.isPending}>
              {save.isPending ? 'Saving…' : 'Save query'}
            </Button>
          </DialogFooter>
        </form>
      </DialogContent>
    </Dialog>
  )
}
