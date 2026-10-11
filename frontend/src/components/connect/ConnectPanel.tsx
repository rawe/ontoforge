import { Check, ChevronRight, Copy, Layers, Shapes, type LucideIcon } from 'lucide-react'
import { useState } from 'react'
import { toast } from 'sonner'
import { useServerInfo } from '@/api/hooks'
import { Button } from '@/components/ui/button'
import { Checkbox } from '@/components/ui/checkbox'
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
import { MCP_SERVERS, type McpServer, type McpServerKey } from './mcpServers'

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

const SERVER_ICONS: Record<McpServerKey, LucideIcon> = { modeling: Shapes, runtime: Layers }

const LEVEL_CHIPS = {
  ontology: {
    label: 'Ontology',
    chip: 'border-(--tc-blue-border) bg-(--tc-blue-bg) text-(--tc-blue)',
  },
  lens: {
    label: 'Lens',
    chip: 'border-(--tc-emerald-border) bg-(--tc-emerald-bg) text-(--tc-emerald)',
  },
}

function LevelChip({ level, keyName }: { level: keyof typeof LEVEL_CHIPS; keyName: string }) {
  const { label, chip } = LEVEL_CHIPS[level]
  return (
    <span
      title={`${label} ${keyName}`}
      className={`inline-flex min-w-0 max-w-full items-center gap-1 rounded-md border px-1.5 py-0.5 text-[11px] ${chip}`}
    >
      <span className="shrink-0">{label} ·</span>
      <span className="truncate font-mono">{keyName}</span>
    </span>
  )
}

/** What a server's URL binds it to: the ontology, or a lens within it. */
function BoundTo({
  boundTo,
  ontologyKey,
  lensKey,
}: {
  boundTo: McpServer['boundTo']
  ontologyKey: string
  lensKey: string
}) {
  return (
    <div className="mt-2 flex flex-wrap items-center gap-1 whitespace-nowrap">
      <LevelChip level="ontology" keyName={ontologyKey} />
      {boundTo === 'lens' && (
        // The arrow wraps with the lens chip, so a second line starts with it.
        <span className="inline-flex min-w-0 max-w-full items-center gap-1">
          <ChevronRight className="size-3.5 shrink-0 text-muted-foreground" />
          <LevelChip level="lens" keyName={lensKey} />
        </span>
      )}
    </div>
  )
}

/** One server: what its connection is bound to, its job, and whether it goes into the config. */
function ServerCard({
  server,
  ontologyKey,
  lensKey,
  selected,
  onSelectedChange,
}: {
  server: McpServer
  ontologyKey: string
  lensKey: string
  selected: boolean
  onSelectedChange: (selected: boolean) => void
}) {
  const Icon = SERVER_ICONS[server.key]
  const id = `connect-server-${server.key}`
  return (
    <label
      htmlFor={id}
      className={`block cursor-pointer rounded-lg border p-3 transition-colors ${
        selected ? 'border-primary/60 bg-muted/30' : 'opacity-70 hover:opacity-100'
      }`}
    >
      <div className="flex items-center gap-2">
        <Checkbox
          id={id}
          checked={selected}
          onCheckedChange={(checked) => onSelectedChange(checked === true)}
        />
        <Icon className="size-4 text-muted-foreground" />
        <span className="text-[13px] font-semibold">{server.label}</span>
        <span className="font-mono text-[11px] text-muted-foreground">{server.entryName}</span>
      </div>
      <BoundTo boundTo={server.boundTo} ontologyKey={ontologyKey} lensKey={lensKey} />
      <p className="mt-2 text-[12px] font-medium">{server.job}</p>
      <p className="mt-0.5 text-[12px] text-muted-foreground">{server.covers}</p>
      <p className="mt-1 text-[11px] text-muted-foreground/80">{server.limits}</p>
    </label>
  )
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
 * Connect AI clients to one lens: one card per MCP server, saying what it is
 * for, and the configuration for the chosen servers — for Claude Code or
 * Codex, built from the address the server reports for itself, optionally
 * with an Authorization header placeholder.
 */
export function ConnectPanel({ ontologyKey, lensKey }: { ontologyKey: string; lensKey: string }) {
  const info = useServerInfo()
  const [client, setClient] = useState<ConnectClient>('claude-code')
  const [servers, setServers] = useState<McpServerKey[]>(MCP_SERVERS.map((s) => s.key))
  const [withToken, setWithToken] = useState(false)
  const baseUrl = info.data?.baseUrl ?? null

  const setSelected = (key: McpServerKey, selected: boolean) =>
    setServers((current) =>
      selected ? [...current, key] : current.filter((existing) => existing !== key),
    )

  return (
    <div className="space-y-4">
      <p className="text-[12px] text-muted-foreground">
        OntoForge offers one MCP server per job. Each connection works only on what its URL
        names, and none can see or manage other ontologies. Choose the one your task needs, or
        both while you set things up.
      </p>

      <div className="grid gap-3 sm:grid-cols-2">
        {MCP_SERVERS.map((server) => (
          <ServerCard
            key={server.key}
            server={server}
            ontologyKey={ontologyKey}
            lensKey={lensKey}
            selected={servers.includes(server.key)}
            onSelectedChange={(selected) => setSelected(server.key, selected)}
          />
        ))}
      </div>

      <div className="flex flex-wrap items-center justify-between gap-3 border-t pt-4">
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
          {servers.length === 0 ? (
            <p className="rounded-lg border border-dashed p-4 text-center text-[12px] text-muted-foreground">
              Choose at least one server above.
            </p>
          ) : (
            <>
              <p className="text-[12px] text-muted-foreground">{CLIENTS[client].where}</p>
              <CodeBlock
                label={CLIENTS[client].file}
                code={buildSnippet(client, { baseUrl, ontologyKey, lensKey, servers, withToken })}
              />
              {withToken && (
                <p className="text-[12px] text-muted-foreground">
                  Replace <Mono>{TOKEN_PLACEHOLDER}</Mono> with your access token.
                </p>
              )}
            </>
          )}
        </>
      )}
    </div>
  )
}
