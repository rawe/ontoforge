import { test } from 'node:test'
import assert from 'node:assert/strict'
import { buildSnippet } from '../src/components/connect/connectSnippet.ts'

const target = {
  baseUrl: 'https://api.example.com',
  ontologyKey: 'org_graph',
  lensKey: 'all',
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
