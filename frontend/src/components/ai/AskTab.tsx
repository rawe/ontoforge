import { useMutation } from '@tanstack/react-query'
import {
  AlertCircle,
  ChevronRight,
  CornerDownLeft,
  MessageCircleQuestion,
  RotateCcw,
  SquareTerminal,
} from 'lucide-react'
import { useState, type KeyboardEvent } from 'react'
import { Link } from 'react-router-dom'
import { aiQuery } from '@/api/runtime'
import type { AiQueryResponse, JsonValue, QueryResult } from '@/api/types'
import { EmptyState } from '@/components/EmptyState'
import { ElapsedIndicator } from '@/components/ai/ElapsedIndicator'
import { CopyButton, Markdown } from '@/components/ai/Markdown'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from '@/components/ui/table'
import { cn } from '@/lib/utils'

interface AskEntry {
  question: string
  response: AiQueryResponse
  at: number
}

/** Session-scoped Q&A history per ontology (survives tab switches, not reloads). */
const sessionHistory = new Map<string, AskEntry[]>()

function cellText(value: JsonValue | undefined): string {
  if (value === undefined || value === null) return '—'
  if (typeof value === 'object') return JSON.stringify(value)
  return String(value)
}

/** Compact read-only results table for an /ai/query response. */
function ResultsTable({ results }: { results: QueryResult }) {
  if (results.results.length === 0) {
    return <p className="text-xs text-muted-foreground">Query returned no rows.</p>
  }
  return (
    <div className="overflow-x-auto rounded-md border">
      <Table className="text-xs">
        <TableHeader>
          <TableRow className="hover:bg-transparent">
            {results.columns.map((c) => (
              <TableHead key={c} className="h-8 whitespace-nowrap font-mono text-[11px]">
                {c}
              </TableHead>
            ))}
          </TableRow>
        </TableHeader>
        <TableBody>
          {results.results.map((row, i) => (
            <TableRow key={i}>
              {results.columns.map((c) => (
                <TableCell key={c} className="max-w-64 truncate py-1.5">
                  {cellText(row[c])}
                </TableCell>
              ))}
            </TableRow>
          ))}
        </TableBody>
      </Table>
    </div>
  )
}

/** Collapsible "Generated query" block: mono, copy, open-in-console. */
function GeneratedQueryBlock({ ontologyKey, query }: { ontologyKey: string; query: string }) {
  const [open, setOpen] = useState(false)
  return (
    <div className="rounded-md border">
      <div className="flex items-center gap-1 px-1.5 py-1">
        <button
          type="button"
          onClick={() => setOpen((o) => !o)}
          className="flex flex-1 items-center gap-1.5 rounded px-1 py-0.5 text-xs text-muted-foreground transition-colors hover:text-foreground"
          aria-expanded={open}
        >
          <ChevronRight className={cn('size-3 transition-transform', open && 'rotate-90')} />
          Generated query
        </button>
        <CopyButton text={query} />
        <Button
          asChild
          variant="ghost"
          size="sm"
          className="h-6 gap-1 px-1.5 text-xs text-muted-foreground"
        >
          <Link to={`/w/${ontologyKey}/query?query=${encodeURIComponent(query)}`}>
            <SquareTerminal className="size-3" />
            Open in console
          </Link>
        </Button>
      </div>
      {open && (
        <pre className="overflow-x-auto border-t bg-muted/40 p-2.5 font-mono text-xs leading-relaxed">
          {query}
        </pre>
      )}
    </div>
  )
}

function AnswerCard({ ontologyKey, entry }: { ontologyKey: string; entry: AskEntry }) {
  return (
    <div className="rounded-lg border bg-card">
      <div className="border-b px-4 py-2.5 text-[13px] font-medium">{entry.question}</div>
      <div className="space-y-3 px-4 py-3">
        <Markdown>{entry.response.answer}</Markdown>
        {entry.response.query !== null && (
          <GeneratedQueryBlock ontologyKey={ontologyKey} query={entry.response.query} />
        )}
        {entry.response.results !== null && <ResultsTable results={entry.response.results} />}
      </div>
    </div>
  )
}

/**
 * Ask tab: one-shot natural-language question → markdown answer, collapsible
 * generated-query block and a results table. Past Q&As of this session are
 * kept below (in memory only).
 */
export function AskTab({ ontologyKey }: { ontologyKey: string }) {
  const [question, setQuestion] = useState('')
  const [history, setHistory] = useState<AskEntry[]>(
    () => sessionHistory.get(ontologyKey) ?? [],
  )

  const ask = useMutation({
    mutationFn: (q: string) => aiQuery(ontologyKey, q),
    onSuccess: (response, q) => {
      const next = [{ question: q, response, at: Date.now() }, ...history]
      setHistory(next)
      sessionHistory.set(ontologyKey, next)
      setQuestion('')
    },
  })

  const submit = () => {
    const q = question.trim()
    if (q === '' || ask.isPending) return
    ask.mutate(q)
  }

  const onKeyDown = (e: KeyboardEvent<HTMLInputElement>) => {
    if (e.key === 'Enter') {
      e.preventDefault()
      submit()
    }
  }

  const [latest, ...previous] = history

  return (
    <div className="mx-auto w-full max-w-2xl px-4 py-4">
      <div className="flex items-center gap-2">
        <div className="relative flex-1">
          <Input
            value={question}
            onChange={(e) => setQuestion(e.target.value)}
            onKeyDown={onKeyDown}
            placeholder="Ask a question about your data — answered with a generated query"
            className="h-9 pr-8 text-[13px]"
            disabled={ask.isPending}
            autoFocus
          />
          <CornerDownLeft className="pointer-events-none absolute right-2.5 top-1/2 size-3.5 -translate-y-1/2 text-muted-foreground/50" />
        </div>
        <Button size="sm" className="h-9" onClick={submit} disabled={question.trim() === '' || ask.isPending}>
          Ask
        </Button>
      </div>

      <div className="mt-4 space-y-3">
        {ask.isPending && (
          <div className="rounded-lg border bg-card px-4 py-3">
            <p className="text-[13px] font-medium">{ask.variables}</p>
            <ElapsedIndicator label="Generating answer" className="mt-2" />
          </div>
        )}
        {ask.isError && (
          <div className="flex items-start gap-2 rounded-lg border border-destructive/40 bg-destructive/5 px-3 py-2 text-[13px]">
            <AlertCircle className="mt-0.5 size-3.5 shrink-0 text-destructive" />
            <div className="min-w-0 flex-1">
              <p className="text-destructive">{ask.error.message}</p>
              <Button
                variant="outline"
                size="sm"
                className="mt-1.5 h-6 gap-1 px-2 text-xs"
                onClick={() => ask.mutate(ask.variables!)}
              >
                <RotateCcw className="size-3" />
                Retry
              </Button>
            </div>
          </div>
        )}

        {latest !== undefined && <AnswerCard ontologyKey={ontologyKey} entry={latest} />}

        {history.length === 0 && !ask.isPending && !ask.isError && (
          <EmptyState
            icon={MessageCircleQuestion}
            title="One question, one answer"
            description='Try "How many people work for NeuralWorks GmbH?" — the AI writes and runs a query, then explains the result.'
            className="py-12"
          />
        )}

        {previous.length > 0 && (
          <>
            <p className="pt-2 text-[10.5px] font-semibold uppercase tracking-wider text-muted-foreground">
              Earlier this session
            </p>
            {previous.map((entry) => (
              <AnswerCard key={entry.at} ontologyKey={ontologyKey} entry={entry} />
            ))}
          </>
        )}
      </div>
    </div>
  )
}
