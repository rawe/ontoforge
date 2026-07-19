import { lazy, Suspense } from 'react'
import { Loader2 } from 'lucide-react'
import { Tabs, TabsContent, TabsList, TabsTrigger } from '@/components/ui/tabs'
import { Textarea } from '@/components/ui/textarea'
import { cn } from '@/lib/utils'

// react-markdown stays out of the eager bundle (mirrors the route-level
// code-splitting for the AI page) — the preview tab loads it on demand.
const Markdown = lazy(() =>
  import('@/components/ai/Markdown').then((m) => ({ default: m.Markdown })),
)

/** Markdown rendering for document content, lazy-loaded with a spinner. */
export function DocumentMarkdown({
  children,
  className,
}: {
  children: string
  className?: string
}) {
  return (
    <Suspense
      fallback={
        <div className="flex items-center justify-center py-6">
          <Loader2 className="size-4 animate-spin text-muted-foreground" />
        </div>
      }
    >
      <Markdown className={className}>{children}</Markdown>
    </Suspense>
  )
}

interface DocumentEditorProps {
  /** Full document text (Markdown). */
  value: string
  onChange: (value: string) => void
  id?: string
  autoFocus?: boolean
  invalid?: boolean
  disabled?: boolean
  /** Textarea rows in Write mode. */
  rows?: number
  className?: string
}

/**
 * Large editor for `document` properties: Write (monospace textarea) and
 * Preview (rendered Markdown) tabs. Purely controlled — loading existing
 * content and saving the full string are the caller's concern.
 */
export function DocumentEditor({
  value,
  onChange,
  id,
  autoFocus,
  invalid,
  disabled,
  rows = 10,
  className,
}: DocumentEditorProps) {
  return (
    <Tabs defaultValue="write" className={cn('gap-1.5', className)}>
      <TabsList className="h-7 self-start">
        <TabsTrigger value="write" className="px-2.5 text-xs">
          Write
        </TabsTrigger>
        <TabsTrigger value="preview" className="px-2.5 text-xs">
          Preview
        </TabsTrigger>
      </TabsList>
      <TabsContent value="write">
        <Textarea
          id={id}
          autoFocus={autoFocus}
          disabled={disabled}
          aria-invalid={invalid === true || undefined}
          rows={rows}
          value={value}
          onChange={(e) => onChange(e.target.value)}
          placeholder="Write Markdown…"
          // field-sizing-fixed: the base Textarea auto-grows with content,
          // which would blow the layout for large documents — keep the height
          // bounded by `rows` and scroll internally.
          className="field-sizing-fixed resize-y font-mono text-xs leading-relaxed"
        />
      </TabsContent>
      <TabsContent value="preview">
        <div className="max-h-96 min-h-24 overflow-y-auto rounded-md border bg-muted/20 px-3 py-2.5">
          {value.trim() === '' ? (
            <p className="py-4 text-center text-[13px] text-muted-foreground">
              Nothing to preview.
            </p>
          ) : (
            <DocumentMarkdown>{value}</DocumentMarkdown>
          )}
        </div>
      </TabsContent>
    </Tabs>
  )
}
