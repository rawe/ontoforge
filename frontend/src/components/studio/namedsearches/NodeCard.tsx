import type { ReactNode } from 'react'
import { MoreHorizontal, Plus, X } from 'lucide-react'
import type { SearchCatalogEntry, SearchPartKind, SearchTreeNode } from '@/api/types'
import { TypeDot } from '@/components/TypeChip'
import { IndexExplainerButton } from '@/components/search/explainer/IndexExplainer'
import { Button } from '@/components/ui/button'
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuSeparator,
  DropdownMenuSub,
  DropdownMenuSubContent,
  DropdownMenuSubTrigger,
  DropdownMenuTrigger,
} from '@/components/ui/dropdown-menu'
import { Input } from '@/components/ui/input'
import { Label } from '@/components/ui/label'
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select'
import { cn } from '@/lib/utils'
import {
  KIND_HINT,
  KIND_LABEL,
  NODE_KINDS,
  WRAP_KINDS,
  addAt,
  childPath,
  inputsOf,
  newNode,
  nodeAt,
  removal,
  removeAt,
  replaceAt,
  wrapAt,
  type NodeDefaults,
} from './namedSearchModel'

/** What every card of one tree shares: the tree, what its fields choose from, and its errors. */
export interface TreeEditing {
  tree: SearchTreeNode
  /** The lens's search catalog. */
  indices: readonly SearchCatalogEntry[]
  /** The entity types the lens shows. */
  entityTypes: readonly string[]
  defaults: NodeDefaults
  /** The last save's reasons, by node path. */
  errors: Readonly<Record<string, string[]>>
  disabled: boolean
  onTree: (tree: SearchTreeNode) => void
}

const PARTS: readonly SearchPartKind[] = ['self', 'relation', 'passage']

/** A slot's name above its card: `input`, `input 2`, `filter 1`. */
function slotName(segment: string): string {
  const [list, at] = segment.split('.')
  if (at === undefined) return 'input'
  return `${list === 'filters' ? 'filter' : 'input'} ${Number(at) + 1}`
}

/**
 * One node of the tree as a card — its kind in plain words, its fields, the
 * reasons the last save gave at it, and its inputs as cards indented below.
 * The menu replaces it, wraps it in a node that takes it as input, or
 * removes it; a merge or fuse adds inputs, a restrict filters.
 */
