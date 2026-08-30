import { useMemo, useState } from 'react'
import { Download, Table2, Waypoints } from 'lucide-react'
import type { QueryResult, SchemaRelationType } from '@/api/types'
import { Button } from '@/components/ui/button'
import { cn } from '@/lib/utils'
import { ResultsGraph } from './ResultsGraph'
import { ResultsTable } from './ResultsTable'
import { deriveGraph, exportResultsCsv, hasEntityResults } from './resultUtils'

/**
 * Backend error block — rendered verbatim in mono/amber: the query endpoint
 * intentionally returns self-correction hints listing available types and
 * properties.
 */
export function QueryErrorBlock({ message }: { message: string }) {
  return (
    <pre className="overflow-x-auto whitespace-pre-wrap rounded-xl border border-amber-500/40 bg-amber-500/5 p-3 font-mono text-xs leading-relaxed text-amber-700 dark:text-amber-400">
      {message}
    </pre>
  )
}

interface ResultsPanelProps {
  ontologyKey: string
  lensKey: string
  result: QueryResult
  /** Wall-clock duration of the run, shown next to the row count. */
  elapsedMs?: number
  relationTypes: readonly SchemaRelationType[]
  /** Basename for the CSV download (`.csv` appended). */
  csvName: string
}

/**
 * Shared results surface for the console and library runs: row count +
 * elapsed time, CSV export, and a table/graph view toggle (graph only when
 * the results contain at least one entity object).
 */
export function ResultsPanel({
  ontologyKey,
  lensKey,
  result,
  elapsedMs,
  relationTypes,
  csvName,
}: ResultsPanelProps) {
  const [view, setView] = useState<'table' | 'graph'>('table')
  const graphable = useMemo(() => hasEntityResults(result), [result])
  const graph = useMemo(
    () => (graphable && view === 'graph' ? deriveGraph(result, relationTypes) : null),
    [graphable, view, result, relationTypes],
  )

  return (
    <div className="space-y-2">
      <div className="flex items-center gap-2">
        <span className="text-xs text-muted-foreground">
          {result.results.length} row{result.results.length === 1 ? '' : 's'}
          {elapsedMs !== undefined && (
            <span className="font-mono tabular-nums"> · {elapsedMs} ms</span>
          )}
        </span>
        {graphable && (
          <div className="ml-1 flex items-center rounded-lg border p-0.5">
            <button
              type="button"
              onClick={() => setView('table')}
              aria-pressed={view === 'table'}
              className={cn(
                'flex items-center gap-1 rounded-md px-2 py-0.5 text-[11px]',
                view === 'table'
                  ? 'bg-muted text-foreground'
                  : 'text-muted-foreground hover:text-foreground',
              )}
            >
              <Table2 className="size-3" /> Table
            </button>
            <button
              type="button"
              onClick={() => setView('graph')}
              aria-pressed={view === 'graph'}
              className={cn(
                'flex items-center gap-1 rounded-md px-2 py-0.5 text-[11px]',
                view === 'graph'
                  ? 'bg-muted text-foreground'
                  : 'text-muted-foreground hover:text-foreground',
              )}
            >
              <Waypoints className="size-3" /> Graph
            </button>
          </div>
        )}
        <Button
          variant="ghost"
          size="xs"
          className="ml-auto"
          disabled={result.results.length === 0}
          onClick={() => exportResultsCsv(result, `${csvName}.csv`)}
        >
          <Download className="size-3" /> Export CSV
        </Button>
      </div>

      {view === 'graph' && graph !== null ? (
        <ResultsGraph
          ontologyKey={ontologyKey}
          lensKey={lensKey}
          entities={graph.entities}
          edges={graph.edges}
        />
      ) : (
        <ResultsTable ontologyKey={ontologyKey} lensKey={lensKey} result={result} />
      )}
    </div>
  )
}
