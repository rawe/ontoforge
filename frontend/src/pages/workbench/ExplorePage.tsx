import { SearchX } from 'lucide-react'
import { useParams } from 'react-router-dom'
import { useRuntimeSchema } from '@/api/hooks'
import { EmptyState } from '@/components/EmptyState'
import { ExplorerCanvas } from '@/components/explore/ExplorerCanvas'
import { Skeleton } from '@/components/ui/skeleton'

/**
 * `/w/:lensKey/explore` — the Explorer canvas (slice S5). Full-bleed
 * React Flow surface; all page state lives in `ExplorerCanvas`, remounted
 * per lens so working sets never bleed across lenses.
 */
export function ExplorePage() {
  const { lensKey } = useParams<{ lensKey: string }>()
  const schema = useRuntimeSchema(lensKey)

  if (lensKey === undefined) return null

  if (schema.isPending) {
    return (
      <div className="h-full p-6">
        <Skeleton className="h-full w-full rounded-xl" />
      </div>
    )
  }

  if (schema.isError || schema.data === undefined) {
    return (
      <EmptyState
        icon={SearchX}
        title="Failed to load schema"
        description={schema.error instanceof Error ? schema.error.message : undefined}
        className="py-24"
      />
    )
  }

  return (
    <ExplorerCanvas key={lensKey} lensKey={lensKey} schema={schema.data} />
  )
}
