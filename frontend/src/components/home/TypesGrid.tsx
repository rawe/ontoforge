import { Link } from 'react-router-dom'
import type { SchemaEntityType, SchemaRelationType } from '@/api/types'
import { TypeDot } from '@/components/TypeChip'
import { Skeleton } from '@/components/ui/skeleton'

/**
 * The Home "Types" section: one card per entity type with a live instance
 * count linking to its table, plus a compact chip row of relation types.
 */
export function TypesGrid({
  lensKey,
  entityTypes,
  relationTypes,
  counts,
}: {
  lensKey: string
  entityTypes: readonly SchemaEntityType[]
  relationTypes: readonly SchemaRelationType[]
  counts: Record<string, number | undefined>
}) {
  return (
    <section>
      <h2 className="text-[11px] font-semibold uppercase tracking-wider text-muted-foreground">
        Types
      </h2>
      <div className="mt-3 grid gap-3 sm:grid-cols-2 lg:grid-cols-3 xl:grid-cols-4">
        {entityTypes.map((t) => {
          const count = counts[t.key]
          return (
            <Link
              key={t.key}
              to={`/w/${lensKey}/t/${t.key}`}
              className="group rounded-xl border bg-card p-4 transition-all duration-150 hover:border-ring/40 focus-visible:outline-2 focus-visible:outline-ring/60"
            >
              <div className="flex items-center gap-2">
                <TypeDot typeKey={t.key} />
                <span className="truncate text-sm font-medium">{t.displayName}</span>
                <span className="ml-auto shrink-0 font-mono text-[11px] text-muted-foreground">
                  {t.key}
                </span>
              </div>
              <div className="mt-3 flex items-baseline gap-1.5">
                {count === undefined ? (
                  <Skeleton className="h-7 w-10" />
                ) : (
                  <span className="text-2xl font-semibold tabular-nums leading-none">
                    {count}
                  </span>
                )}
                <span className="text-xs text-muted-foreground">
                  {count === 1 ? 'instance' : 'instances'}
                </span>
              </div>
            </Link>
          )
        })}
      </div>
      {relationTypes.length > 0 && (
        <div className="mt-3 flex flex-wrap gap-2">
          {relationTypes.map((r) => (
            <span
              key={r.key}
              className="inline-flex items-center gap-1.5 rounded-md border bg-card px-2 py-1 text-xs"
              title={`${r.fromEntityTypeKey} → ${r.toEntityTypeKey}`}
            >
              <TypeDot typeKey={r.fromEntityTypeKey} className="size-1.5" />
              <span className="font-mono text-muted-foreground">{r.key}</span>
              <TypeDot typeKey={r.toEntityTypeKey} className="size-1.5" />
            </span>
          ))}
        </div>
      )}
    </section>
  )
}
