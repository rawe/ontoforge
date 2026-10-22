import { Check, ChevronRight, Copy, Layers, Shapes, type LucideIcon } from 'lucide-react'
import { useState, type ReactNode } from 'react'
import { toast } from 'sonner'
import { useAnchors, useAnchorView, useServerInfo } from '@/api/hooks'
import type { Anchor } from '@/api/types'
import { anchorOptionLabel, anchorWritesLine } from '@/components/rulesets/rulesets'
import { Button } from '@/components/ui/button'
import { Checkbox } from '@/components/ui/checkbox'
import { Label } from '@/components/ui/label'
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select'
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
  anchor: {
    label: 'Anchor',
    chip: 'border-(--tc-teal-border) bg-(--tc-teal-bg) text-(--tc-teal)',
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

/** A chip after an arrow; the arrow wraps with its chip, so a second line starts with it. */
function NextChip({ level, keyName }: { level: keyof typeof LEVEL_CHIPS; keyName: string }) {
  return (
    <span className="inline-flex min-w-0 max-w-full items-center gap-1">
      <ChevronRight className="size-3.5 shrink-0 text-muted-foreground" />
      <LevelChip level={level} keyName={keyName} />
    </span>
  )
}

/** What a server's URL binds it to: the ontology, a lens within it, or an anchor under that lens. */
function BoundTo({
  boundTo,
  ontologyKey,
  lensKey,
  anchorKey,
}: {
  boundTo: McpServer['boundTo']
  ontologyKey: string
  lensKey: string
  anchorKey: string | null
}) {
  return (
    <div className="mt-2 flex flex-wrap items-center gap-1 whitespace-nowrap">
      <LevelChip level="ontology" keyName={ontologyKey} />
      {boundTo === 'lens' && <NextChip level="lens" keyName={lensKey} />}
      {boundTo === 'lens' && anchorKey !== null && <NextChip level="anchor" keyName={anchorKey} />}
    </div>
  )
}

/** Stands for "None" in the Anchor select; never an anchor key, which starts with a letter. */
const NO_ANCHOR = '_none'

function AnchorOption({
  anchor,
  ontologyKey,
  lensKey,
}: {
  anchor: Anchor
  ontologyKey: string
  lensKey: string
}) {
  const view = useAnchorView(ontologyKey, lensKey, anchor.key)
  return <SelectItem value={anchor.key}>{anchorOptionLabel(anchor, view.data)}</SelectItem>
}

function AnchorLine({
  anchor,
  ontologyKey,
  lensKey,
}: {
  anchor: Anchor
  ontologyKey: string
  lensKey: string
}) {
  const view = useAnchorView(ontologyKey, lensKey, anchor.key)
  const line = view.isError ? view.error.message : anchorWritesLine(anchor, view.data)
  return line === null ? null : <p className="mt-1.5 text-[11px] text-muted-foreground">{line}</p>
}

/** The runtime card's Anchor select: "None" (the plain lens) or one of the ontology's anchors. */
function AnchorField({
  anchors,
  anchorKey,
  onAnchorKeyChange,
  ontologyKey,
  lensKey,
}: {
  anchors: readonly Anchor[]
  anchorKey: string | null
  onAnchorKeyChange: (anchorKey: string | null) => void
  ontologyKey: string
  lensKey: string
}) {
  const anchor = anchors.find((a) => a.key === anchorKey)
  return (
    <div className="mt-3 border-t pt-3">
      <div className="flex items-center gap-2">
        <Label htmlFor="connect-anchor" className="text-[12px]">
          Anchor
        </Label>
        <Select
          value={anchorKey ?? NO_ANCHOR}
          onValueChange={(value) => onAnchorKeyChange(value === NO_ANCHOR ? null : value)}
        >
          <SelectTrigger id="connect-anchor" size="sm" className="min-w-0 flex-1 text-[12px]">
            <SelectValue />
          </SelectTrigger>
          <SelectContent>
            <SelectItem value={NO_ANCHOR}>None</SelectItem>
            {anchors.map((a) => (
              <AnchorOption key={a.key} anchor={a} ontologyKey={ontologyKey} lensKey={lensKey} />
            ))}
          </SelectContent>
        </Select>
      </div>
      {anchor !== undefined && (
        <AnchorLine anchor={anchor} ontologyKey={ontologyKey} lensKey={lensKey} />
      )}
    </div>
  )
}

/** One server: what its connection is bound to, its job, and whether it goes into the config. */
function ServerCard({
  server,
  ontologyKey,
  lensKey,
  anchorKey,
  selected,
  onSelectedChange,
  children,
}: {
  server: McpServer
  ontologyKey: string
  lensKey: string
  anchorKey: string | null
  selected: boolean
  onSelectedChange: (selected: boolean) => void
  /** Below the card's text, outside its click-to-select area. */
  children?: ReactNode
}) {
  const Icon = SERVER_ICONS[server.key]
  const id = `connect-server-${server.key}`
  return (
    <div
      className={`rounded-lg border p-3 transition-colors ${
        selected ? 'border-primary/60 bg-muted/30' : 'opacity-70 hover:opacity-100'
      }`}
    >
      <label htmlFor={id} className="block cursor-pointer">
        <div className="flex items-center gap-2">
          <Checkbox
            id={id}
            checked={selected}
            onCheckedChange={(checked) => onSelectedChange(checked === true)}
          />
          <Icon className="size-4 text-muted-foreground" />
          <span className="text-[13px] font-semibold">{server.label}</span>
          <span className="font-mono text-[11px] text-muted-foreground">
            {server.entryName(anchorKey)}
          </span>
        </div>
        <BoundTo
          boundTo={server.boundTo}
          ontologyKey={ontologyKey}
          lensKey={lensKey}
          anchorKey={anchorKey}
        />
        <p className="mt-2 text-[12px] font-medium">{server.job}</p>
        <p className="mt-0.5 text-[12px] text-muted-foreground">{server.covers}</p>
        <p className="mt-1 text-[11px] text-muted-foreground/80">{server.limits}</p>
      </label>
      {children}
    </div>
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
  const anchors = useAnchors(ontologyKey).data ?? []
  const [anchorChoice, setAnchorChoice] = useState<string | null>(null)
  // A chosen anchor that has since been deleted falls back to the plain lens.
  const anchorKey = anchors.some((a) => a.key === anchorChoice) ? anchorChoice : null
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
            anchorKey={anchorKey}
            selected={servers.includes(server.key)}
            onSelectedChange={(selected) => setSelected(server.key, selected)}
          >
            {server.key === 'runtime' && (
              <AnchorField
                anchors={anchors}
                anchorKey={anchorKey}
                onAnchorKeyChange={setAnchorChoice}
                ontologyKey={ontologyKey}
                lensKey={lensKey}
              />
            )}
          </ServerCard>
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
                code={buildSnippet(client, {
                  baseUrl,
                  ontologyKey,
                  lensKey,
                  anchorKey,
                  servers,
                  withToken,
                })}
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
