/**
 * The AI-client configuration for one lens: the chosen MCP servers, each
 * bound by its URL (see `mcpServers.ts`).
 */

import { MCP_SERVERS, type McpServerKey } from './mcpServers.ts'

export type ConnectClient = 'claude-code' | 'codex'

/** Stands in for the server address when the server reports none. */
export const SERVER_URL_PLACEHOLDER = '<server-url>'
/** Stands in for the access token; the user replaces it. */
export const TOKEN_PLACEHOLDER = '<YOUR_TOKEN>'

export interface ConnectTarget {
  baseUrl: string | null
  ontologyKey: string
  lensKey: string
  /** The servers to include, in any order; the config lists them in `MCP_SERVERS` order. */
  servers: readonly McpServerKey[]
  /** Add an `Authorization: Bearer` header carrying the token placeholder. */
  withToken: boolean
}

function entries({ baseUrl, ontologyKey, lensKey, servers }: ConnectTarget) {
  const base = baseUrl ?? SERVER_URL_PLACEHOLDER
  return MCP_SERVERS.filter((server) => servers.includes(server.key)).map((server) => ({
    name: server.entryName,
    url: base + server.path(ontologyKey, lensKey),
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
