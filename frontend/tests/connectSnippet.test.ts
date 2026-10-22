import { test } from 'node:test'
import assert from 'node:assert/strict'
import { buildSnippet, mcpUrl } from '../src/components/connect/connectSnippet.ts'
import { MCP_SERVERS } from '../src/components/connect/mcpServers.ts'

const target = {
  baseUrl: 'https://api.example.com',
  ontologyKey: 'org_graph',
  lensKey: 'all',
  anchorKey: null,
  servers: ['modeling', 'runtime'] as const,
  withToken: false,
}

test('Claude Code: both servers bound by URL, no header without a token', () => {
  assert.deepEqual(JSON.parse(buildSnippet('claude-code', target)), {
    mcpServers: {
      'ontoforge-modeling': {
        type: 'http',
        url: 'https://api.example.com/mcp/ontologies/org_graph/model',
      },
      'ontoforge-runtime': {
        type: 'http',
        url: 'https://api.example.com/mcp/ontologies/org_graph/runtime/lenses/all',
      },
    },
  })
})

test('Claude Code: the token adds the Authorization header placeholder', () => {
  const parsed = JSON.parse(buildSnippet('claude-code', { ...target, withToken: true }))
  assert.deepEqual(parsed.mcpServers['ontoforge-runtime'].headers, {
    Authorization: 'Bearer <YOUR_TOKEN>',
  })
})

test('Codex: one table per server, header only with a token', () => {
  assert.equal(
    buildSnippet('codex', { ...target, withToken: true }),
    [
      '[mcp_servers.ontoforge-modeling]',
      'url = "https://api.example.com/mcp/ontologies/org_graph/model"',
      'http_headers = { Authorization = "Bearer <YOUR_TOKEN>" }',
      '',
      '[mcp_servers.ontoforge-runtime]',
      'url = "https://api.example.com/mcp/ontologies/org_graph/runtime/lenses/all"',
      'http_headers = { Authorization = "Bearer <YOUR_TOKEN>" }',
    ].join('\n'),
  )
  assert.doesNotMatch(buildSnippet('codex', target), /http_headers/)
})

test('an unknown server address becomes a visible placeholder', () => {
  assert.match(
    buildSnippet('codex', { ...target, baseUrl: null }),
    /url = "<server-url>\/mcp\/ontologies\/org_graph\/model"/,
  )
})

test('only the chosen servers are configured, always in a fixed order', () => {
  const runtimeOnly = JSON.parse(buildSnippet('claude-code', { ...target, servers: ['runtime'] }))
  assert.deepEqual(Object.keys(runtimeOnly.mcpServers), ['ontoforge-runtime'])
  const reversed = JSON.parse(
    buildSnippet('claude-code', { ...target, servers: ['runtime', 'modeling'] }),
  )
  assert.deepEqual(Object.keys(reversed.mcpServers), ['ontoforge-modeling', 'ontoforge-runtime'])
  assert.doesNotMatch(buildSnippet('codex', { ...target, servers: ['modeling'] }), /runtime/)
})

test('an anchor mounts the runtime server under it and names its entry after it', () => {
  const anchored = JSON.parse(buildSnippet('claude-code', { ...target, anchorKey: 'agent-a' }))
  assert.deepEqual(anchored.mcpServers, {
    'ontoforge-modeling': {
      type: 'http',
      url: 'https://api.example.com/mcp/ontologies/org_graph/model',
    },
    'ontoforge-runtime-agent-a': {
      type: 'http',
      url: 'https://api.example.com/mcp/ontologies/org_graph/runtime/lenses/all/rulesets/agent-a',
    },
  })
  assert.match(
    buildSnippet('codex', { ...target, anchorKey: 'agent-a', servers: ['runtime'] }),
    /^\[mcp_servers\.ontoforge-runtime-agent-a\]\nurl = ".*\/runtime\/lenses\/all\/rulesets\/agent-a"$/,
  )
})

test('the server list builds each entry name and URL path, with and without an anchor', () => {
  const [modeling, runtime] = MCP_SERVERS
  assert.equal(modeling.entryName('agent-a'), 'ontoforge-modeling')
  assert.equal(modeling.path('org_graph', 'all', 'agent-a'), '/mcp/ontologies/org_graph/model')
  assert.equal(runtime.entryName(null), 'ontoforge-runtime')
  assert.equal(runtime.entryName('agent-a'), 'ontoforge-runtime-agent-a')
  assert.equal(runtime.path('org_graph', 'all', null), '/mcp/ontologies/org_graph/runtime/lenses/all')
  assert.equal(
    runtime.path('org_graph', 'all', 'agent-a'),
    '/mcp/ontologies/org_graph/runtime/lenses/all/rulesets/agent-a',
  )
  assert.equal(
    mcpUrl(runtime, { baseUrl: null, ontologyKey: 'org_graph', lensKey: 'all', anchorKey: null }),
    '<server-url>/mcp/ontologies/org_graph/runtime/lenses/all',
  )
})
