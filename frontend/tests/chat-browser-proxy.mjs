/** Local, deterministic browser fixture. Proxies the running dev app; never calls a model.
 * Start: node frontend/tests/chat-browser-proxy.mjs
 * Open http://localhost:5181 and use its Chat tab.
 * POST /__chat-test/advance to release each stage; add ?fail=1 for terminal failure.
 * GET /__chat-test/status reports fixture connection state.
 */
import { createServer, request } from 'node:http'
let current
let disconnected = false
createServer((req, res) => {
  const url = new URL(req.url, 'http://localhost:5181')
  if (url.pathname === '/__chat-test/status') {
    res.setHeader('content-type', 'application/json')
    res.end(JSON.stringify({ active: Boolean(current), disconnected }))
    return
  }
  if (url.pathname === '/__chat-test/advance' && req.method === 'POST') {
    if (current) {
      if (url.searchParams.has('fail')) {
        current.send({ type: 'error', error: { code: 'STORAGE_ERROR', message: 'Controlled storage failure' } })
        current.res.end()
        current = undefined
      } else {
        const stage = current.stages.shift()
        stage?.forEach(current.send)
        if (!current.stages.length) { current.res.end(); current = undefined }
      }
    }
    res.end('ok')
    return
  }
  if (url.pathname.endsWith('/ai/agents')) {
    res.setHeader('content-type', 'application/json')
    res.end(JSON.stringify([
      { key: '_default', name: 'Default assistant', description: null },
      { key: 'fixture-agent', name: 'Fixture agent', description: 'Controlled browser test' },
    ]))
    return
  }
  if (/\/ai\/(?:agents\/[^/]+\/)?chat$/.test(url.pathname) && req.method === 'POST') {
    req.resume()
    res.writeHead(200, { 'content-type': 'application/x-ndjson' })
    disconnected = false
    const send = (event) => { if (!res.destroyed) res.write(JSON.stringify(event) + '\n') }
    const turn = { res, send, stages: [
      [{ type: 'tool_result', callId: 'one', result: { people: [{ name: 'Zoë', active: true }], cursor: null } },
        { type: 'tool_call', callId: 'two', tool: 'get_entity', args: { entity_type_key: 'person', entity_id: 'second' } }],
      [{ type: 'tool_result', callId: 'two', result: ['second', null, 42] }],
      [{ type: 'final', reply: 'Complete fixture answer.' }],
    ] }
    current = turn
    res.on('close', () => {
      if (current === turn) { disconnected = true; current = undefined }
    })
    send({ type: 'tool_call', callId: 'one', tool: 'get_entity', args: { entity_type_key: 'person', entity_id: 'first' } })
    return
  }
  const upstream = request({ hostname: 'localhost', port: 5173, method: req.method,
    path: req.url, headers: { ...req.headers, host: 'localhost:5173' } }, (incoming) => {
    res.writeHead(incoming.statusCode, incoming.headers)
    incoming.pipe(res)
  })
  upstream.on('error', () => { res.writeHead(502); res.end('Start the dev app first') })
  req.pipe(upstream)
}).listen(5181, '127.0.0.1', () => console.log('Chat browser fixture: http://localhost:5181'))
