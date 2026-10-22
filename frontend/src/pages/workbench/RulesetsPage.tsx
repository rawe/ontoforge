import { useMutation, useQueryClient } from '@tanstack/react-query'
import {
  Anchor as AnchorIcon,
  Copy,
  EyeOff,
  ListTree,
  Loader2,
  MoreHorizontal,
  PencilLine,
  Plus,
  ScrollText,
  Trash2,
  TriangleAlert,
  Waypoints,
} from 'lucide-react'
import { useRef, useState } from 'react'
import { Link, useParams } from 'react-router-dom'
import { toast } from 'sonner'
import { useRuntimeSchema, useRulesets, useRulesetView, useServerInfo } from '@/api/hooks'
import { qk } from '@/api/queryKeys'
import * as runtime from '@/api/runtime'
import type { Ruleset, RulesetView } from '@/api/types'
import { EmptyState } from '@/components/EmptyState'
import { PageHeader } from '@/components/PageHeader'
import { RulesetDialog, type RulesetDialogTarget } from '@/components/rulesets/RulesetDialog'
import { WriteAccessChip } from '@/components/rulesets/WriteAccessChip'
import { RulesetExplainerButton } from '@/components/rulesets/explainer/RulesetExplainer'
import {
  anchorPlacement,
  DELETE_CONFIRMATION,
  rulesetMcpUrl,
  writeAccessLevel,
  type AnchorPlacement,
} from '@/components/rulesets/rulesets'
import {
  AlertDialog,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
} from '@/components/ui/alert-dialog'
import { Button } from '@/components/ui/button'
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from '@/components/ui/dropdown-menu'
import { Input } from '@/components/ui/input'
import { Skeleton } from '@/components/ui/skeleton'
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from '@/components/ui/table'
import { Tooltip, TooltipContent, TooltipTrigger } from '@/components/ui/tooltip'
import { cn } from '@/lib/utils'

/**
 * `/o/:ontologyKey/w/:lensKey/rulesets` — the ontology's rulesets, seen
 * through the current lens: key, then one column per rule (write access,
 * anchor; the anchor's name and path from the ruleset mount's root, one read
 * per ruleset). The URLs use the current lens. A "?" beside the title
 * explains what a ruleset does to a client.
 */
