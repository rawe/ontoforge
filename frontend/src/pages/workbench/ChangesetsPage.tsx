import { FileStack } from 'lucide-react'
import { Link, useNavigate, useParams } from 'react-router-dom'
import { useChangesets, useRuntimeSchema } from '@/api/hooks'
import { EmptyState } from '@/components/EmptyState'
import { PageHeader } from '@/components/PageHeader'
import { ChangesetStateChip } from '@/components/changesets/ChangesetStateChip'
import { ChangesetExplainerButton } from '@/components/changesets/explainer/ChangesetExplainer'
import { sortChangesets, typesText, writesText } from '@/components/changesets/changesets'
import { absoluteTime, relativeTime } from '@/components/table/format'
import { Skeleton } from '@/components/ui/skeleton'
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from '@/components/ui/table'
import { cn } from '@/lib/utils'

/**
 * `/o/:ontologyKey/w/:lensKey/changesets` — the lens's changesets, submitted
 * first: state, note, anchor, writes, types and age. Everything is read
 * through the current lens; a row opens the changeset's review. A "?" beside
 * the title explains the workflow.
 */
export function ChangesetsPage() {
  const { ontologyKey, lensKey } = useParams<{ ontologyKey: string; lensKey: string }>()
  const navigate = useNavigate()
  const changesets = useChangesets(ontologyKey, lensKey)
  const schema = useRuntimeSchema(ontologyKey, lensKey)

  if (ontologyKey === undefined || lensKey === undefined) return null

  const typeName = (key: string) =>
    schema.data?.entityTypes.find((t) => t.key === key)?.displayName ??
    schema.data?.relationTypes.find((t) => t.key === key)?.displayName ??
    key
  const detail = (id: string) => `/o/${ontologyKey}/w/${lensKey}/changesets/${id}`

  return (
    <div>
      <PageHeader
        title="Changesets"
        meta={<ChangesetExplainerButton className="-ml-2" />}
        description="Staged writes planned through this lens. Review one, then commit it or send it back."
      />

      <div className="p-6">
        {changesets.isPending ? (
          <div className="space-y-2">
            <Skeleton className="h-10 w-full" />
            <Skeleton className="h-10 w-full" />
          </div>
        ) : changesets.isError ? (
          <p className="text-[13px] text-destructive">{changesets.error.message}</p>
        ) : changesets.data.length === 0 ? (
          <EmptyState
            icon={FileStack}
            title="No changesets in this lens"
            description="A client starts a changeset over REST or MCP and stages writes into it; it shows here for review."
          />
        ) : (
          <Table>
            <TableHeader>
              <TableRow>
                <TableHead className="w-24">State</TableHead>
                <TableHead className="min-w-48">Note</TableHead>
                <TableHead className="w-28">Anchor</TableHead>
                <TableHead className="w-16 text-right">Writes</TableHead>
                <TableHead className="w-44">Types</TableHead>
                <TableHead className="w-20 text-right">Age</TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {sortChangesets(changesets.data).map((item) => (
                <TableRow
                  key={item.id}
                  className={cn('cursor-pointer', item.state === 'submitted' && 'bg-(--tc-blue-bg)')}
                  onClick={() => navigate(detail(item.id))}
                >
                  <TableCell>
                    <ChangesetStateChip state={item.state} />
                  </TableCell>
                  <TableCell className="whitespace-normal">
                    <Link
                      to={detail(item.id)}
                      className="line-clamp-2 text-[13px] break-words hover:underline"
                      onClick={(e) => e.stopPropagation()}
                    >
                      {item.note ?? <span className="text-muted-foreground">No note</span>}
                    </Link>
                  </TableCell>
                  <TableCell className="font-mono text-[12.5px]">
                    {item.anchor ?? <span className="text-muted-foreground">—</span>}
                  </TableCell>
                  <TableCell className="text-right text-[13px] tabular-nums" title={writesText(item.writeCount)}>
                    {item.writeCount.toLocaleString('en-US')}
                  </TableCell>
                  <TableCell className="truncate text-[13px] text-muted-foreground">
                    {typesText(item.types, item.notVisible, typeName)}
                  </TableCell>
                  <TableCell
                    className="text-right text-[12.5px] text-muted-foreground tabular-nums"
                    title={`Started ${absoluteTime(item.createdAt)}`}
                  >
                    {relativeTime(item.createdAt)}
                  </TableCell>
                </TableRow>
              ))}
            </TableBody>
          </Table>
        )}
      </div>
    </div>
  )
}
