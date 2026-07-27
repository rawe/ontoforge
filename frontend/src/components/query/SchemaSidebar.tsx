import { useState } from 'react'
import { ArrowRight, ChevronRight } from 'lucide-react'
import type { RuntimeSchema, SchemaEntityType } from '@/api/types'
import { TypeDot } from '@/components/TypeChip'
import { Tooltip, TooltipContent, TooltipTrigger } from '@/components/ui/tooltip'
import { cn } from '@/lib/utils'
import { entitySnippet, relationSnippet } from './snippets'

function EntityTypeRow({
  type,
  onInsert,
}: {
  type: SchemaEntityType
  onInsert: (snippet: string) => void
}) {
  const [expanded, setExpanded] = useState(false)
  return (
    <div>
      <div className="group flex items-center gap-0.5">
        <button
          type="button"
          aria-label={`${expanded ? 'Collapse' : 'Expand'} ${type.key} properties`}
          aria-expanded={expanded}
          onClick={() => setExpanded((e) => !e)}
          className="flex size-5 shrink-0 items-center justify-center rounded text-muted-foreground hover:bg-muted hover:text-foreground"
        >
          <ChevronRight
            className={cn('size-3.5 transition-transform', expanded && 'rotate-90')}
          />
        </button>
        <Tooltip>
          <TooltipTrigger asChild>
            <button
              type="button"
              onClick={() => onInsert(entitySnippet(type.key))}
              className="flex min-w-0 flex-1 items-center gap-1.5 rounded px-1.5 py-1 text-left hover:bg-muted"
            >
              <TypeDot typeKey={type.key} />
              <span className="truncate text-[12px]">{type.displayName}</span>
              <span className="ml-auto truncate font-mono text-[10px] text-muted-foreground">
                {type.key}
              </span>
            </button>
          </TooltipTrigger>
          <TooltipContent side="left">Insert MATCH snippet</TooltipContent>
        </Tooltip>
      </div>
      {expanded && (
        <ul className="mb-1 ml-[22px] border-l pl-2">
          {type.properties.length === 0 && (
            <li className="py-0.5 text-[11px] text-muted-foreground">No properties</li>
          )}
          {type.properties.map((p) => (
            <li
              key={p.key}
              className="flex items-baseline gap-1.5 py-0.5 font-mono text-[11px]"
            >
              <span className="truncate">
                {p.key}
                {p.required && <span className="text-destructive">*</span>}
              </span>
              <span className="ml-auto shrink-0 text-muted-foreground">{p.dataType}</span>
            </li>
          ))}
        </ul>
      )}
    </div>
  )
}

interface SchemaSidebarProps {
  schema: RuntimeSchema
  onInsert: (snippet: string) => void
}

/**
 * Schema browser for the query console: entity types (expandable to their
 * properties) and relation types (from → to). Clicking a type inserts a
 * ready-to-run MATCH snippet at the editor cursor.
 */
export function SchemaSidebar({ schema, onInsert }: SchemaSidebarProps) {
  return (
    <div className="flex h-full flex-col gap-4 overflow-y-auto rounded-xl border bg-card/40 p-3">
      <section>
        <h3 className="mb-1.5 px-1 text-[11px] font-semibold uppercase tracking-wide text-muted-foreground">
          Entity types
        </h3>
        {schema.entityTypes.length === 0 && (
          <p className="px-1 text-[11px] text-muted-foreground">None in scope.</p>
        )}
        {schema.entityTypes.map((t) => (
          <EntityTypeRow key={t.key} type={t} onInsert={onInsert} />
        ))}
      </section>
      <section>
        <h3 className="mb-1.5 px-1 text-[11px] font-semibold uppercase tracking-wide text-muted-foreground">
          Relation types
        </h3>
        {schema.relationTypes.length === 0 && (
          <p className="px-1 text-[11px] text-muted-foreground">None in scope.</p>
        )}
        {schema.relationTypes.map((t) => (
          <Tooltip key={t.key}>
            <TooltipTrigger asChild>
              <button
                type="button"
                onClick={() => onInsert(relationSnippet(t))}
                className="flex w-full items-center gap-1.5 rounded px-1.5 py-1 text-left hover:bg-muted"
              >
                <span className="truncate font-mono text-[11px]">{t.key}</span>
                <span className="ml-auto flex shrink-0 items-center gap-1 text-muted-foreground">
                  <TypeDot typeKey={t.fromEntityTypeKey} />
                  <ArrowRight className="size-3" />
                  <TypeDot typeKey={t.toEntityTypeKey} />
                </span>
              </button>
            </TooltipTrigger>
            <TooltipContent side="left">
              <span className="font-mono text-[11px]">
                {t.fromEntityTypeKey} → {t.toEntityTypeKey}
              </span>
            </TooltipContent>
          </Tooltip>
        ))}
      </section>
    </div>
  )
}
