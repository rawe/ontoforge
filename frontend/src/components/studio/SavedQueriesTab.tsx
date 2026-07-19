import { useState } from 'react'
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import {
  ArrowDown,
  ArrowUp,
  Braces,
  Pencil,
  Play,
  Plus,
  SquareTerminal,
  Trash2,
  X,
} from 'lucide-react'
import { toast } from 'sonner'
import * as model from '@/api/model'
import * as runtime from '@/api/runtime'
import { qk } from '@/api/queryKeys'
import type {
  DataType,
  JsonValue,
  Ontology,
  QueryResult,
  SavedQuery,
  SavedQueryParameter,
  SavedQueryStep,
} from '@/api/types'
import { EmptyState } from '@/components/EmptyState'
import { TypeDot } from '@/components/TypeChip'
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
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@/components/ui/select'
import { Skeleton } from '@/components/ui/skeleton'
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from '@/components/ui/table'
import { Textarea } from '@/components/ui/textarea'
import { TypedValueInput } from './TypedValueInput'
import { PARAMETER_DATA_TYPES, coerceTypedValue, deriveKey, invalidateModeling, isValidKey, toastError } from './lib'
import { KeyField } from './shared'

/* ------------------------------ bindings editor ------------------------------ */

function BindingsEditor({
  bindings,
  onChange,
}: {
  bindings: Record<string, string>
  onChange: (bindings: Record<string, string>) => void
}) {
  const entries = Object.entries(bindings)
  const update = (index: number, k: string, v: string) => {
    const next = entries.map((e, i) => (i === index ? ([k, v] as const) : e))
    onChange(Object.fromEntries(next))
  }
  return (
    <div className="grid gap-1.5">
      <span className="text-xs font-medium text-muted-foreground">Bindings</span>
      {entries.map(([k, v], i) => (
        <div key={i} className="flex items-center gap-1.5">
          <Input
            value={k}
            onChange={(e) => update(i, e.target.value, v)}
            placeholder="param"
            className="h-7 flex-1 font-mono text-xs"
          />
          <span className="text-muted-foreground">=</span>
          <Input
            value={v}
            onChange={(e) => update(i, k, e.target.value)}
            placeholder="{{stepName.field}}"
            className="h-7 flex-[2] font-mono text-xs"
          />
          <Button
            type="button"
            variant="ghost"
            size="icon-xs"
            aria-label="Remove binding"
            onClick={() => onChange(Object.fromEntries(entries.filter((_, j) => j !== i)))}
          >
            <X className="size-3" />
          </Button>
        </div>
      ))}
      <div>
        <Button
          type="button"
          variant="outline"
          size="xs"
          onClick={() => onChange({ ...bindings, '': '' })}
        >
          <Plus className="size-3" /> Add binding
        </Button>
      </div>
      <p className="text-[11px] text-muted-foreground">
        Reference results of earlier steps with{' '}
        <code className="font-mono">{'{{stepName.field}}'}</code>.
      </p>
    </div>
  )
}

/* -------------------------------- step editor -------------------------------- */

