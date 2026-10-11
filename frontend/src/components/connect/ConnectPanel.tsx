import { Check, Copy } from 'lucide-react'
import { useState } from 'react'
import { toast } from 'sonner'
import { useServerInfo } from '@/api/hooks'
import { Button } from '@/components/ui/button'
import { Label } from '@/components/ui/label'
import { Skeleton } from '@/components/ui/skeleton'
import { Switch } from '@/components/ui/switch'
import { Tabs, TabsList, TabsTrigger } from '@/components/ui/tabs'
import {
  buildSnippet,
  SERVER_URL_PLACEHOLDER,
  TOKEN_PLACEHOLDER,
  type ConnectClient,
} from './connectSnippet'

const CLIENTS: Record<ConnectClient, { label: string; file: string; where: string }> = {
  'claude-code': {
    label: 'Claude Code',
    file: '.mcp.json',
    where: 'Save as .mcp.json in your project root.',
  },
  codex: {
    label: 'Codex',
    file: 'config.toml',
    where: 'Add to ~/.codex/config.toml.',
  },
}

function Mono({ children }: { children: string }) {
  return <span className="font-mono text-foreground">{children}</span>
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
        <span className="font-mono text-xs text-muted-foreground">{label}</span>
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
      <pre className="overflow-x-auto rounded-lg border bg-muted/40 p-3 font-mono text-[11px] leading-relaxed">
        {code}
      </pre>
    </div>
  )
}

/**
 * Connect AI clients to one lens: the MCP configuration for Claude Code or
 * Codex, built from the address the server reports for itself, optionally
 * with an Authorization header placeholder.
 */
export function ConnectPanel({ ontologyKey, lensKey }: { ontologyKey: string; lensKey: string }) {
  const info = useServerInfo()
  const [client, setClient] = useState<ConnectClient>('claude-code')
  const [withToken, setWithToken] = useState(false)
  const baseUrl = info.data?.baseUrl ?? null

  return (
    <div className="space-y-4">
      <p className="text-[12px] text-muted-foreground">
        The modeling server works on the schema of <Mono>{ontologyKey}</Mono>; the runtime
        server reads and writes data through the lens <Mono>{lensKey}</Mono>. Both are bound
        by their URL.
      </p>

      <div className="flex flex-wrap items-center justify-between gap-3">
        <Tabs value={client} onValueChange={(value) => setClient(value as ConnectClient)}>
          <TabsList>
            {Object.entries(CLIENTS).map(([value, { label }]) => (
              <TabsTrigger key={value} value={value} className="text-[12px]">
                {label}
              </TabsTrigger>
            ))}
          </TabsList>
        </Tabs>
        <div className="flex items-center gap-2">
          <Switch id="connect-with-token" checked={withToken} onCheckedChange={setWithToken} />
          <Label htmlFor="connect-with-token" className="text-[12px]">
            Authorization header
          </Label>
        </div>
      </div>

      {info.isPending ? (
        <Skeleton className="h-40 w-full" />
      ) : (
        <>
          <div className="text-[12px] text-muted-foreground">
            {baseUrl ? (
              <>
                Server <Mono>{baseUrl}</Mono>
                {info.data && <> · version {info.data.version}</>}
              </>
            ) : (
              <span className="text-(--tc-amber)">
                The server reports no address (<span className="font-mono">PUBLIC_URL</span> is
                not set). Replace <span className="font-mono">{SERVER_URL_PLACEHOLDER}</span> with
                the address your clients reach it at.
              </span>
            )}
          </div>
          <p className="text-[12px] text-muted-foreground">{CLIENTS[client].where}</p>
          <CodeBlock
            label={CLIENTS[client].file}
            code={buildSnippet(client, { baseUrl, ontologyKey, lensKey, withToken })}
          />
          {withToken && (
            <p className="text-[12px] text-muted-foreground">
              Replace <Mono>{TOKEN_PLACEHOLDER}</Mono> with your access token.
            </p>
          )}
        </>
      )}
    </div>
  )
}
