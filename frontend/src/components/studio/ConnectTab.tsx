import { Check, Copy } from 'lucide-react'
import { useState } from 'react'
import type { Ontology } from '@/api/types'
import { Button } from '@/components/ui/button'

function CodeBlock({ code, label }: { code: string; label: string }) {
  const [copied, setCopied] = useState(false)
  return (
    <div className="relative">
      <pre className="overflow-x-auto rounded-lg border bg-muted/30 p-3 pr-12 font-mono text-[11px] leading-relaxed">
        {code}
      </pre>
      <Button
        variant="ghost"
        size="icon-sm"
        className="absolute right-1.5 top-1.5"
        aria-label={`Copy ${label}`}
        onClick={() => {
          void navigator.clipboard.writeText(code).then(() => {
            setCopied(true)
            setTimeout(() => setCopied(false), 1500)
          })
        }}
      >
        {copied ? <Check className="size-3.5 text-(--tc-emerald)" /> : <Copy className="size-3.5" />}
      </Button>
    </div>
  )
}

/** Connect tab: MCP configuration snippets for this ontology. */
export function ConnectTab({ ontology }: { ontology: Ontology }) {
  const origin = window.location.origin
  const key = ontology.key

  const urlSnippet = JSON.stringify(
    {
      mcpServers: {
        'ontoforge-modeling': { type: 'http', url: `${origin}/mcp/model` },
        'ontoforge-runtime': { type: 'http', url: `${origin}/mcp/runtime/${key}` },
      },
    },
    null,
    2,
  )

  const headerSnippet = JSON.stringify(
    {
      mcpServers: {
        'ontoforge-modeling': {
          type: 'http',
          url: `${origin}/mcp/model`,
        },
        'ontoforge-runtime': {
          type: 'http',
          url: `${origin}/mcp/runtime`,
          headers: { 'X-Ontology-Key': key },
        },
      },
    },
    null,
    2,
  )

  return (
    <div className="max-w-2xl space-y-6">
      <div className="rounded-xl border bg-card p-4">
        <h3 className="text-[13px] font-semibold">MCP — URL-based</h3>
        <p className="mb-3 mt-0.5 text-[12px] text-muted-foreground">
          Point AI clients (Claude Code, Claude Desktop, …) at this ontology. The runtime
          server is bound to <span className="font-mono">{key}</span> by its URL. The
          modeling server is global — it works on the whole schema and takes the ontology
          as a tool argument, so no key appears in its address.
        </p>
        <CodeBlock code={urlSnippet} label="URL-based MCP config" />
      </div>
      <div className="rounded-xl border bg-card p-4">
        <h3 className="text-[13px] font-semibold">MCP — header-based</h3>
        <p className="mb-3 mt-0.5 text-[12px] text-muted-foreground">
          Same servers, with the runtime ontology selected via the{' '}
          <span className="font-mono">X-Ontology-Key</span> header instead of the URL. The
          modeling server stays global either way.
        </p>
        <CodeBlock code={headerSnippet} label="Header-based MCP config" />
      </div>
      <p className="text-[12px] text-muted-foreground">
        The modeling server edits the global schema through this ontology's lens; the
        runtime server reads and writes knowledge data. Snippets use this app's origin —
        replace it with your backend host if clients connect directly.
      </p>
    </div>
  )
}