function StepEditor({
  step,
  index,
  count,
  entityTypeKeys,
  onChange,
  onMove,
  onRemove,
}: {
  step: SavedQueryStep
  index: number
  count: number
  entityTypeKeys: string[]
  onChange: (patch: Partial<SavedQueryStep>) => void
  onMove: (dir: -1 | 1) => void
  onRemove: () => void
}) {
  return (
    <div className="rounded-lg border bg-muted/20 p-3">
      <div className="mb-2 flex items-center gap-2">
        <Badge variant="outline" className="font-mono text-[10px]">
          {index + 1}
        </Badge>
        <Input
          value={step.name}
          onChange={(e) => onChange({ name: e.target.value })}
          placeholder="step name"
          className="h-7 w-40 font-mono text-xs"
          aria-label="Step name"
        />
        <Select
          value={step.type}
          onValueChange={(v) => onChange({ type: v as SavedQueryStep['type'] })}
        >
          <SelectTrigger className="h-7 w-44 text-xs" aria-label="Step type">
            <SelectValue />
          </SelectTrigger>
          <SelectContent>
            <SelectItem value="oql">
              <span className="flex items-center gap-1.5">
                <SquareTerminal className="size-3.5" /> Query
              </span>
            </SelectItem>
            <SelectItem value="semantic_search">
              <span className="flex items-center gap-1.5">
                <Braces className="size-3.5" /> Semantic search
              </span>
            </SelectItem>
          </SelectContent>
        </Select>
        <span className="ml-auto flex items-center gap-0.5">
          <Button
            type="button"
            variant="ghost"
            size="icon-xs"
            aria-label="Move step up"
            disabled={index === 0}
            onClick={() => onMove(-1)}
          >
            <ArrowUp className="size-3" />
          </Button>
          <Button
            type="button"
            variant="ghost"
            size="icon-xs"
            aria-label="Move step down"
            disabled={index === count - 1}
            onClick={() => onMove(1)}
          >
            <ArrowDown className="size-3" />
          </Button>
          <Button
            type="button"
            variant="ghost"
            size="icon-xs"
            aria-label="Remove step"
            onClick={onRemove}
          >
            <Trash2 className="size-3 text-destructive" />
          </Button>
        </span>
      </div>

      {step.type === 'oql' && (
        <Textarea
          value={step.oql ?? ''}
          onChange={(e) => onChange({ oql: e.target.value })}
          rows={3}
          className="font-mono text-xs"
          placeholder="MATCH (p:person) WHERE p.name = $name RETURN p LIMIT 25"
          aria-label="Query"
        />
      )}

      {step.type === 'semantic_search' && (
        <div className="grid gap-2">
          <div className="grid grid-cols-2 gap-2">
            <div className="grid gap-1">
              <Label className="text-xs">Entity type</Label>
              <Select
                value={step.entityTypeKey ?? ''}
                onValueChange={(v) => onChange({ entityTypeKey: v })}
              >
                <SelectTrigger className="h-7 w-full text-xs">
                  <SelectValue placeholder="Select type…" />
                </SelectTrigger>
                <SelectContent>
                  {entityTypeKeys.map((key) => (
                    <SelectItem key={key} value={key}>
                      <span className="flex items-center gap-1.5">
                        <TypeDot typeKey={key} />
                        <span className="font-mono text-xs">{key}</span>
                      </span>
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>
            <div className="grid gap-1">
              <Label className="text-xs">Query text</Label>
              <Input
                value={step.query ?? ''}
                onChange={(e) => onChange({ query: e.target.value })}
                placeholder="what to search for ($params allowed)"
                className="h-7 text-xs"
              />
            </div>
          </div>
          <div className="grid grid-cols-2 gap-2">
            <div className="grid gap-1">
              <Label className="text-xs">Limit</Label>
              <Input
                type="number"
                min={1}
                max={100}
                value={step.limit ?? ''}
                onChange={(e) =>
                  onChange({
                    limit: e.target.value === '' ? undefined : Number(e.target.value),
                  })
                }
                className="h-7 text-xs"
                placeholder="10"
              />
            </div>
            <div className="grid gap-1">
              <Label className="text-xs">Min score</Label>
              <Input
                type="number"
                min={0}
                max={1}
                step="0.05"
                value={step.minScore ?? ''}
                onChange={(e) =>
                  onChange({
                    minScore: e.target.value === '' ? undefined : Number(e.target.value),
                  })
                }
                className="h-7 text-xs"
                placeholder="0.7"
              />
            </div>
          </div>
        </div>
      )}

      {index > 0 && (
        <div className="mt-2 border-t pt-2">
          <BindingsEditor
            bindings={step.bindings ?? {}}
            onChange={(bindings) =>
              onChange({
                bindings: Object.keys(bindings).length === 0 ? undefined : bindings,
              })
            }
          />
        </div>
      )}
    </div>
  )
}

/* ------------------------------- editor dialog ------------------------------- */

interface SavedQueryDialogProps {
  /** Modeling saved-query routes are addressed by ontology KEY (not UUID). */
  ontologyKey: string
  /** null → create mode. */
  query: SavedQuery | null
  open: boolean
  onOpenChange: (open: boolean) => void
}

function SavedQueryDialog({ ontologyKey, query, open, onOpenChange }: SavedQueryDialogProps) {
  const isEdit = query !== null
  const queryClient = useQueryClient()

  const entityTypesQuery = useQuery({
    queryKey: qk.model('entity-types'),
    queryFn: model.listEntityTypes,
  })
  const entityTypeKeys = (entityTypesQuery.data ?? []).map((t) => t.key)

  const [key, setKey] = useState('')
  const [keyTouched, setKeyTouched] = useState(false)
  const [name, setName] = useState('')
  const [description, setDescription] = useState('')
  const [steps, setSteps] = useState<SavedQueryStep[]>([])
  const [parameters, setParameters] = useState<SavedQueryParameter[]>([])

  const [wasOpen, setWasOpen] = useState(false)
  if (open !== wasOpen) {
    setWasOpen(open)
    if (open) {
      setKey(query?.key ?? '')
      setKeyTouched(isEdit)
      setName(query?.name ?? '')
      setDescription(query?.description ?? '')
      setSteps(query?.steps.map((s) => ({ ...s })) ?? [{ name: 'step1', type: 'oql', oql: '' }])
      setParameters(query?.parameters.map((p) => ({ ...p })) ?? [])
    }
  }

  const updateStep = (index: number, patch: Partial<SavedQueryStep>) => {
    setSteps((prev) => prev.map((s, i) => (i === index ? { ...s, ...patch } : s)))
  }
  const moveStep = (index: number, dir: -1 | 1) => {
    setSteps((prev) => {
      const next = [...prev]
      const [step] = next.splice(index, 1)
      if (step !== undefined) next.splice(index + dir, 0, step)
      return next
    })
  }

  const cleanSteps = (): SavedQueryStep[] =>
    steps.map((s, i) => {
      const base: SavedQueryStep = { name: s.name.trim(), type: s.type }
      if (s.type === 'oql') {
        base.oql = s.oql ?? ''
      } else {
        base.entityTypeKey = s.entityTypeKey
        base.query = s.query ?? ''
        if (s.limit !== undefined) base.limit = s.limit
        if (s.minScore !== undefined) base.minScore = s.minScore
      }
      if (i > 0 && s.bindings !== undefined && Object.keys(s.bindings).length > 0) {
        base.bindings = s.bindings
      }
      return base
    })

  const save = useMutation({
    // NOTE: the backend requires `description` as a plain string on saved
    // queries and their parameters (it is embedded for semantic discovery).
    mutationFn: () =>
      model.upsertSavedQuery(ontologyKey, key, {
        name: name.trim(),
        description: description.trim(),
        steps: cleanSteps(),
        parameters: parameters.map((p) => ({ ...p, description: p.description ?? '' })),
      }),
    onSuccess: (saved) => {
      invalidateModeling(queryClient)
      toast.success(isEdit ? `Query "${saved.key}" updated` : `Query "${saved.key}" created`)
      onOpenChange(false)
    },
    onError: toastError,
  })

  const stepsValid = steps.every(
    (s) =>
      s.name.trim() !== '' &&
      (s.type === 'oql'
        ? (s.oql ?? '').trim() !== ''
        : (s.entityTypeKey ?? '') !== '' && (s.query ?? '').trim() !== ''),
  )
  const paramsValid = parameters.every((p) => p.name.trim() !== '')
  const valid =
    isValidKey(key) && name.trim() !== '' && steps.length > 0 && stepsValid && paramsValid

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-h-[88dvh] overflow-y-auto sm:max-w-2xl">
        <DialogHeader>
          <DialogTitle>{isEdit ? `Edit query "${query.key}"` : 'New saved query'}</DialogTitle>
          <DialogDescription>
            Multi-step pipelines of query and semantic-search steps. Later steps can bind
            values from earlier results.
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
              <Label htmlFor="sq-name">Name</Label>
              <Input
                id="sq-name"
                value={name}
                autoFocus
                onChange={(e) => {
                  setName(e.target.value)
                  if (!keyTouched) setKey(deriveKey(e.target.value))
                }}
                placeholder="Find colleagues"
              />
            </div>
            <KeyField
              id="sq-key"
              value={key}
              onChange={(v) => {
                setKeyTouched(true)
                setKey(v)
              }}
              disabled={isEdit}
            />
          </div>
          <div className="grid gap-1.5">
            <Label htmlFor="sq-desc">Description</Label>
            <Textarea
              id="sq-desc"
              value={description}
              onChange={(e) => setDescription(e.target.value)}
              rows={2}
              placeholder="Used for semantic discovery of this query — describe what it answers."
            />
          </div>

          <div className="grid gap-2">
            <div className="flex items-center gap-2">
              <Label>Steps</Label>
              <span className="ml-auto flex gap-1.5">
                <Button
                  type="button"
                  variant="outline"
                  size="xs"
                  onClick={() =>
                    setSteps((prev) => [
                      ...prev,
                      { name: `step${prev.length + 1}`, type: 'oql', oql: '' },
                    ])
                  }
                >
                  <Plus className="size-3" /> Query step
                </Button>
                <Button
                  type="button"
                  variant="outline"
                  size="xs"
                  onClick={() =>
                    setSteps((prev) => [
                      ...prev,
                      {
                        name: `step${prev.length + 1}`,
                        type: 'semantic_search',
                        entityTypeKey: entityTypeKeys[0] ?? '',
                        query: '',
                        limit: 10,
                      },
                    ])
                  }
                >
                  <Plus className="size-3" /> Semantic step
                </Button>
              </span>
            </div>
            {steps.map((step, i) => (
              <StepEditor
                key={i}
                step={step}
                index={i}
                count={steps.length}
                entityTypeKeys={entityTypeKeys}
                onChange={(patch) => updateStep(i, patch)}
                onMove={(dir) => moveStep(i, dir)}
                onRemove={() => setSteps((prev) => prev.filter((_, j) => j !== i))}
              />
            ))}
            {steps.length === 0 && (
              <p className="rounded-lg border border-dashed p-3 text-center text-xs text-muted-foreground">
                Add at least one step.
              </p>
            )}
          </div>

          <div className="grid gap-2">
            <div className="flex items-center gap-2">
              <Label>Parameters</Label>
              <Button
                type="button"
                variant="outline"
                size="xs"
                className="ml-auto"
                onClick={() =>
                  setParameters((prev) => [
                    ...prev,
                    { name: '', description: null, dataType: 'string' },
                  ])
                }
              >
                <Plus className="size-3" /> Add parameter
              </Button>
            </div>
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
                  className="h-7 w-36 font-mono text-xs"
                  aria-label="Parameter name"
                />
                <Input
                  value={p.description ?? ''}
                  onChange={(e) =>
                    setParameters((prev) =>
                      prev.map((q, j) =>
                        j === i
                          ? { ...q, description: e.target.value === '' ? null : e.target.value }
                          : q,
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
                      prev.map((q, j) => (j === i ? { ...q, dataType: v as DataType } : q)),
                    )
                  }
                >
                  <SelectTrigger className="h-7 w-28 text-xs" aria-label="Parameter data type">
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
                <Button
                  type="button"
                  variant="ghost"
                  size="icon-xs"
                  aria-label="Remove parameter"
                  onClick={() => setParameters((prev) => prev.filter((_, j) => j !== i))}
                >
                  <X className="size-3" />
                </Button>
              </div>
            ))}
            {parameters.length > 0 && (
              <p className="text-[11px] text-muted-foreground">
                Reference parameters in query and search text as{' '}
                <code className="font-mono">$name</code>.
              </p>
            )}
          </div>

          <DialogFooter>
            <Button type="button" variant="ghost" onClick={() => onOpenChange(false)}>
              Cancel
            </Button>
            <Button type="submit" disabled={!valid || save.isPending}>
              {isEdit ? 'Save query' : 'Create query'}
            </Button>
          </DialogFooter>
        </form>
      </DialogContent>
    </Dialog>
  )
}

