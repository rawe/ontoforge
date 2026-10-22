/**
 * The AI-client configuration for one lens: the chosen MCP servers, each
 * bound by its URL (see `mcpServers.ts`).
 */

import { MCP_SERVERS, type McpServer, type McpServerKey } from './mcpServers.ts'

export type ConnectClient = 'claude-code' | 'codex'

/** Stands in for the server address when the server reports none. */
export const SERVER_URL_PLACEHOLDER = '<server-url>'
/** Stands in for the access token; the user replaces it. */
export const TOKEN_PLACEHOLDER = '<YOUR_TOKEN>'

export interface ConnectTarget {
  baseUrl: string | null
  ontologyKey: string
  lensKey: string
  /** The ruleset the runtime server is mounted under; null for the plain lens. */
  rulesetKey: string | null
  /** The servers to include, in any order; the config lists them in `MCP_SERVERS` order. */
  servers: readonly McpServerKey[]
  /** Add an `Authorization: Bearer` header carrying the token placeholder. */
  withToken: boolean
}

/** A server's full URL; the placeholder stands in for an unknown server address. */
export function mcpUrl(
  server: McpServer,
  { baseUrl, ontologyKey, lensKey, rulesetKey }: Omit<ConnectTarget, 'servers' | 'withToken'>,
): string {
  return (baseUrl ?? SERVER_URL_PLACEHOLDER) + server.path(ontologyKey, lensKey, rulesetKey)
}

function entries(target: ConnectTarget) {
  return MCP_SERVERS.filter((server) => target.servers.includes(server.key)).map((server) => ({
    name: server.entryName(target.rulesetKey),
    url: mcpUrl(server, target),
  }))
}

const authorization = `Bearer ${TOKEN_PLACEHOLDER}`

/** Claude Code's `.mcp.json`. */
function claudeCode(target: ConnectTarget): string {
  const mcpServers = Object.fromEntries(
    entries(target).map(({ name, url }) => [
      name,
      {
        type: 'http',
        url,
        ...(target.withToken && { headers: { Authorization: authorization } }),
      },
    ]),
  )
  return JSON.stringify({ mcpServers }, null, 2)
}

/** Codex's `config.toml`. */
function codex(target: ConnectTarget): string {
  return entries(target)
    .map(({ name, url }) =>
      [
        `[mcp_servers.${name}]`,
        `url = "${url}"`,
        ...(target.withToken ? [`http_headers = { Authorization = "${authorization}" }`] : []),
      ].join('\n'),
    )
    .join('\n\n')
}

export function buildSnippet(client: ConnectClient, target: ConnectTarget): string {
  return client === 'codex' ? codex(target) : claudeCode(target)
}