export function RulesetsPage() {
  const { ontologyKey, lensKey } = useParams<{ ontologyKey: string; lensKey: string }>()
  const queryClient = useQueryClient()
  const rulesets = useRulesets(ontologyKey)
  const schema = useRuntimeSchema(ontologyKey, lensKey)
  const info = useServerInfo()

  const [dialogTarget, setDialogTarget] = useState<RulesetDialogTarget | null>(null)
  const [deleteTarget, setDeleteTarget] = useState<Ruleset | null>(null)
  const [deleteText, setDeleteText] = useState('')
  const deleteInput = useRef<HTMLInputElement>(null)

  const remove = useMutation({
    mutationFn: (ruleset: Ruleset) => runtime.deleteRuleset(ontologyKey!, ruleset.key),
    onSuccess: (_, ruleset) => {
      // Drop the row first and refresh only the list: the deleted ruleset's own
      // view, still observed, would refetch into a 404.
      queryClient.setQueryData<Ruleset[]>(qk.rulesets(ontologyKey!), (list) =>
        list?.filter((r) => r.key !== ruleset.key),
      )
      void queryClient.invalidateQueries({ queryKey: qk.rulesets(ontologyKey!), exact: true })
      toast.success(`${ruleset.key} deleted`)
      setDeleteTarget(null)
    },
    onError: (err) => toast.error(err instanceof Error ? err.message : 'Failed to delete the ruleset'),
  })

  if (ontologyKey === undefined || lensKey === undefined) return null

  const entityTypes = schema.data?.entityTypes ?? []
  const typeName = (key: string) => entityTypes.find((t) => t.key === key)?.displayName ?? key

  const copyUrl = (ruleset: Ruleset) => {
    const url = rulesetMcpUrl(info.data?.baseUrl ?? null, ontologyKey, lensKey, ruleset.key)
    void navigator.clipboard
      .writeText(url)
      .then(() => toast.success('MCP URL copied'))
      .catch(() => toast.error('Could not copy'))
  }

  return (
    <div>
      <PageHeader
        title="Rulesets"
        meta={<RulesetExplainerButton className="-ml-2" />}
        description="An AI client's own MCP URL, with rules it must follow: what it may do, and where."
        actions={
          <Button size="sm" disabled={schema.data === undefined} onClick={() => setDialogTarget({ mode: 'create' })}>
            <Plus className="size-3.5" />
            New ruleset
          </Button>
        }
      />

      <div className="p-6">
        {rulesets.isPending ? (
          <div className="space-y-2">
            <Skeleton className="h-10 w-full" />
            <Skeleton className="h-10 w-full" />
          </div>
        ) : rulesets.isError ? (
          <p className="text-[13px] text-destructive">{rulesets.error.message}</p>
        ) : rulesets.data.length === 0 ? (
          <EmptyState
            icon={ScrollText}
            title="No rulesets yet"
            description="A ruleset gives an AI client its own MCP URL, with rules on what it may do and where."
          />
        ) : (
          <>
            <Table>
              <TableHeader>
                <TableRow>
                  <TableHead className="w-48">Key</TableHead>
                  <TableHead className="w-36">
                    <span className="inline-flex items-center gap-1.5">
                      <PencilLine className="size-3.5 text-muted-foreground" />
                      Write access
                    </span>
                  </TableHead>
                  <TableHead>
                    <span className="inline-flex items-center gap-1.5">
                      <AnchorIcon className="size-3.5 text-muted-foreground" />
                      Anchor
                    </span>
                  </TableHead>
                  <TableHead className="w-56 text-right">Actions</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {rulesets.data.map((ruleset) => (
                  <RulesetRow
                    key={ruleset.key}
                    ontologyKey={ontologyKey}
                    lensKey={lensKey}
                    ruleset={ruleset}
                    typeName={typeName}
                    canEdit={schema.data !== undefined}
                    onCopy={() => copyUrl(ruleset)}
                    onEdit={() => setDialogTarget({ mode: 'edit', ruleset })}
                    onDelete={() => {
                      setDeleteText('')
                      setDeleteTarget(ruleset)
                    }}
                  />
                ))}
              </TableBody>
            </Table>
            <p className="mt-3 text-[12px] text-muted-foreground">
              The URLs use the current lens, <span className="font-mono">{lensKey}</span>. Rulesets
              belong to the ontology. Every change takes effect on the client's next call.
            </p>
          </>
        )}
      </div>

      {schema.data !== undefined && (
        <RulesetDialog
          ontologyKey={ontologyKey}
          lensKey={lensKey}
          entityTypes={schema.data.entityTypes}
          relationTypes={schema.data.relationTypes}
          existingKeys={(rulesets.data ?? []).map((r) => r.key)}
          target={dialogTarget}
          onClose={() => setDialogTarget(null)}
        />
      )}

      <AlertDialog open={deleteTarget !== null} onOpenChange={(open) => !open && setDeleteTarget(null)}>
        <AlertDialogContent
          className="data-[size=default]:sm:max-w-md"
          // The key field, not Cancel, takes the focus: typing the key is the next step.
          onOpenAutoFocus={(e) => {
            e.preventDefault()
            deleteInput.current?.focus()
          }}
        >
          <AlertDialogHeader>
            <AlertDialogTitle>Delete ruleset {deleteTarget?.key}?</AlertDialogTitle>
            <AlertDialogDescription>{DELETE_CONFIRMATION}</AlertDialogDescription>
          </AlertDialogHeader>
          <label className="grid gap-1.5 text-[12px] text-muted-foreground">
            <span>
              Type <code className="font-mono text-foreground">{deleteTarget?.key}</code> to confirm
            </span>
            <Input
              ref={deleteInput}
              value={deleteText}
              spellCheck={false}
              autoComplete="off"
              className="font-mono"
              onChange={(e) => setDeleteText(e.target.value)}
              onKeyDown={(e) => {
                if (e.key === 'Enter' && deleteTarget !== null && deleteText.trim() === deleteTarget.key) {
                  remove.mutate(deleteTarget)
                }
              }}
            />
          </label>
          <AlertDialogFooter>
            <AlertDialogCancel>Cancel</AlertDialogCancel>
            <Button
              variant="destructive"
              disabled={deleteTarget === null || deleteText.trim() !== deleteTarget.key || remove.isPending}
              onClick={() => deleteTarget !== null && remove.mutate(deleteTarget)}
            >
              {remove.isPending ? <Loader2 className="size-3.5 animate-spin" /> : <Trash2 className="size-3.5" />}
              Delete
            </Button>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </div>
  )
}

/** The write access rule: the level's chip, its one line as the tooltip. */
function WriteAccessCell({ ruleset }: { ruleset: Ruleset }) {
  return (
    <Tooltip>
      <TooltipTrigger asChild>
        <span tabIndex={0} className="inline-flex">
          <WriteAccessChip level={ruleset.writeAccess} />
        </span>
      </TooltipTrigger>
      <TooltipContent>{writeAccessLevel(ruleset.writeAccess).short}</TooltipContent>
    </Tooltip>
  )
}

const PLACEMENT_ICONS: Partial<Record<AnchorPlacement['kind'], typeof ListTree>> = {
  path: ListTree,
  deleted: TriangleAlert,
  hidden: EyeOff,
}