export function NodeCard({ path, segment, editing }: {
  path: string
  /** Its slot in the parent (`input`, `inputs.1`); none for the root. */
  segment?: string
  editing: TreeEditing
}) {
  const { tree, defaults, errors, disabled, onTree } = editing
  const node = nodeAt(tree, path)
  if (node === undefined) return null
  const set = (next: SearchTreeNode) => onTree(replaceAt(tree, path, next))
  const how = removal(tree, path)
  const own = errors[path] ?? []

  return (
    <div
      data-node-path={path}
      className={cn(
        'min-w-52 rounded-lg border bg-card p-2.5 sm:p-3',
        own.length > 0 && 'border-destructive/60',
      )}
    >
      <div className="flex items-start gap-2">
        <div className="min-w-0 flex-1">
          <div className="flex flex-wrap items-baseline gap-x-2">
            <span className="text-[13px] font-semibold">{KIND_LABEL[node.kind]}</span>
            {segment !== undefined && <span className="text-[11px] text-muted-foreground">{slotName(segment)}</span>}
          </div>
          <p className="text-[11px] text-muted-foreground">{KIND_HINT[node.kind]}</p>
        </div>
        <DropdownMenu>
          <DropdownMenuTrigger asChild>
            <Button type="button" variant="ghost" size="icon-xs" aria-label={`${KIND_LABEL[node.kind]} actions`} disabled={disabled}>
              <MoreHorizontal className="size-3.5" />
            </Button>
          </DropdownMenuTrigger>
          <DropdownMenuContent align="end" className="w-48">
            <DropdownMenuSub>
              <DropdownMenuSubTrigger>Replace with</DropdownMenuSubTrigger>
              <DropdownMenuSubContent>
                {NODE_KINDS.map((kind) => (
                  <DropdownMenuItem key={kind} onSelect={() => set(newNode(kind, defaults))}>
                    {KIND_LABEL[kind]}
                  </DropdownMenuItem>
                ))}
              </DropdownMenuSubContent>
            </DropdownMenuSub>
            <DropdownMenuSub>
              <DropdownMenuSubTrigger>Wrap in</DropdownMenuSubTrigger>
              <DropdownMenuSubContent>
                {WRAP_KINDS.map((kind) => (
                  <DropdownMenuItem key={kind} onSelect={() => onTree(wrapAt(tree, path, kind, defaults))}>
                    {KIND_LABEL[kind]}
                  </DropdownMenuItem>
                ))}
              </DropdownMenuSubContent>
            </DropdownMenuSub>
            {how !== null && (
              <>
                <DropdownMenuSeparator />
                <DropdownMenuItem variant="destructive" onSelect={() => onTree(removeAt(tree, path))}>
                  {how === 'unwrap' ? 'Remove, keep its input' : 'Remove'}
                </DropdownMenuItem>
              </>
            )}
          </DropdownMenuContent>
        </DropdownMenu>
      </div>

      {own.length > 0 && (
        <ul role="alert" className="mt-1.5 space-y-0.5 text-xs text-destructive">
          {own.map((line, i) => <li key={i} className="break-words">{line}</li>)}
        </ul>
      )}

      {/* Keyed by kind: a replaced node's fields mount afresh, so no select keeps the old one's value. */}
      <NodeFields key={node.kind} node={node} editing={editing} onChange={set} />

      {inputsOf(node).length > 0 || node.kind === 'merge' || node.kind === 'fuse' || node.kind === 'restrict' ? (
        <div className="mt-2.5 grid gap-2 border-l-2 pl-2 sm:pl-3">
          {inputsOf(node).map(([s]) => (
            <NodeCard key={s} path={childPath(path, s)} segment={s} editing={editing} />
          ))}
          {(node.kind === 'merge' || node.kind === 'fuse') && (
            <AddInput onAdd={(kind) => onTree(addAt(tree, path, newNode(kind, defaults)))} disabled={disabled} />
          )}
          {node.kind === 'restrict' && (
            <div>
              <Button
                type="button"
                variant="outline"
                size="xs"
                disabled={disabled}
                onClick={() => onTree(addAt(tree, path, newNode('filter', defaults)))}
              >
                <Plus className="size-3" /> Add filter
              </Button>
            </div>
          )}
        </div>
      ) : null}
    </div>
  )
}

/** The "+ Add input" menu of a merge or fuse: one entry per kind. */
function AddInput({ onAdd, disabled }: { onAdd: (kind: SearchTreeNode['kind']) => void; disabled: boolean }) {
  return (
    <div>
      <DropdownMenu>
        <DropdownMenuTrigger asChild>
          <Button type="button" variant="outline" size="xs" disabled={disabled}>
            <Plus className="size-3" /> Add input
          </Button>
        </DropdownMenuTrigger>
        <DropdownMenuContent className="w-44">
          {NODE_KINDS.filter((kind) => kind !== 'filter').map((kind) => (
            <DropdownMenuItem key={kind} onSelect={() => onAdd(kind)}>
              {KIND_LABEL[kind]}
            </DropdownMenuItem>
          ))}
        </DropdownMenuContent>
      </DropdownMenu>
    </div>
  )
}

/** A labelled field of a card. */
function Field({ label, className, children }: { label: string; className?: string; children: ReactNode }) {
  return (
    <div className={cn('grid min-w-0 gap-1', className)}>
      <Label className="text-[11px] font-normal text-muted-foreground">{label}</Label>
      {children}
    </div>
  )
}

/** A number input's value: empty while the number is not one. */
const shown = (value: number | undefined) => (value === undefined || !Number.isFinite(value) ? '' : value)

