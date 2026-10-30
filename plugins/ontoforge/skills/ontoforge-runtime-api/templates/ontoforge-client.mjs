// OntoForge runtime client — a starting point to copy into an application.
// Dependency-free ES module for Node 18+ (built-in fetch). Adapt freely.
//
// Configuration comes from the application, never from this file:
//   const client = createClient(configFromEnv());
// configFromEnv() reads ONTOFORGE_ONTOLOGY and ONTOFORGE_LENS, ONTOFORGE_BASE_URL
// (default http://localhost:8000, the local server; set it for a remote one) and
// the optional ONTOFORGE_API_TOKEN. Pass an object of your own instead when the
// application keeps its configuration elsewhere (a secret manager, a config file).
//
// The token is optional: it is needed only when authentication is enabled on the
// server, which then expects `Authorization: Bearer <token>`. The client sends
// the token only to baseUrl, refuses redirects while it holds one, and never puts
// it into an error message or a log line.

export class OntoForgeError extends Error {
  /**
   * @param {number} status HTTP status
   * @param {string} code one of the six top-level error codes, or AUTH
   * @param {string|undefined} detailsCode the narrowing details.code, e.g. FEATURE_DISABLED
   * @param {object|undefined} details the full details object
   */
  constructor(message, status, code, detailsCode, details) {
    super(message);
    this.status = status;
    this.code = code;
    this.detailsCode = detailsCode;
    this.details = details;
  }
}

export function configFromEnv(env = process.env) {
  const missing = ['ONTOFORGE_ONTOLOGY', 'ONTOFORGE_LENS'].filter((k) => !env[k]);
  if (missing.length) throw new Error(`missing configuration: ${missing.join(', ')}`);
  return {
    baseUrl: env.ONTOFORGE_BASE_URL || 'http://localhost:8000',
    ontology: env.ONTOFORGE_ONTOLOGY,
    lens: env.ONTOFORGE_LENS,
    token: env.ONTOFORGE_API_TOKEN || undefined,
  };
}