/** The anchor rule: where it points (path and a link to the entity), none, deleted or hidden. */
function AnchorCell({
  ontologyKey,
  lensKey,
  placement,
  shown,
}: {
  ontologyKey: string
  lensKey: string
  placement: AnchorPlacement
  shown: { type: string; id: string } | null
}) {
  const Icon = PLACEMENT_ICONS[placement.kind]
  return (
    <>
      <div
        className={cn(
          'flex min-w-0 items-center gap-1.5 text-[13px]',
          placement.kind === 'path' && 'font-medium text-(--tc-violet)',
          (placement.kind === 'none' || placement.kind === 'hidden' || placement.kind === 'loading') &&
            'text-muted-foreground',
          placement.kind === 'deleted' && 'text-destructive',
        )}
      >
        {Icon !== undefined && <Icon className="size-3.5 shrink-0" />}
        <span className="truncate">{placement.primary}</span>
      </div>
      {placement.secondary !== null &&
        (shown !== null ? (
          <Link
            to={`/o/${ontologyKey}/w/${lensKey}/e/${shown.type}/${shown.id}`}
            className="block truncate text-[11.5px] text-muted-foreground hover:underline"
          >
            {placement.secondary}
          </Link>
        ) : (
          <div className="truncate text-[11.5px] text-muted-foreground">{placement.secondary}</div>
        ))}
    </>
  )
}

/** The anchor's entity when the lens shows it: the cell's link and the menu's Explorer item. */
function shownEntity(view: RulesetView | undefined): { type: string; id: string } | null {
  const anchor = view?.anchor
  if (anchor == null || !anchor.visible || anchor.state !== 'found' || anchor.type === null || anchor.id === null) {
    return null
  }
  return { type: anchor.type, id: anchor.id }
}

interface RulesetRowProps {
  ontologyKey: string
  lensKey: string
  ruleset: Ruleset
  typeName: (typeKey: string) => string
  canEdit: boolean
  onCopy: () => void
  onEdit: () => void
  onDelete: () => void
}

function RulesetRow({
  ontologyKey,
  lensKey,
  ruleset,
  typeName,
  canEdit,
  onCopy,
  onEdit,
  onDelete,
}: RulesetRowProps) {
  // The list carries no name or path: the ruleset mount's root reads them through the lens.
  const view = useRulesetView(ontologyKey, lensKey, ruleset.key)
  const placement: AnchorPlacement = view.isError
    ? { kind: 'loading', primary: view.error.message, secondary: null }
    : anchorPlacement(ruleset, view.data, typeName)
  const deleted = placement.kind === 'deleted'
  const shown = placement.kind === 'path' ? shownEntity(view.data) : null

  return (
    <TableRow className={cn(deleted && 'bg-destructive/10 hover:bg-destructive/15')}>
      <TableCell className="font-mono text-[12.5px]">{ruleset.key}</TableCell>
      <TableCell>
        <WriteAccessCell ruleset={ruleset} />
      </TableCell>
      <TableCell className="min-w-0">
        <AnchorCell ontologyKey={ontologyKey} lensKey={lensKey} placement={placement} shown={shown} />
      </TableCell>
      <TableCell>
        <div className="flex items-center justify-end gap-1.5">
          <Button variant="outline" size="xs" onClick={onCopy}>
            <Copy className="size-3" />
            Copy URL
          </Button>
          <Button
            variant="outline"
            size="xs"
            disabled={!canEdit}
            // On a deleted anchor, Edit… is the fix.
            className={cn(deleted && 'border-destructive font-semibold text-destructive hover:text-destructive')}
            onClick={onEdit}
          >
            Edit…
          </Button>
          <DropdownMenu>
            <DropdownMenuTrigger asChild>
              <Button variant="outline" size="icon-xs" aria-label={`More actions for ${ruleset.key}`}>
                <MoreHorizontal className="size-3.5" />
              </Button>
            </DropdownMenuTrigger>
            <DropdownMenuContent align="end">
              {shown !== null && (
                <>
                  <DropdownMenuItem asChild>
                    <Link to={`/o/${ontologyKey}/w/${lensKey}/explore?focus=${shown.type}:${shown.id}`}>
                      <Waypoints className="size-4" />
                      Show anchor in Explorer
                    </Link>
                  </DropdownMenuItem>
                  <DropdownMenuSeparator />
                </>
              )}
              <DropdownMenuItem variant="destructive" onSelect={onDelete}>
                <Trash2 className="size-4" />
                Delete
              </DropdownMenuItem>
            </DropdownMenuContent>
          </DropdownMenu>
        </div>
      </TableCell>
    </TableRow>
  )
}
