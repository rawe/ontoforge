import { useMutation, useQueryClient } from '@tanstack/react-query'
import { Anchor as AnchorIcon, Copy, Loader2, MoreHorizontal, Plus, Trash2, Waypoints } from 'lucide-react'
import { useRef, useState } from 'react'
import { Link, useParams } from 'react-router-dom'
import { toast } from 'sonner'
import { useAnchors, useAnchorView, useRuntimeSchema, useServerInfo } from '@/api/hooks'
import { qk } from '@/api/queryKeys'
import * as runtime from '@/api/runtime'
import type { Anchor, AnchorView } from '@/api/types'
import { EmptyState } from '@/components/EmptyState'
import { PageHeader } from '@/components/PageHeader'
import { AnchorDialog, type AnchorDialogTarget } from '@/components/rulesets/RulesetDialog'
import { AnchorExplainerButton } from '@/components/rulesets/explainer/AnchorExplainer'
import {
  anchoredMcpUrl,
  anchorPlacement,
  DELETE_CONFIRMATION,
  STAGED_ONLY_DANGLING_REASON,
  stagedOnlyOffConfirmation,
  unanchorConfirmation,
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
import { Switch } from '@/components/ui/switch'
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

const STATE_CHIPS: Record<Anchor['state'], string> = {
  anchored: 'border-transparent bg-(--tc-teal-bg) text-(--tc-teal)',
  unanchored: 'border-border bg-muted text-muted-foreground',
  dangling: 'border-destructive bg-background text-destructive',
}

/**
 * `/o/:ontologyKey/w/:lensKey/anchors` — the ontology's anchors, seen through
 * the current lens: key, state, and where each points (name and path from the
 * anchored mount's root, one read per anchor). The URLs use the current lens.
 * A "?" beside the title explains what an anchor does to a client.
 */
export function AnchorsPage() {
  const { ontologyKey, lensKey } = useParams<{ ontologyKey: string; lensKey: string }>()
  const queryClient = useQueryClient()
  const anchors = useAnchors(ontologyKey)
  const schema = useRuntimeSchema(ontologyKey, lensKey)
  const info = useServerInfo()

  const [pointTarget, setPointTarget] = useState<AnchorDialogTarget | null>(null)
  const [unanchorTarget, setUnanchorTarget] = useState<Anchor | null>(null)
  const [stagedOffTarget, setStagedOffTarget] = useState<Anchor | null>(null)
  const [deleteTarget, setDeleteTarget] = useState<Anchor | null>(null)
  const [deleteText, setDeleteText] = useState('')
  const deleteInput = useRef<HTMLInputElement>(null)

  const refresh = () => queryClient.invalidateQueries({ queryKey: qk.anchors(ontologyKey!) })

  const unanchor = useMutation({
    mutationFn: (anchor: Anchor) => runtime.putAnchor(ontologyKey!, anchor.key, null),
    onSuccess: (saved) => {
      void refresh()
      toast.success(`${saved.key} unanchored`)
      setUnanchorTarget(null)
    },
    onError: (err) => toast.error(err instanceof Error ? err.message : 'Failed to unanchor'),
  })

  // The PUT names the anchor's entity as it is: only the flag changes.
  const stagedOnly = useMutation({
    mutationFn: ({ anchor, on }: { anchor: Anchor; on: boolean }) =>
      runtime.putAnchor(ontologyKey!, anchor.key, anchor.entity, on),
    onSuccess: (saved) => {
      void refresh()
      toast.success(saved.stagedOnly ? `${saved.key} is staged-only` : `${saved.key} writes immediately again`)
      setStagedOffTarget(null)
    },
    onError: (err) => toast.error(err instanceof Error ? err.message : 'Failed to change staged-only'),
  })

  const remove = useMutation({
    mutationFn: (anchor: Anchor) => runtime.deleteAnchor(ontologyKey!, anchor.key),
    onSuccess: (_, anchor) => {
      // Drop the row first and refresh only the list: the deleted anchor's own
      // view, still observed, would refetch into a 404.
      queryClient.setQueryData<Anchor[]>(qk.anchors(ontologyKey!), (list) =>
        list?.filter((a) => a.key !== anchor.key),
      )
      void queryClient.invalidateQueries({ queryKey: qk.anchors(ontologyKey!), exact: true })
      toast.success(`${anchor.key} deleted`)
      setDeleteTarget(null)
    },
    onError: (err) => toast.error(err instanceof Error ? err.message : 'Failed to delete the anchor'),
  })

  if (ontologyKey === undefined || lensKey === undefined) return null

  const entityTypes = schema.data?.entityTypes ?? []
  const typeName = (key: string) => entityTypes.find((t) => t.key === key)?.displayName ?? key

  const copyUrl = (anchor: Anchor) => {
    const url = anchoredMcpUrl(info.data?.baseUrl ?? null, ontologyKey, lensKey, anchor.key)
    void navigator.clipboard
      .writeText(url)
      .then(() => toast.success('MCP URL copied'))
      .catch(() => toast.error('Could not copy'))
  }

  return (
    <div>
      <PageHeader
        title="Anchors"
        meta={<AnchorExplainerButton className="-ml-2" />}
        description="Hold an agent's writes in one entity's hierarchy to that entity and its descendants."
        actions={
          <Button size="sm" disabled={schema.data === undefined} onClick={() => setPointTarget({ mode: 'create' })}>
            <Plus className="size-3.5" />
            New anchor
          </Button>
        }
      />

      <div className="p-6">
        {anchors.isPending ? (
          <div className="space-y-2">
            <Skeleton className="h-10 w-full" />
            <Skeleton className="h-10 w-full" />
          </div>
        ) : anchors.isError ? (
          <p className="text-[13px] text-destructive">{anchors.error.message}</p>
        ) : anchors.data.length === 0 ? (
          <EmptyState
            icon={AnchorIcon}
            title="No anchors yet"
            description="An anchor gives an agent its own MCP URL that writes only under one entity."
          />
        ) : (
          <>
            <Table>
              <TableHeader>
                <TableRow>
                  <TableHead className="w-48">Key</TableHead>
                  <TableHead className="w-52">State</TableHead>
                  <TableHead>Anchored at</TableHead>
                  <TableHead className="w-28">Staged only</TableHead>
                  <TableHead className="w-64 text-right">Actions</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {anchors.data.map((anchor) => (
                  <AnchorRow
                    key={anchor.key}
                    ontologyKey={ontologyKey}
                    lensKey={lensKey}
                    anchor={anchor}
                    typeName={typeName}
                    onCopy={() => copyUrl(anchor)}
                    onPoint={(view) =>
                      setPointTarget({ mode: 'point', anchor, oldPath: view?.path ?? [] })
                    }
                    onUnanchor={() => setUnanchorTarget(anchor)}
                    stagedOnlyBusy={stagedOnly.isPending}
                    onStagedOnly={(on) =>
                      on ? stagedOnly.mutate({ anchor, on }) : setStagedOffTarget(anchor)
                    }
                    onDelete={() => {
                      setDeleteText('')
                      setDeleteTarget(anchor)
                    }}
                  />
                ))}
              </TableBody>
            </Table>
            <p className="mt-3 text-[12px] text-muted-foreground">
              The URLs use the current lens, <span className="font-mono">{lensKey}</span>. Anchors
              belong to the ontology. Every change takes effect on the agent's next call.
            </p>
          </>
        )}
      </div>

      {schema.data !== undefined && (
        <AnchorDialog
          ontologyKey={ontologyKey}
          lensKey={lensKey}
          entityTypes={schema.data.entityTypes}
          relationTypes={schema.data.relationTypes}
          existingKeys={(anchors.data ?? []).map((a) => a.key)}
          target={pointTarget}
          onClose={() => setPointTarget(null)}
        />
      )}

      <AlertDialog
        open={unanchorTarget !== null}
        onOpenChange={(open) => !open && setUnanchorTarget(null)}
      >
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>Unanchor {unanchorTarget?.key}?</AlertDialogTitle>
            <AlertDialogDescription>
              {unanchorTarget !== null && unanchorConfirmation(unanchorTarget.key, lensKey)}
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel>Cancel</AlertDialogCancel>
            <Button
              disabled={unanchor.isPending}
              onClick={() => unanchorTarget !== null && unanchor.mutate(unanchorTarget)}
            >
              {unanchor.isPending && <Loader2 className="size-3.5 animate-spin" />}
              Unanchor
            </Button>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>

      <AlertDialog
        open={stagedOffTarget !== null}
        onOpenChange={(open) => !open && setStagedOffTarget(null)}
      >
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>Turn off staged-only for {stagedOffTarget?.key}?</AlertDialogTitle>
            <AlertDialogDescription>
              {stagedOffTarget !== null && stagedOnlyOffConfirmation(stagedOffTarget.key)}
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel>Cancel</AlertDialogCancel>
            <Button
              disabled={stagedOnly.isPending}
              onClick={() =>
                stagedOffTarget !== null && stagedOnly.mutate({ anchor: stagedOffTarget, on: false })
              }
            >
              {stagedOnly.isPending && <Loader2 className="size-3.5 animate-spin" />}
              Turn off
            </Button>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>

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
            <AlertDialogTitle>Delete anchor {deleteTarget?.key}?</AlertDialogTitle>
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

interface AnchorRowProps {
  ontologyKey: string
  lensKey: string
  anchor: Anchor
  typeName: (typeKey: string) => string
  onCopy: () => void
  onPoint: (view: AnchorView | undefined) => void
  onUnanchor: () => void
  stagedOnlyBusy: boolean
  onStagedOnly: (on: boolean) => void
  onDelete: () => void
}

function AnchorRow({
  ontologyKey,
  lensKey,
  anchor,
  typeName,
  onCopy,
  onPoint,
  onUnanchor,
  stagedOnlyBusy,
  onStagedOnly,
  onDelete,
}: AnchorRowProps) {
  // The list carries no name or path: the anchored mount's root reads them through the lens.
  const view = useAnchorView(ontologyKey, lensKey, anchor.key)
  const placement = view.isError
    ? { primary: view.error.message, secondary: null, tone: 'muted' as const }
    : anchorPlacement(anchor, view.data, typeName)
  const dangling = placement.tone === 'bad'
  const shown = view.data?.visible === true ? view.data.entity : null
  const canUnanchorFromMenu = anchor.state === 'anchored' && !dangling

  return (
    <TableRow className={cn(dangling && 'bg-destructive/10 hover:bg-destructive/15')}>
      <TableCell className="font-mono text-[12.5px]">{anchor.key}</TableCell>
      <TableCell>
        <span
          className={cn(
            'inline-flex items-center rounded-full border px-2 py-0.5 text-[11px] font-semibold',
            STATE_CHIPS[dangling ? 'dangling' : anchor.state],
          )}
        >
          {dangling ? 'dangling' : anchor.state}
        </span>
        {anchor.stagedOnly && (
          <span className="ml-1 inline-flex items-center rounded-full border border-(--tc-blue-border) px-2 py-0.5 text-[11px] font-semibold text-(--tc-blue)">
            staged only
          </span>
        )}
      </TableCell>
      <TableCell className="min-w-0">
        <div
          className={cn(
            'truncate text-[13px]',
            placement.tone === 'path' && 'font-medium text-(--tc-violet)',
            placement.tone === 'muted' && 'text-muted-foreground',
            placement.tone === 'bad' && 'text-destructive',
          )}
        >
          {placement.primary}
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
      </TableCell>
      <TableCell>
        {(() => {
          const control = (
            <Switch
              checked={anchor.stagedOnly}
              disabled={dangling || stagedOnlyBusy}
              aria-label={`Staged only for ${anchor.key}`}
              onCheckedChange={onStagedOnly}
            />
          )
          if (!dangling) return control
          return (
            <Tooltip>
              <TooltipTrigger asChild>
                {/* A disabled switch gets no pointer events — the span carries the tooltip. */}
                <span tabIndex={0} className="inline-flex">
                  {control}
                </span>
              </TooltipTrigger>
              <TooltipContent>{STAGED_ONLY_DANGLING_REASON}</TooltipContent>
            </Tooltip>
          )
        })()}
      </TableCell>
      <TableCell>
        <div className="flex items-center justify-end gap-1.5">
          {dangling ? (
            <>
              <Button
                variant="outline"
                size="xs"
                className="border-destructive font-semibold text-destructive hover:text-destructive"
                onClick={() => onPoint(view.data)}
              >
                Re-anchor
              </Button>
              <Button variant="outline" size="xs" onClick={onUnanchor}>
                Unanchor
              </Button>
            </>
          ) : (
            <>
              <Button variant="outline" size="xs" onClick={onCopy}>
                <Copy className="size-3" />
                Copy URL
              </Button>
              <Button variant="outline" size="xs" onClick={() => onPoint(view.data)}>
                {anchor.state === 'anchored' ? 'Re-point' : 'Anchor…'}
              </Button>
            </>
          )}
          <DropdownMenu>
            <DropdownMenuTrigger asChild>
              <Button variant="outline" size="icon-xs" aria-label={`More actions for ${anchor.key}`}>
                <MoreHorizontal className="size-3.5" />
              </Button>
            </DropdownMenuTrigger>
            <DropdownMenuContent align="end">
              {shown !== null && (
                <DropdownMenuItem asChild>
                  <Link to={`/o/${ontologyKey}/w/${lensKey}/explore?focus=${shown.type}:${shown.id}`}>
                    <Waypoints className="size-4" />
                    Show in Explorer
                  </Link>
                </DropdownMenuItem>
              )}
              {dangling && (
                <DropdownMenuItem onSelect={onCopy}>
                  <Copy className="size-4" />
                  Copy URL
                </DropdownMenuItem>
              )}
              {canUnanchorFromMenu && (
                <DropdownMenuItem onSelect={onUnanchor}>Unanchor</DropdownMenuItem>
              )}
              {(shown !== null || dangling || canUnanchorFromMenu) && <DropdownMenuSeparator />}
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
