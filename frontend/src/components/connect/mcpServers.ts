/**
 * The MCP servers a lens's Connect panel offers — everything the web client
 * knows about them: config entry name, the level its URL binds to, the URL
 * path, and the user-facing guidance.
 *
 * Mirrors docs/interfaces.md (MCP): when a server is added, re-addressed, or
 * its tool groups change, update this list — the cards and the snippets are
 * both built from it.
 *
 * The runtime server can be mounted under an anchor: its URL then ends in
 * `/rulesets/{key}` and its entry is named after the anchor. The modeling
 * server ignores the anchor.
 */

export type McpServerKey = 'modeling' | 'runtime'

export interface McpServer {
  key: McpServerKey
  /** Key of the server's entry in the client config. */
  entryName: (anchorKey: string | null) => string
  label: string
  /** What the URL binds the connection to. */
  boundTo: 'ontology' | 'lens'
  path: (ontologyKey: string, lensKey: string, anchorKey: string | null) => string
  /** One sentence: the server's job. */
  job: string
  /** What it covers. */
  covers: string
  /** What it deliberately does not do. */
  limits: string
}

export const MCP_SERVERS: readonly McpServer[] = [
  {
    key: 'modeling',
    entryName: () => 'ontoforge-modeling',
    label: 'Modeling',
    boundTo: 'ontology',
    path: (ontologyKey) => `/mcp/ontologies/${ontologyKey}/model`,
    job: 'Designs the ontology.',
    covers:
      'Entity types, relation types and properties · lenses · search indices · agents, retrievers and saved queries',
    limits: 'Does not read or write data.',
  },
  {
    key: 'runtime',
    entryName: (anchorKey) =>
      anchorKey === null ? 'ontoforge-runtime' : `ontoforge-runtime-${anchorKey}`,
    label: 'Runtime',
    boundTo: 'lens',
    path: (ontologyKey, lensKey, anchorKey) =>
      `/mcp/ontologies/${ontologyKey}/runtime/lenses/${lensKey}` +
      (anchorKey === null ? '' : `/rulesets/${anchorKey}`),
    job: 'Works with the data, as this lens shows it.',
    covers:
      'Create, read, update and delete entities and relations · search and query · run saved queries',
    limits: 'Sees only the types this lens exposes. Does not change the schema.',
  },
]
