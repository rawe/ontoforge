import { Check, Copy } from 'lucide-react'
import { useState, type ReactNode } from 'react'
import { toast } from 'sonner'
import { Button } from '@/components/ui/button'
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
  DialogTrigger,
} from '@/components/ui/dialog'

function snippetUrlBased(origin: string, lensKey: string): string {
  return JSON.stringify(
    {
      mcpServers: {
        'ontoforge-modeling': { type: 'http', url: `${origin}/mcp/model` },
        'ontoforge-runtime': { type: 'http', url: `${origin}/mcp/runtime/${lensKey}` },
      },
    },
    null,
    2,
  )
}

function snippetHeaderBased(origin: string, lensKey: string): string {
  return JSON.stringify(
    {
      mcpServers: {
        'ontoforge-modeling': {
          type: 'http',
          url: `${origin}/mcp/model`,
        },
        'ontoforge-runtime': {
          type: 'http',
          url: `${origin}/mcp/runtime`,
          headers: { 'X-Lens-Key': lensKey },
        },
      },
    },
    null,
    2,
  )
}

function CodeBlock({ label, code }: { label: string; code: string }) {
  const [copied, setCopied] = useState(false)
  const copy = () => {
    void navigator.clipboard
      .writeText(code)
      .then(() => {
        setCopied(true)
        toast.success('Copied to clipboard')
        window.setTimeout(() => setCopied(false), 1500)
      })
      .catch(() => toast.error('Could not copy'))
  }
  return (
    <div>
      <div className="mb-1.5 flex items-center justify-between">
        <span className="text-xs font-medium text-muted-foreground">{label}</span>
        <Button
          variant="ghost"
          size="sm"
          className="h-6 gap-1.5 px-2 text-xs text-muted-foreground"
          onClick={copy}
        >
          {copied ? <Check className="size-3" /> : <Copy className="size-3" />}
          Copy
        </Button>
      </div>
      <pre className="max-h-56 overflow-auto rounded-lg border bg-muted/40 p-3 font-mono text-[11px] leading-relaxed">
        {code}
      </pre>
    </div>
  )
}

/**
 * "Connect AI clients" dialog: MCP config snippets (URL-based and
 * header-based) with the lens key inlined, plus copy buttons.
 */
export function McpConnectDialog({
  lensKey,
  trigger,
}: {
  lensKey: string
  trigger: ReactNode
}) {
  const origin = window.location.origin
  return (
    <Dialog>
      <DialogTrigger asChild>{trigger}</DialogTrigger>
      <DialogContent className="sm:max-w-lg">
        <DialogHeader>
          <DialogTitle>Connect AI clients</DialogTitle>
          <DialogDescription>
            Point any MCP-capable client (Claude, IDEs, agents) at this lens. Both
            snippets expose the modeling and runtime servers for{' '}
            <span className="font-mono text-foreground">{lensKey}</span>.
          </DialogDescription>
        </DialogHeader>
        <div className="space-y-4">
          <CodeBlock
            label="Lens key in the URL"
            code={snippetUrlBased(origin, lensKey)}
          />
          <CodeBlock
            label="Lens key as a header"
            code={snippetHeaderBased(origin, lensKey)}
          />
        </div>
      </DialogContent>
    </Dialog>
  )
}
