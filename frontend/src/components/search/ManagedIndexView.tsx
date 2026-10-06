import { ChevronLeft } from 'lucide-react'
import { Link } from 'react-router-dom'
import { useIndexSchema, useSwitchManagedIndex } from '@/api/searchIndexHooks'
import type { SearchIndexRecord } from '@/api/types'
import { TypeChip } from '@/components/TypeChip'
import { Badge } from '@/components/ui/badge'
import { IndexStatusBlock } from './IndexPanels'
import { KindBadge, ManagedSwitch, RepresentationBadges } from './shared'

/**
 * A managed index (default or passage), read-only: the server derives its
 * definition from the schema; it can only be switched on or off.
 */
export function ManagedIndexView({
  ontologyKey,
  record,
}: {
  ontologyKey: string
  record: SearchIndexRecord
}) {
  const switcher = useSwitchManagedIndex(ontologyKey)
  const schema = useIndexSchema(ontologyKey)
  const { definition } = record
  const root = schema?.entityTypes.find((t) => t.key === definition.entityType)
  const displayName = (key: string) =>
    root?.properties.find((p) => p.key === key)?.displayName ?? key
  const header =
    definition.header === null
      ? `Name property${root === undefined ? '' : ` (${root.nameProperty})`}`
      : definition.header.length === 0
        ? 'None'
        : definition.header.map(displayName).join(', ')

  return (
    <div>
      <header className="border-b px-6 py-4">
        <Link
          to={`/o/${ontologyKey}/studio/search`}
          className="mb-2 inline-flex items-center gap-1 text-xs text-muted-foreground transition-colors hover:text-foreground"
        >
          <ChevronLeft className="size-3.5" /> Search
        </Link>
        <div className="flex flex-wrap items-center gap-3">
          <h1 className="text-[15px] font-semibold tracking-tight">{definition.name}</h1>
          <KindBadge kind={record.kind} />
          <Badge variant="outline" className="font-mono text-[11px]" title="Managed key">
            {record.key}
          </Badge>
          <label className="ml-auto flex items-center gap-2 text-[13px]">
            {record.enabled ? 'On' : 'Off'}
            <ManagedSwitch record={record} switcher={switcher} />
          </label>
        </div>
        <p className="mt-1 max-w-2xl text-[13px] text-muted-foreground">{definition.description}</p>
      </header>

      <div className="grid items-start gap-6 p-6 lg:grid-cols-[minmax(0,1fr)_300px]">
        <section className="grid gap-3 rounded-xl border bg-card p-4">
          <p className="text-[12px] text-muted-foreground">
            Managed indices follow the schema: the server derives them and rebuilds them when
            the schema changes. They cannot be edited, only switched on or off — here or in the
            search settings. For other fields or relations, create a custom index.
          </p>
          <dl className="grid grid-cols-[8rem_minmax(0,1fr)] gap-x-4 gap-y-2 text-[13px]">
            <dt className="text-muted-foreground">Entity type</dt>
            <dd>
              <TypeChip typeKey={definition.entityType} displayName={root?.displayName} size="sm" />
            </dd>
            <dt className="text-muted-foreground">
              {record.kind === 'passage' ? 'Document' : 'Fields'}
            </dt>
            <dd className="flex flex-wrap gap-1">
              {definition.fields.map((f) => (
                <Badge key={f} variant="secondary" className="text-[11px]" title={f}>
                  {displayName(f)}
                </Badge>
              ))}
            </dd>
            <dt className="text-muted-foreground">Header</dt>
            <dd>{header}</dd>
            <dt className="text-muted-foreground">Search modes</dt>
            <dd>
              <RepresentationBadges definition={definition} />
            </dd>
          </dl>
        </section>
        <aside className="grid gap-4">
          <IndexStatusBlock ontologyKey={ontologyKey} record={record} />
        </aside>
      </div>
    </div>
  )
}
