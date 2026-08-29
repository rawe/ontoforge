import { Box, Cable } from 'lucide-react'
import { useParams } from 'react-router-dom'
import { useFeatures, useLenses, useLensScope, useRuntimeSchema } from '@/api/hooks'
import { EmptyState } from '@/components/EmptyState'
import { PageHeader } from '@/components/PageHeader'
import { GuidedEmptyState } from '@/components/home/GuidedEmptyState'
import { McpConnectDialog } from '@/components/home/McpConnectDialog'
import { QuickActions } from '@/components/home/QuickActions'
import { RecentlyUpdated } from '@/components/home/RecentlyUpdated'
import { SavedQueriesSection } from '@/components/home/SavedQueriesSection'
import { TypesGrid } from '@/components/home/TypesGrid'
import { useTypeCounts } from '@/components/home/useTypeCounts'
import { Badge } from '@/components/ui/badge'
import { Button } from '@/components/ui/button'
import { Skeleton } from '@/components/ui/skeleton'

/** `/w/:lensKey` — Workbench Home: overview dashboard for one lens. */
export function HomePage() {
  const { lensKey } = useParams<{ lensKey: string }>()
  const schema = useRuntimeSchema(lensKey)
  const { data: features } = useFeatures()
  const { data: lenses } = useLenses()
  const scope = useLensScope(
    lenses?.find((o) => o.key === lensKey)?.lensId,
  )
  const counts = useTypeCounts(lensKey, schema.data?.entityTypes ?? [])

  if (schema.isPending) {
    return (
      <div className="p-6">
        <Skeleton className="h-6 w-48" />
        <Skeleton className="mt-2 h-4 w-72" />
        <div className="mt-8 grid gap-3 sm:grid-cols-2 lg:grid-cols-3">
          <Skeleton className="h-28 rounded-xl" />
          <Skeleton className="h-28 rounded-xl" />
          <Skeleton className="h-28 rounded-xl" />
        </div>
      </div>
    )
  }

  if (schema.data === undefined || lensKey === undefined) return null
  const { lens, entityTypes, relationTypes } = schema.data
  const aiEnabled = features?.ai === true
  const isEmpty = counts.loaded && counts.total === 0

  return (
    <div>
      <PageHeader
        title={lens.name}
        description={lens.description ?? undefined}
        meta={
          <span className="flex items-center gap-2">
            {scope.data !== undefined && (
              <Badge variant="outline" className="font-normal text-muted-foreground">
                {scope.data.scoped ? 'Scoped' : 'Unscoped'}
              </Badge>
            )}
            <span className="text-xs tabular-nums text-muted-foreground">
              {entityTypes.length} entity {entityTypes.length === 1 ? 'type' : 'types'} ·{' '}
              {relationTypes.length} relation {relationTypes.length === 1 ? 'type' : 'types'}
            </span>
          </span>
        }
      />

      {entityTypes.length === 0 ? (
        <EmptyState
          icon={Box}
          title="Nothing in scope"
          description="This lens exposes no entity types. Adjust its scope in the Studio to get started."
        />
      ) : isEmpty ? (
        <GuidedEmptyState
          lensKey={lensKey}
          lensName={lens.name}
          entityTypes={entityTypes}
          aiEnabled={aiEnabled}
        />
      ) : (
        <div className="space-y-8 p-6">
          <QuickActions lensKey={lensKey} aiEnabled={aiEnabled} />

          <TypesGrid
            lensKey={lensKey}
            entityTypes={entityTypes}
            relationTypes={relationTypes}
            counts={counts.counts}
          />

          <div className="grid gap-8 lg:grid-cols-3">
            <div className="lg:col-span-2">
              <RecentlyUpdated lensKey={lensKey} entityTypes={entityTypes} />
            </div>
            <div className="space-y-8">
              <SavedQueriesSection lensKey={lensKey} />
              <section>
                <h2 className="text-[11px] font-semibold uppercase tracking-wider text-muted-foreground">
                  AI clients
                </h2>
                <div className="mt-3 rounded-xl border bg-card p-4">
                  <div className="flex items-center gap-2">
                    <Cable className="size-4 text-muted-foreground" />
                    <span className="text-[13px] font-medium">Connect AI clients</span>
                  </div>
                  <p className="mt-1.5 text-[13px] text-muted-foreground">
                    Claude and other MCP-capable agents can model and query this lens
                    directly.
                  </p>
                  <div className="mt-3">
                    <McpConnectDialog
                      lensKey={lensKey}
                      trigger={
                        <Button size="sm" variant="outline" className="h-7 text-[13px]">
                          View MCP config
                        </Button>
                      }
                    />
                  </div>
                </div>
              </section>
            </div>
          </div>
        </div>
      )}
    </div>
  )
}
