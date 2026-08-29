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
import { QueryEditor } from './QueryEditor'
import { QueryErrorBlock, ResultsPanel } from './ResultsPanel'
import { formatQueryError } from './resultUtils'
import { SaveQueryDialog } from './SaveQueryDialog'
import { SchemaSidebar } from './SchemaSidebar'
import { insertAtCursor } from './snippets'
import { useQueryHistory } from './useQueryHistory'

interface ConsoleTabProps {
  lensKey: string
  schema: RuntimeSchema
  /** Prefill from `?query=` (palette / AI hand-off). */
  initialQuery?: string
}

/**
 * Query console: CodeMirror editor with schema sidebar (click-to-insert
 * snippets), Cmd+Enter / Run, per-lens history, verbatim backend error
 * hints and the shared results panel with graph toggle.
 */
export function ConsoleTab({ lensKey, schema, initialQuery }: ConsoleTabProps) {
  const [query, setQuery] = useState(initialQuery ?? '')
  const [run, setRun] = useState<{ result: QueryResult; ms: number } | null>(null)
  const [error, setError] = useState<string | null>(null)
  const [saveOpen, setSaveOpen] = useState(false)
  const [sidebarOpen, setSidebarOpen] = useState(true)
  const editorRef = useRef<ReactCodeMirrorRef | null>(null)
  const { history, push } = useQueryHistory(lensKey)

  // Adopt a new `?query=` prefill arriving while mounted (AI → console).
  const [lastInitial, setLastInitial] = useState(initialQuery)
  if (initialQuery !== lastInitial) {
    setLastInitial(initialQuery)
    if (initialQuery !== undefined && initialQuery !== '') setQuery(initialQuery)
  }

  const execute = useMutation({
    mutationFn: async (text: string) => {
      const started = performance.now()
      const result = await runtime.runQuery(lensKey, text)
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
    const text = query.trim()
    if (text === '' || execute.isPending) return
    execute.mutate(text)
  }

  return (
    <div className="flex gap-4">
      <div className="min-w-0 flex-1 space-y-3">
        <QueryEditor
          value={query}
          onChange={setQuery}
          onRun={runQuery}
          editorRef={editorRef}
        />

        <div className="flex items-center gap-2">
          <Tooltip>
            <TooltipTrigger asChild>
              <Button
                size="sm"
                onClick={runQuery}
                disabled={query.trim() === '' || execute.isPending}
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
                  onSelect={() => setQuery(entry)}
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
            disabled={query.trim() === ''}
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
            lensKey={lensKey}
            result={run.result}
            elapsedMs={run.ms}
            relationTypes={schema.relationTypes}
            csvName={`${lensKey}-query`}
          />
        )}

        {run === null && error === null && (
          <EmptyState
            icon={SquareTerminal}
            title="Run a read-only query"
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
        lensKey={lensKey}
        query={query.trim()}
        open={saveOpen}
        onOpenChange={setSaveOpen}
      />
    </div>
  )
}
