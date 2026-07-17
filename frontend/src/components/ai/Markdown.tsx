import { Check, Copy } from 'lucide-react'
import { useState, type ReactNode } from 'react'
import ReactMarkdown from 'react-markdown'
import remarkGfm from 'remark-gfm'
import { Button } from '@/components/ui/button'
import { cn } from '@/lib/utils'

/** Small copy-to-clipboard icon button with a transient "copied" check. */
export function CopyButton({ text, className }: { text: string; className?: string }) {
  const [copied, setCopied] = useState(false)
  return (
    <Button
      variant="ghost"
      size="icon-sm"
      className={cn('size-6 text-muted-foreground', className)}
      aria-label="Copy to clipboard"
      onClick={() => {
        void navigator.clipboard.writeText(text).then(() => {
          setCopied(true)
          window.setTimeout(() => setCopied(false), 1500)
        })
      }}
    >
      {copied ? <Check className="size-3.5 text-emerald-500" /> : <Copy className="size-3.5" />}
    </Button>
  )
}

function CodeBlock({ children, className }: { children?: ReactNode; className?: string }) {
  const text = typeof children === 'string' ? children : extractText(children)
  return (
    <div className="group/code relative my-2 overflow-hidden rounded-md border bg-muted/40">
      <CopyButton
        text={text.replace(/\n$/, '')}
        className="absolute right-1 top-1 opacity-0 transition-opacity group-hover/code:opacity-100"
      />
      <pre className="overflow-x-auto p-3 font-mono text-xs leading-relaxed">
        <code className={className}>{children}</code>
      </pre>
    </div>
  )
}

function extractText(node: ReactNode): string {
  if (typeof node === 'string' || typeof node === 'number') return String(node)
  if (Array.isArray(node)) return node.map(extractText).join('')
  if (node !== null && typeof node === 'object' && 'props' in node) {
    return extractText((node.props as { children?: ReactNode }).children)
  }
  return ''
}

/**
 * Markdown renderer for AI answers/chat: GFM (tables, strikethrough, task
 * lists), mono code with copy buttons, compact data-dense typography.
 */
export function Markdown({ children, className }: { children: string; className?: string }) {
  return (
    <div
      className={cn(
        'space-y-2 text-[13px] leading-relaxed',
        '[&_h1]:text-sm [&_h1]:font-semibold [&_h2]:text-sm [&_h2]:font-semibold [&_h3]:text-[13px] [&_h3]:font-semibold',
        '[&_ul]:list-disc [&_ul]:space-y-0.5 [&_ul]:pl-5 [&_ol]:list-decimal [&_ol]:space-y-0.5 [&_ol]:pl-5',
        '[&_a]:text-primary [&_a]:underline [&_a]:underline-offset-2',
        '[&_blockquote]:border-l-2 [&_blockquote]:pl-3 [&_blockquote]:text-muted-foreground',
        '[&_table]:w-full [&_table]:border-collapse [&_th]:border [&_th]:px-2 [&_th]:py-1 [&_th]:text-left [&_th]:font-medium [&_td]:border [&_td]:px-2 [&_td]:py-1',
        '[&_hr]:my-3 [&_hr]:border-border',
        className,
      )}
    >
      <ReactMarkdown
        remarkPlugins={[remarkGfm]}
        components={{
          pre: ({ children }) => <>{children}</>,
          code: ({ children, className: codeClass, ...props }) => {
            // Block code arrives with a language- class or contains newlines.
            const text = extractText(children)
            const isBlock =
              codeClass?.startsWith('language-') === true || text.includes('\n')
            if (isBlock) {
              return <CodeBlock className={codeClass}>{children}</CodeBlock>
            }
            return (
              <code
                className="rounded bg-muted px-1 py-px font-mono text-xs"
                {...props}
              >
                {children}
              </code>
            )
          },
        }}
      >
        {children}
      </ReactMarkdown>
    </div>
  )
}
