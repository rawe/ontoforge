/**
 * The AI-client configuration for one lens: both MCP servers, bound by URL —
 * modeling to the ontology, runtime to the lens within it.
 */

export type ConnectClient = 'claude-code' | 'codex'

/** Stands in for the server address when the server reports none. */
export const SERVER_URL_PLACEHOLDER = '<server-url>'
/** Stands in for the access token; the user replaces it. */
export const TOKEN_PLACEHOLDER = '<YOUR_TOKEN>'

export interface ConnectTarget {
  baseUrl: string | null
  ontologyKey: string
  lensKey: string
  /** Add an `Authorization: Bearer` header carrying the token placeholder. */
  withToken: boolean
}

function servers({ baseUrl, ontologyKey, lensKey }: ConnectTarget) {
  const base = baseUrl ?? SERVER_URL_PLACEHOLDER
  return [
    { name: 'ontoforge-modeling', url: `${base}/mcp/ontologies/${ontologyKey}/model` },
    {
      name: 'ontoforge-runtime',
      url: `${base}/mcp/ontologies/${ontologyKey}/runtime/lenses/${lensKey}`,
    },
  ]
}

const authorization = `Bearer ${TOKEN_PLACEHOLDER}`

/** Claude Code's `.mcp.json`. */
function claudeCode(target: ConnectTarget): string {
  const mcpServers = Object.fromEntries(
    servers(target).map(({ name, url }) => [
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
  return servers(target)
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