/* -------------------------------- test runner -------------------------------- */

function formatCell(value: JsonValue | undefined): string {
  if (value === undefined || value === null) return '—'
  if (typeof value === 'object') {
    const s = JSON.stringify(value)
    return s.length > 120 ? `${s.slice(0, 120)}…` : s
  }
  return String(value)
}

/** Inline test runner for a saved query: param inputs → run → results. */
function SavedQueryRunner({
  ontologyKey,
  query,
}: {
  ontologyKey: string
  query: SavedQuery
}) {
  const [raw, setRaw] = useState<Record<string, string>>({})
  const [result, setResult] = useState<QueryResult | null>(null)
  const [error, setError] = useState<string | null>(null)
  const [showRaw, setShowRaw] = useState(false)

  const run = useMutation({
    mutationFn: () => {
      const params: Record<string, JsonValue> = {}
      for (const p of query.parameters) {
        const value = coerceTypedValue(p.dataType, raw[p.name] ?? '')
        if (value !== null) params[p.name] = value
      }
      return runtime.runSavedQuery(ontologyKey, query.key, params)
    },
    onSuccess: (res) => {
      setResult(res)
      setError(null)
    },
    onError: (err) => {
      setResult(null)
      setError(err instanceof Error ? err.message : String(err))
    },
  })

  return (
    <div className="space-y-3 rounded-b-xl border-t bg-muted/20 px-4 py-3">
      {query.parameters.length > 0 && (
        <div className="grid gap-2 sm:grid-cols-2">
          {query.parameters.map((p) => (
            <div key={p.name} className="grid gap-1">
              <Label htmlFor={`run-${query.key}-${p.name}`} className="text-xs">
                <span className="font-mono">{p.name}</span>
                <span className="ml-1 font-normal text-muted-foreground">({p.dataType})</span>
              </Label>
              <TypedValueInput
                id={`run-${query.key}-${p.name}`}
                dataType={p.dataType}
                value={raw[p.name] ?? ''}
                onChange={(v) => setRaw((prev) => ({ ...prev, [p.name]: v }))}
                placeholder={p.description ?? undefined}
                allowEmptyBoolean
              />
            </div>
          ))}
        </div>
      )}
      <div className="flex items-center gap-2">
        <Button size="sm" onClick={() => run.mutate()} disabled={run.isPending}>
          <Play className="size-3.5" />
          {run.isPending ? 'Running…' : 'Run'}
        </Button>
        {result !== null && (
          <>
            <span className="text-xs text-muted-foreground">
              {result.results.length} row{result.results.length === 1 ? '' : 's'}
            </span>
            <Button variant="ghost" size="xs" onClick={() => setShowRaw((s) => !s)}>
              <Braces className="size-3" /> {showRaw ? 'Table' : 'Raw JSON'}
            </Button>
          </>
        )}
      </div>
      {error !== null && (
        <pre className="overflow-x-auto whitespace-pre-wrap rounded-lg border border-destructive/40 bg-destructive/5 p-3 font-mono text-xs text-destructive">
          {error}
        </pre>
      )}
      {result !== null && showRaw && (
        <pre className="max-h-80 overflow-auto rounded-lg border bg-card p-3 font-mono text-[11px]">
          {JSON.stringify(result, null, 2)}
        </pre>
      )}
      {result !== null && !showRaw && (
        <div className="max-h-80 overflow-auto rounded-lg border bg-card">
          {result.results.length === 0 ? (
            <p className="p-4 text-center text-xs text-muted-foreground">No rows.</p>
          ) : (
            <Table>
              <TableHeader>
                <TableRow>
                  {result.columns.map((c) => (
                    <TableHead key={c} className="font-mono text-xs">
                      {c}
                    </TableHead>
                  ))}
                </TableRow>
              </TableHeader>
              <TableBody>
                {result.results.map((row, i) => (
                  <TableRow key={i}>
                    {result.columns.map((c) => (
                      <TableCell
                        key={c}
                        className="max-w-72 truncate font-mono text-[11px]"
                        title={formatCell(row[c])}
                      >
                        {formatCell(row[c])}
                      </TableCell>
                    ))}
                  </TableRow>
                ))}
              </TableBody>
            </Table>
          )}
        </div>
      )}
    </div>
  )
}

