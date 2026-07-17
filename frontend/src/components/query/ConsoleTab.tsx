import { useRef, useState } from 'react'
import { useMutation } from '@tanstack/react-query'
import {
  BookmarkPlus,
  History,
  PanelRightClose,
  PanelRightOpen,
  Play,
  SquareTerminal,
} from 'lucide-react'
import type { ReactCodeMirrorRef } from '@uiw/react-codemirror'
import * as runtime from '@/api/runtime'
import type { QueryResult, RuntimeSchema } from '@/api/types'
import { EmptyState } from '@/components/EmptyState'
import { Button } from '@/components/ui/button'
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuTrigger,
} from '@/components/ui/dropdown-menu'
import { Tooltip, TooltipContent, TooltipTrigger } from '@/components/ui/tooltip'
import { CypherEditor } from './CypherEditor'
import { QueryErrorBlock, ResultsPanel } from './ResultsPanel'
import { formatQueryError } from './resultUtils'
import { SaveQueryDialog } from './SaveQueryDialog'
import { SchemaSidebar } from './SchemaSidebar'
import { insertAtCursor } from './snippets'
import { useQueryHistory } from './useQueryHistory'

interface ConsoleTabProps {
  ontologyKey: string
  schema: RuntimeSchema
  /** Prefill from `?cypher=` (palette / AI hand-off). */
  initialCypher?: string
}

/**
 * Cypher console: CodeMirror editor with schema sidebar (click-to-insert
 * snippets), Cmd+Enter / Run, per-ontology history, verbatim backend error
 * hints and the shared results panel with graph toggle.
 */
export function ConsoleTab({ ontologyKey, schema, initialCypher }: ConsoleTabProps) {
  const [cypher, setCypher] = useState(initialCypher ?? '')
  const [run, setRun] = useState<{ result: QueryResult; ms: number } | null>(null)
  const [error, setError] = useState<string | null>(null)
  const [saveOpen, setSaveOpen] = useState(false)
  const [sidebarOpen, setSidebarOpen] = useState(true)
  const editorRef = useRef<ReactCodeMirrorRef | null>(null)
  const { history, push } = useQueryHistory(ontologyKey)

  // Adopt a new `?cypher=` prefill arriving while mounted (AI → console).
  const [lastInitial, setLastInitial] = useState(initialCypher)
  if (initialCypher !== lastInitial) {
    setLastInitial(initialCypher)
    if (initialCypher !== undefined && initialCypher !== '') setCypher(initialCypher)
  }

  const execute = useMutation({
    mutationFn: async (text: string) => {
      const started = performance.now()
      const result = await runtime.cypherQuery(ontologyKey, text)
      return { result, ms: Math.round(performance.now() - started) }
    },
    onSuccess: (data, text) => {
      setRun(data)
      setError(null)
      push(text)
    },
    onError: (err) => {
      setRun(null)
      setError(formatQueryError(err))
    },
  })

  const runQuery = () => {
    const text = cypher.trim()
    if (text === '' || execute.isPending) return
    execute.mutate(text)
  }

  return (
    <div className="flex gap-4">
      <div className="min-w-0 flex-1 space-y-3">
        <CypherEditor
          value={cypher}
          onChange={setCypher}
          onRun={runQuery}
          editorRef={editorRef}
        />

        <div className="flex items-center gap-2">
          <Tooltip>
            <TooltipTrigger asChild>
              <Button
                size="sm"
                onClick={runQuery}
                disabled={cypher.trim() === '' || execute.isPending}
              >
                <Play className="size-3.5" />
                {execute.isPending ? 'Running…' : 'Run'}
              </Button>
            </TooltipTrigger>
            <TooltipContent>
              <span className="font-mono">⌘↵</span>
            </TooltipContent>
          </Tooltip>

          <DropdownMenu>
            <DropdownMenuTrigger asChild>
              <Button variant="outline" size="sm" disabled={history.length === 0}>
                <History className="size-3.5" /> History
              </Button>
            </DropdownMenuTrigger>
            <DropdownMenuContent align="start" className="max-w-xl">
              {history.map((entry, i) => (
                <DropdownMenuItem
                  key={i}
                  onSelect={() => setCypher(entry)}
                  className="font-mono text-xs"
                >
                  <span className="block max-w-lg truncate">{entry}</span>
                </DropdownMenuItem>
              ))}
            </DropdownMenuContent>
          </DropdownMenu>

          <Button
            variant="outline"
            size="sm"
            disabled={cypher.trim() === ''}
            onClick={() => setSaveOpen(true)}
          >
            <BookmarkPlus className="size-3.5" /> Save as query
          </Button>

          <Button
            variant="ghost"
            size="icon-sm"
            className="ml-auto"
            aria-label={sidebarOpen ? 'Hide schema sidebar' : 'Show schema sidebar'}
            onClick={() => setSidebarOpen((o) => !o)}
          >
            {sidebarOpen ? (
              <PanelRightClose className="size-3.5" />
            ) : (
              <PanelRightOpen className="size-3.5" />
            )}
          </Button>
        </div>

        {error !== null && <QueryErrorBlock message={error} />}

        {run !== null && (
          <ResultsPanel
            ontologyKey={ontologyKey}
            result={run.result}
            elapsedMs={run.ms}
            relationTypes={schema.relationTypes}
            csvName={`${ontologyKey}-query`}
          />
        )}

        {run === null && error === null && (
          <EmptyState
            icon={SquareTerminal}
            title="Run a read-only Cypher query"
            description="Use snake_case type keys — click a type in the schema sidebar to insert a starter MATCH. Cmd+Enter runs."
          />
        )}
      </div>

      {sidebarOpen && (
        <aside className="hidden w-64 shrink-0 md:block">
          <SchemaSidebar
            schema={schema}
            onInsert={(snippet) => insertAtCursor(editorRef, snippet)}
          />
        </aside>
      )}

      <SaveQueryDialog
        ontologyKey={ontologyKey}
        cypher={cypher.trim()}
        open={saveOpen}
        onOpenChange={setSaveOpen}
      />
    </div>
  )
}
