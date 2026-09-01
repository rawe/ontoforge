import { Check, Copy } from 'lucide-react'
import { useState } from 'react'
import type { Lens } from '@/api/types'
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

/** Connect tab: MCP configuration snippet for this ontology and lens. */
export function ConnectTab({ ontologyKey, lens }: { ontologyKey: string; lens: Lens }) {
  const origin = window.location.origin
  const key = lens.key

  const mcpSnippet = JSON.stringify(
    {
      mcpServers: {
        'ontoforge-modeling': {
          type: 'http',
          url: `${origin}/mcp/ontologies/${ontologyKey}/model`,
        },
        'ontoforge-runtime': {
          type: 'http',
          url: `${origin}/mcp/ontologies/${ontologyKey}/runtime/lenses/${key}`,
        },
      },
    },
    null,
    2,
  )

  return (
    <div className="max-w-2xl space-y-6">
      <div className="rounded-xl border bg-card p-4">
        <h3 className="text-[13px] font-semibold">MCP</h3>
        <p className="mb-3 mt-0.5 text-[12px] text-muted-foreground">
          Point AI clients (Claude Code, Claude Desktop, …) at this ontology. Both
          servers are bound by their URL: the modeling server to the ontology{' '}
          <span className="font-mono">{ontologyKey}</span>, the runtime server to the
          lens <span className="font-mono">{key}</span> within it.
        </p>
        <CodeBlock code={mcpSnippet} label="MCP config" />
      </div>
      <p className="text-[12px] text-muted-foreground">
        The modeling server edits this ontology's schema; the runtime server reads and
        writes knowledge data through this lens. The snippet uses this app's origin —
        replace it with your backend host if clients connect directly.
      </p>
    </div>
  )
}