/* ----------------------------------- tab ------------------------------------ */

/** Saved queries tab: list + editor dialog + inline test runner. */
export function SavedQueriesTab({ ontology }: { ontology: Ontology }) {
  const queryClient = useQueryClient()
  const [dialogOpen, setDialogOpen] = useState(false)
  const [editing, setEditing] = useState<SavedQuery | null>(null)
  const [toDelete, setToDelete] = useState<SavedQuery | null>(null)
  const [runnerKey, setRunnerKey] = useState<string | null>(null)

  // NOTE: modeling saved-query routes are key-addressed, unlike the other
  // /api/model/ontologies/{id}/... routes.
  const queriesQuery = useQuery({
    queryKey: qk.model('ontologies', ontology.key, 'saved-queries'),
    queryFn: () => model.listSavedQueries(ontology.key),
  })
  const queries = queriesQuery.data

  const remove = useMutation({
    mutationFn: (queryKey: string) => model.deleteSavedQuery(ontology.key, queryKey),
    onSuccess: () => {
      invalidateModeling(queryClient)
      toast.success('Saved query deleted')
    },
    onError: toastError,
  })

  return (
    <div>
      <div className="mb-3 flex items-center gap-2">
        <h3 className="text-[13px] font-semibold">Saved queries</h3>
        <span className="text-[13px] text-muted-foreground">{queries?.length ?? 0}</span>
        <Button
          size="sm"
          className="ml-auto"
          onClick={() => {
            setEditing(null)
            setDialogOpen(true)
          }}
        >
          <Plus className="size-3.5" /> New query
        </Button>
      </div>

      {queriesQuery.isPending && <Skeleton className="h-32 rounded-xl" />}

      {queries !== undefined && queries.length === 0 && (
        <EmptyState
          icon={SquareTerminal}
          title="No saved queries"
          description="Saved queries are reusable multi-step pipelines, runnable from the workbench, REST and MCP."
          action={
            <Button
              onClick={() => {
                setEditing(null)
                setDialogOpen(true)
              }}
            >
              <Plus className="size-4" /> New query
            </Button>
          }
        />
      )}

      {queries !== undefined && queries.length > 0 && (
        <div className="space-y-2">
          {queries.map((q) => (
            <div key={q.key} className="rounded-xl border bg-card">
              <div className="flex items-center gap-3 px-4 py-3">
                <SquareTerminal className="size-4 shrink-0 text-muted-foreground" />
                <div className="min-w-0 flex-1">
                  <div className="flex items-center gap-2">
                    <span className="truncate text-[13px] font-medium">{q.name}</span>
                    <span className="font-mono text-[11px] text-muted-foreground">{q.key}</span>
                    <Badge variant="secondary" className="text-[10px]">
                      {q.steps.length} step{q.steps.length === 1 ? '' : 's'}
                    </Badge>
                    {q.parameters.length > 0 && (
                      <Badge variant="outline" className="text-[10px]">
                        {q.parameters.length} param{q.parameters.length === 1 ? '' : 's'}
                      </Badge>
                    )}
                  </div>
                  {q.description !== null && (
                    <p className="truncate text-[12px] text-muted-foreground">{q.description}</p>
                  )}
                </div>
                <Button
                  variant={runnerKey === q.key ? 'secondary' : 'ghost'}
                  size="sm"
                  onClick={() => setRunnerKey((k) => (k === q.key ? null : q.key))}
                >
                  <Play className="size-3.5" /> Run
                </Button>
                <Button
                  variant="ghost"
                  size="icon-sm"
                  aria-label={`Edit ${q.key}`}
                  onClick={() => {
                    setEditing(q)
                    setDialogOpen(true)
                  }}
                >
                  <Pencil className="size-3.5" />
                </Button>
                <Button
                  variant="ghost"
                  size="icon-sm"
                  aria-label={`Delete ${q.key}`}
                  onClick={() => setToDelete(q)}
                >
                  <Trash2 className="size-3.5 text-destructive" />
                </Button>
              </div>
              {runnerKey === q.key && (
                <SavedQueryRunner ontologyKey={ontology.key} query={q} />
              )}
            </div>
          ))}
        </div>
      )}

      <SavedQueryDialog
        ontologyKey={ontology.key}
        query={editing}
        open={dialogOpen}
        onOpenChange={setDialogOpen}
      />

      <AlertDialog
        open={toDelete !== null}
        onOpenChange={(open) => !open && setToDelete(null)}
      >
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>Delete query "{toDelete?.key ?? ''}"?</AlertDialogTitle>
            <AlertDialogDescription>
              The saved query is removed from this ontology. This cannot be undone.
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel>Cancel</AlertDialogCancel>
            <AlertDialogAction
              variant="destructive"
              onClick={() => {
                if (toDelete !== null) remove.mutate(toDelete.key)
              }}
            >
              Delete query
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </div>
  )
}