/** The fields of a node's own kind. */
function NodeFields({
  node,
  editing,
  onChange,
}: {
  node: SearchTreeNode
  editing: TreeEditing
  onChange: (node: SearchTreeNode) => void
}) {
  const { indices, entityTypes, disabled } = editing
  switch (node.kind) {
    case 'keywordSearch':
    case 'semanticSearch':
      return (
        <div className="mt-2 grid gap-2 sm:grid-cols-2">
          <Field label="Index">
            <Select value={node.index} onValueChange={(index) => onChange({ ...node, index })} disabled={disabled}>
              <SelectTrigger className="h-7 w-full min-w-0 text-xs *:data-[slot=select-value]:min-w-0" aria-label="Index">
                <SelectValue placeholder="Choose an index" />
              </SelectTrigger>
              <SelectContent>
                {node.index !== '' && !indices.some((i) => i.key === node.index) && (
                  <SelectItem value={node.index}>
                    <span className="font-mono text-xs">{node.index}</span>
                  </SelectItem>
                )}
                {indices.map((i) => (
                  <SelectItem key={i.key} value={i.key}>
                    <span className="flex min-w-0 items-center gap-1.5 text-xs">
                      <TypeDot typeKey={i.entityType} />
                      <span className="truncate">{i.name}</span>
                      <span className="truncate font-mono text-[10.5px] text-muted-foreground">{i.key}</span>
                    </span>
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
          </Field>
          <Field label="Text">
            <Input
              value={node.text}
              disabled={disabled}
              onChange={(e) => onChange({ ...node, text: e.target.value })}
              className="h-7 font-mono text-xs"
              aria-label="Text"
            />
          </Field>
          {node.kind === 'keywordSearch' ? (
            <Field label="Words">
              <Select
                value={node.match ?? 'any'}
                onValueChange={(match) => onChange({ ...node, match: match === 'all' ? 'all' : undefined })}
                disabled={disabled}
              >
                <SelectTrigger className="h-7 w-full text-xs" aria-label="Keyword match">
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value="any">match any word</SelectItem>
                  <SelectItem value="all">match all words</SelectItem>
                </SelectContent>
              </Select>
            </Field>
          ) : (
            <Field label="Minimum similarity (0–1)">
              <Input
                type="number"
                min={0}
                max={1}
                step={0.05}
                value={shown(node.minSimilarity)}
                disabled={disabled}
                onChange={(e) =>
                  onChange({ ...node, minSimilarity: e.target.value === '' ? undefined : Number(e.target.value) })
                }
                placeholder="no floor"
                className="h-7 text-xs"
                aria-label="Minimum similarity"
              />
            </Field>
          )}
          <Field label="Parts (none: every part)">
            <div className="flex flex-wrap gap-1">
              {PARTS.map((part) => {
                const on = node.parts?.includes(part) ?? false
                return (
                  <button
                    key={part}
                    type="button"
                    disabled={disabled}
                    aria-pressed={on}
                    onClick={() => {
                      const parts = on ? (node.parts ?? []).filter((p) => p !== part) : [...(node.parts ?? []), part]
                      onChange({ ...node, parts: parts.length === 0 ? undefined : parts })
                    }}
                    className={cn(
                      'rounded-md border px-2 py-0.5 font-mono text-[11px] transition-colors',
                      on ? 'border-primary bg-primary/10 text-foreground' : 'text-muted-foreground hover:bg-muted',
                    )}
                  >
                    {part}
                  </button>
                )
              })}
            </div>
            <p className="flex flex-wrap items-center gap-x-2 gap-y-1 text-[11px] text-muted-foreground">
              self: own fields · relation: one relation · passage: one chunk of a document — only the parts this index makes.
              <IndexExplainerButton labeled parts className="h-6 px-2 text-[11px]" />
            </p>
          </Field>
          {node.relations !== undefined && (
            <p className="text-[11px] text-muted-foreground sm:col-span-2">
              Relations: <span className="font-mono">{node.relations.join(', ') || 'none'}</span>
            </p>
          )}
        </div>
      )
    case 'group':
      return (
        <div className="mt-2 grid gap-2 sm:grid-cols-2">
          <Field label="One item per">
            <Select
              value={node.key}
              onValueChange={(key) => onChange({ ...node, key: key === 'passage' ? 'passage' : 'entity' })}
              disabled={disabled}
            >
              <SelectTrigger className="h-7 w-full text-xs" aria-label="Group by">
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value="entity">entity</SelectItem>
                <SelectItem value="passage">passage</SelectItem>
              </SelectContent>
            </Select>
          </Field>
        </div>
      )
    case 'cut':
      return (
        <div className="mt-2 grid grid-cols-2 gap-2 sm:max-w-sm">
          <Field label="Limit (1–100)">
            <Input
              type="number"
              min={1}
              max={100}
              value={shown(node.limit)}
              disabled={disabled}
              onChange={(e) => onChange({ ...node, limit: e.target.value === '' ? Number.NaN : Number(e.target.value) })}
              className="h-7 text-xs"
              aria-label="Limit"
            />
          </Field>
          <Field label="Per entity (passages)">
            <Input
              type="number"
              min={1}
              value={shown(node.perEntity)}
              disabled={disabled}
              onChange={(e) =>
                onChange({ ...node, perEntity: e.target.value === '' ? undefined : Number(e.target.value) })
              }
              placeholder="no cap"
              className="h-7 text-xs"
              aria-label="Per entity"
            />
          </Field>
        </div>
      )
    case 'filter':
      return <FilterFields node={node} entityTypes={entityTypes} disabled={disabled} onChange={onChange} />
    default:
      return null
  }
}

/** A filter's entity type and its conditions as key = value rows; a type that lacks a key is an error. */
function FilterFields({
  node,
  entityTypes,
  disabled,
  onChange,
}: {
  node: Extract<SearchTreeNode, { kind: 'filter' }>
  entityTypes: readonly string[]
  disabled: boolean
  onChange: (node: SearchTreeNode) => void
}) {
  const rows = Object.entries(node.conditions)
  const setRows = (next: (readonly [string, string])[]) => onChange({ ...node, conditions: Object.fromEntries(next) })
  return (
    <div className="mt-2 grid gap-2">
      <Field label="Entity type" className="sm:max-w-60">
        <Select value={node.entityType} onValueChange={(entityType) => onChange({ ...node, entityType })} disabled={disabled}>
          <SelectTrigger className="h-7 w-full text-xs" aria-label="Entity type">
            <SelectValue placeholder="Choose a type" />
          </SelectTrigger>
          <SelectContent>
            {node.entityType !== '' && !entityTypes.includes(node.entityType) && (
              <SelectItem value={node.entityType}>
                <span className="font-mono text-xs">{node.entityType}</span>
              </SelectItem>
            )}
            {entityTypes.map((type) => (
              <SelectItem key={type} value={type}>
                <span className="flex items-center gap-1.5 font-mono text-xs">
                  <TypeDot typeKey={type} />
                  {type}
                </span>
              </SelectItem>
            ))}
          </SelectContent>
        </Select>
      </Field>
      <Field label="Conditions (all must hold)">
        {rows.map(([k, v], i) => (
          <div key={i} className="flex items-center gap-1.5">
            <Input
              value={k}
              disabled={disabled}
              onChange={(e) => setRows(rows.map((r, j) => (j === i ? [e.target.value, v] : r)))}
              placeholder="key"
              className="h-7 min-w-0 flex-1 font-mono text-xs"
              aria-label="Condition key"
            />
            <span className="text-muted-foreground">=</span>
            <Input
              value={v}
              disabled={disabled}
              onChange={(e) => setRows(rows.map((r, j) => (j === i ? [k, e.target.value] : r)))}
              placeholder="value"
              className="h-7 min-w-0 flex-[2] font-mono text-xs"
              aria-label="Condition value"
            />
            <Button
              type="button"
              variant="ghost"
              size="icon-xs"
              aria-label="Remove condition"
              disabled={disabled}
              onClick={() => setRows(rows.filter((_, j) => j !== i))}
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
            disabled={disabled || '' in node.conditions}
            onClick={() => onChange({ ...node, conditions: { ...node.conditions, '': '' } })}
          >
            <Plus className="size-3" /> Add condition
          </Button>
        </div>
        <p className="text-[11px] text-muted-foreground">
          Keys as in the entity search's filter: a property, or with an operator (<code className="font-mono">__gte</code>, <code className="font-mono">__contains</code>, …).
        </p>
      </Field>
    </div>
  )
}