export function createClient({ baseUrl, ontology, lens, token }) {
  const root = baseUrl.replace(/\/+$/, '');
  const runtime =
    `/api/ontologies/${encodeURIComponent(ontology)}/runtime/lenses/${encodeURIComponent(lens)}`;
  const seg = encodeURIComponent;

  async function send(method, path, { query, body } = {}) {
    const qs = query ? `?${toQuery(query)}` : '';
    const headers = {};
    if (token) headers.Authorization = `Bearer ${token}`;
    if (body !== undefined) headers['Content-Type'] = 'application/json';
    const res = await fetch(`${root}${path}${qs}`, {
      method,
      headers,
      body: body === undefined ? undefined : JSON.stringify(body),
      ...(token ? { redirect: 'manual' } : {}),
    });
    if (res.ok) return res;
    if (res.status === 401 || res.status === 403) {
      throw new OntoForgeError(
        `${method} ${path}: ${res.status}` +
          (token ? ' — the token was rejected' : ' — authentication is enabled and needs a Bearer token'),
        res.status,
        'AUTH',
      );
    }
    if (res.status >= 300 && res.status < 400) {
      throw new OntoForgeError(`${method} ${path}: redirect refused (${res.status})`, res.status, 'REDIRECT');
    }
    const payload = await res.json().catch(() => null);
    const error = payload?.error ?? { code: 'UNKNOWN', message: res.statusText };
    throw new OntoForgeError(
      `${method} ${path}: ${error.code} ${error.message}`,
      res.status,
      error.code,
      error.details?.code,
      error.details,
    );
  }

  const json = async (method, path, opts) => {
    const res = await send(method, path, opts);
    return res.status === 204 ? null : res.json();
  };

  return {
    /** Deployment: { baseUrl, version } and { semanticSearch, rankedSearch, ai, decisions }. */
    serverInfo: () => json('GET', '/api/server/info'),
    features: () => json('GET', '/api/server/features'),

    /** The lens's schema: { lens, entityTypes, relationTypes }. */
    schema: () => json('GET', `${runtime}/schema`),

    /** One page: { items, total, limit, offset }. `query` takes limit, offset, sort, order, q, fields, filter.* */
    listEntities: (type, query) => json('GET', `${runtime}/entities/${seg(type)}`, { query }),

    /** Every entity matching `query`, page by page. */
    async *allEntities(type, query = {}) {
      const limit = 200;
      for (let offset = 0; ; offset += limit) {
        const page = await json('GET', `${runtime}/entities/${seg(type)}`, {
          query: { ...query, limit, offset },
        });
        yield* page.items;
        if (offset + page.items.length >= page.total || page.items.length < limit) return;
      }
    },

    getEntity: (type, id, fields) =>
      json('GET', `${runtime}/entities/${seg(type)}/${seg(id)}`, { query: fields && { fields } }),
    createEntity: (type, values) => json('POST', `${runtime}/entities/${seg(type)}`, { body: values }),
    updateEntity: (type, id, changes) =>
      json('PATCH', `${runtime}/entities/${seg(type)}/${seg(id)}`, { body: changes }),
    deleteEntity: (type, id) => json('DELETE', `${runtime}/entities/${seg(type)}/${seg(id)}`),

    /** Document content, whole or by character range: { content, offset, length, totalLength, ... }. */
    readDocument: (type, id, property, range) =>
      json('GET', `${runtime}/entities/${seg(type)}/${seg(id)}/documents/${seg(property)}`, { query: range }),

    listRelations: (type, query) => json('GET', `${runtime}/relations/${seg(type)}`, { query }),
    createRelation: (type, fromEntityId, toEntityId, values = {}) =>
      json('POST', `${runtime}/relations/${seg(type)}`, { body: { fromEntityId, toEntityId, ...values } }),
    deleteRelation: (type, id) => json('DELETE', `${runtime}/relations/${seg(type)}/${seg(id)}`),

    neighbors: (type, id, query) =>
      json('GET', `${runtime}/entities/${seg(type)}/${seg(id)}/neighbors`, { query }),
    /** Ranked entities: { ran, items, limitations }. `request` takes types or indices, keyword, semantic, filter, limit. */
    searchEntities: (query, request = {}) =>
      json('POST', `${runtime}/search/entities`, { body: { ...request, query } }),
    /** Ranked passages: { ran, items, limitations }. `request` also takes documents, perEntity, text. */
    searchPassages: (query, request = {}) =>
      json('POST', `${runtime}/search/passages`, { body: { ...request, query } }),
    oql: (text) => json('POST', `${runtime}/query`, { body: { query: text } }),
    runSavedQuery: (key, params = {}) =>
      json('POST', `${runtime}/saved-queries/${seg(key)}/run`, { body: { params } }),

    /**
     * One chat turn with an assistant; yields the NDJSON events as they arrive.
     * kind: 'agents' | 'retrievers' | 'navigators'. Keep the threadId from the
     * first `thread` event to continue the conversation. Breaking out of the loop
     * closes the connection, which cancels the turn.
     */
    async *chat(kind, assistantKey, message, threadId) {
      const res = await send('POST', `${runtime}/ai/assistants/${seg(kind)}/${seg(assistantKey)}/chat`, {
        body: threadId ? { message, threadId } : { message },
      });
      const decoder = new TextDecoder();
      let buffer = '';
      let terminal = false;
      for await (const chunk of res.body) {
        buffer += decoder.decode(chunk, { stream: true });
        let nl;
        while ((nl = buffer.indexOf('\n')) !== -1) {
          const line = buffer.slice(0, nl).trim();
          buffer = buffer.slice(nl + 1);
          if (!line) continue;
          const event = JSON.parse(line);
          if (event.type === 'final' || event.type === 'error') terminal = true;
          yield event;
        }
      }
      if (!terminal) throw new OntoForgeError('chat stream ended without final or error', 0, 'INCOMPLETE_TURN');
    },
  };
}

// Repeated keys (fields) take an array; filters are passed as their full
// parameter names, e.g. { 'filter.status__ne': 'archived' }.
function toQuery(query) {
  const params = new URLSearchParams();
  for (const [key, value] of Object.entries(query)) {
    if (value === undefined || value === null) continue;
    for (const v of Array.isArray(value) ? value : [value]) params.append(key, String(v));
  }
  return params.toString();
}
