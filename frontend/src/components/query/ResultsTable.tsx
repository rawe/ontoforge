import { useState } from 'react'
import { Link } from 'react-router-dom'
import type { JsonValue, QueryResult } from '@/api/types'
import { DocumentBadge } from '@/components/DocumentBadge'
import { TypeChip } from '@/components/TypeChip'
import { Badge } from '@/components/ui/badge'
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from '@/components/ui/table'
import { displayLabel } from '@/lib/displayLabel'
import { isDocumentStub } from '@/lib/documents'
import { isEntityObject, isRelationObject, relationUserProps } from './resultUtils'

/** Non-entity object/array cell — collapsed `{…}` chip, expandable to JSON. */
function JsonCell({ value }: { value: JsonValue }) {
  const [open, setOpen] = useState(false)
  const compact = JSON.stringify(value)
  if (!open) {
    return (
      <button
        type="button"
        onClick={() => setOpen(true)}
        className="max-w-72 truncate rounded border bg-muted/40 px-1.5 py-0.5 text-left font-mono text-[11px] text-muted-foreground hover:bg-muted"
        title="Expand JSON"
      >
        {compact.length > 60 ? `${compact.slice(0, 60)}…` : compact}
      </button>
    )
  }
  return (
    <button
      type="button"
      onClick={() => setOpen(false)}
      className="block max-w-96 text-left"
      title="Collapse"
    >
      <pre className="overflow-x-auto whitespace-pre-wrap rounded border bg-muted/40 p-2 font-mono text-[11px]">
        {JSON.stringify(value, null, 2)}
      </pre>
    </button>
  )
}

function ResultCell({
  ontologyKey,
  value,
}: {
  ontologyKey: string
  value: JsonValue | undefined
}) {
  if (value === undefined || value === null) {
    return <span className="text-muted-foreground/50">—</span>
  }

  // Document property stubs (query results carry stubs, never content).
  if (isDocumentStub(value)) {
    return <DocumentBadge length={value.length} />
  }

  if (isEntityObject(value)) {
    return (
      <Link
        to={`/w/${ontologyKey}/e/${value._entityTypeKey}/${value._id}`}
        className="inline-flex max-w-72 items-center gap-1.5 hover:underline"
      >
        <TypeChip typeKey={value._entityTypeKey} size="sm" />
        <span className="truncate text-[12px]">{displayLabel(value)}</span>
      </Link>
    )
  }

  if (isRelationObject(value)) {
    const props = relationUserProps(value)
    const propText = Object.entries(props)
      .map(([k, v]) => `${k}: ${typeof v === 'object' ? JSON.stringify(v) : String(v)}`)
      .join(', ')
    return (
      <Badge
        variant="outline"
        className="max-w-72 truncate font-mono text-[10px] text-muted-foreground"
        title={propText === '' ? value._relationTypeKey : `${value._relationTypeKey} · ${propText}`}
      >
        {value._relationTypeKey}
        {propText !== '' && <span className="truncate font-normal">{propText}</span>}
      </Badge>
    )
  }

  if (typeof value === 'boolean') {
    return <span className="font-mono text-[11px]">{String(value)}</span>
  }
  if (typeof value === 'number') {
    return <span className="font-mono text-[11px] tabular-nums">{String(value)}</span>
  }
  if (typeof value === 'string') {
    return (
      <span className="block max-w-72 truncate text-[12px]" title={value}>
        {value}
      </span>
    )
  }
  return <JsonCell value={value} />
}

interface ResultsTableProps {
  ontologyKey: string
  result: QueryResult
}

/**
 * Result table for OQL and saved-query runs: entity objects render as
 * type chips linking to their detail page, relation objects as mono chips,
 * plain scalars as-is, other objects as expandable JSON.
 */
export function ResultsTable({ ontologyKey, result }: ResultsTableProps) {
  if (result.results.length === 0) {
    return (
      <p className="rounded-xl border bg-card p-6 text-center text-[13px] text-muted-foreground">
        Query ran successfully — no rows returned.
      </p>
    )
  }
  return (
    <div className="max-h-[28rem] overflow-auto rounded-xl border bg-card">
      <Table>
        <TableHeader className="sticky top-0 z-10 bg-card">
          <TableRow>
            {result.columns.map((c) => (
              <TableHead key={c} className="font-mono text-[11px]">
                {c}
              </TableHead>
            ))}
          </TableRow>
        </TableHeader>
        <TableBody>
          {result.results.map((row, i) => (
            <TableRow key={i}>
              {result.columns.map((c) => (
                <TableCell key={c} className="align-top">
                  <ResultCell ontologyKey={ontologyKey} value={row[c]} />
                </TableCell>
              ))}
            </TableRow>
          ))}
        </TableBody>
      </Table>
    </div>
  )
}
