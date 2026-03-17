# @rawe/ontoforge-runtime

TypeScript client SDK for the [OntoForge](https://github.com/rawe/ontoforge) Runtime API.

Provides type-safe access to ontology-scoped knowledge graph operations: entity and relation CRUD, graph traversal, semantic search, and raw Cypher queries.

## Installation

```bash
npm install @rawe/ontoforge-runtime
```

## Quick Start

```ts
import { OntoForgeRuntime } from '@rawe/ontoforge-runtime';

const client = new OntoForgeRuntime({
  baseUrl: 'http://localhost:8000',
  ontology: 'my_ontology',
});

// Create an entity
const alice = await client.createEntity('person', {
  name: 'Alice',
  age: 30,
});

// List entities with filtering
const engineers = await client.listEntities('person', {
  filters: { role: 'Engineer' },
  limit: 20,
});

// Get neighbors
const neighborhood = await client.getNeighbors('person', alice._id);
```

## Configuration

### Constructor Options

| Option | Type | Required | Description |
|--------|------|----------|-------------|
| `baseUrl` | `string` | Yes | OntoForge server URL (e.g. `http://localhost:8000`) |
| `ontology` | `string` | No | Default ontology key for all requests |
| `fetch` | `typeof fetch` | No | Custom fetch implementation for testing or middleware |

### Ontology Resolution

The ontology is resolved in this order:

1. **Per-method override** — `{ ontology: 'other' }` passed to any method
2. **Constructor default** — the `ontology` option from the constructor
3. **Error** — throws `OntoForgeError` with code `VALIDATION_ERROR` if neither is set

This lets you set a default once and override when needed:

```ts
// Default ontology
const client = new OntoForgeRuntime({
  baseUrl: 'http://localhost:8000',
  ontology: 'main',
});

// Uses "main" ontology
await client.listEntities('person');

// Override for this call only
await client.listEntities('person', { ontology: 'test_data' });
```

If your application works with multiple ontologies equally, omit the constructor default and pass `ontology` to each call:

```ts
const client = new OntoForgeRuntime({ baseUrl: 'http://localhost:8000' });

await client.listEntities('person', { ontology: 'ontology_a' });
await client.listEntities('person', { ontology: 'ontology_b' });
```

## Error Handling

All errors are thrown as `OntoForgeError` instances with typed error codes:

```ts
import { OntoForgeRuntime, OntoForgeError } from '@rawe/ontoforge-runtime';

try {
  await client.getEntity('person', 'nonexistent-id');
} catch (err) {
  if (err instanceof OntoForgeError) {
    console.log(err.code);    // 'RESOURCE_NOT_FOUND'
    console.log(err.status);  // 404
    console.log(err.message); // Human-readable message
    console.log(err.details); // Optional structured details
  }
}
```

### Error Codes

| Code | HTTP Status | Description |
|------|-------------|-------------|
| `RESOURCE_NOT_FOUND` | 404 | Entity, relation, or type not found |
| `RESOURCE_CONFLICT` | 409 | Duplicate or conflicting resource |
| `VALIDATION_ERROR` | 422 | Schema validation failed (check `details.fields`) |
| `CASCADE_REQUIRED` | 409 | Deletion blocked by dependent resources |
| `INVALID_JSON` | 400 | Malformed request body |
| `FEATURE_DISABLED` | 422 | Feature not available (e.g. semantic search) |
| `NETWORK_ERROR` | 0 | Network-level failure (fetch rejected) |
| `UNKNOWN` | varies | Unrecognized server error |

### Validation Error Details

When `code` is `VALIDATION_ERROR`, the `details.fields` object maps property keys to error messages:

```ts
try {
  await client.createEntity('person', { age: 'not-a-number' });
} catch (err) {
  if (err instanceof OntoForgeError && err.code === 'VALIDATION_ERROR') {
    console.log(err.details?.fields);
    // { age: "Expected integer, got string", name: "Required property missing" }
  }
}
```

## API Reference

### Features

```ts
// Check server capabilities (no ontology required)
const features = await client.features();
if (features.semanticSearch) {
  // Semantic search is available
}
```

### Schema Introspection

```ts
const schema = await client.getSchema();
const entityTypes = await client.getEntityTypes();
const personType = await client.getEntityType('person');
const relationTypes = await client.getRelationTypes();
const worksFor = await client.getRelationType('works_for');
```

### Entity CRUD

```ts
// Create
const entity = await client.createEntity('person', { name: 'Alice', age: 30 });

// List with filtering, search, sorting, pagination
const page = await client.listEntities('person', {
  q: 'alice',                    // text search across string properties
  filters: { age__gte: '25' },   // property filters with operators
  sort: 'name',
  order: 'asc',
  limit: 20,
  offset: 0,
  fields: ['name', 'age'],       // field projection
});

// Get by ID
const person = await client.getEntity('person', entity._id);

// Get with field projection
const partial = await client.getEntity('person', entity._id, {
  fields: ['name'],
});

// Update (partial)
const updated = await client.updateEntity('person', entity._id, { age: 31 });

// Remove an optional property by setting it to null
await client.updateEntity('person', entity._id, { nickname: null });

// Delete (also removes connected relations)
await client.deleteEntity('person', entity._id);
```

### Relation CRUD

```ts
// Create
const rel = await client.createRelation('works_for', {
  fromEntityId: personId,
  toEntityId: companyId,
  since: '2024-03-15',
});

// List with filtering
const rels = await client.listRelations('works_for', {
  fromEntityId: personId,
  limit: 10,
});

// Get, update, delete
const relation = await client.getRelation('works_for', rel._id);
await client.updateRelation('works_for', rel._id, { since: '2025-01-01' });
await client.deleteRelation('works_for', rel._id);
```

### Graph Traversal

```ts
const hood = await client.getNeighbors('person', personId, {
  direction: 'outgoing',        // 'outgoing' | 'incoming' | 'both'
  relationTypeKey: 'works_for', // filter by relation type
  limit: 50,
  fields: ['name'],             // project entity properties
  relationFields: ['since'],    // project relation properties
});

console.log(hood.entity);       // the center entity
for (const n of hood.neighbors) {
  console.log(n.relation);      // { _id, _relationTypeKey, direction, ... }
  console.log(n.entity);        // the connected entity
}
```

### Semantic Search

Search entities by natural language meaning using vector embeddings. Requires the server to have `EMBEDDING_PROVIDER` configured.

```ts
const results = await client.semanticSearch({
  q: 'distributed systems engineers',
  type: 'person',
  limit: 10,
  minScore: 0.7,
  filters: { department: 'Engineering' },
  fields: ['name', 'role'],
});

for (const hit of results.results) {
  console.log(hit.entity.name, hit.score); // "Alice Chen" 0.92
}
```

Check availability first:

```ts
const { semanticSearch } = await client.features();
if (semanticSearch) {
  const results = await client.semanticSearch({ q: 'AI researchers', type: 'person' });
}
```

### Cypher Queries

Execute read-only Cypher queries against the ontology-scoped schema. Use **schema keys** (snake_case for entities, snake_case for relations) — the server rewrites them to Neo4j conventions automatically.

```ts
const result = await client.query(
  "MATCH (p:person)-[r:works_for]->(c:company) WHERE p.name = 'Alice' RETURN p, c LIMIT 10"
);

console.log(result.columns); // ['p', 'c']
for (const row of result.results) {
  console.log(row.p); // entity object with properties
  console.log(row.c); // entity object with properties
}
```

**Supported clauses:** `MATCH`, `OPTIONAL MATCH`, `WHERE`, `RETURN`, `ORDER BY`, `LIMIT`, `SKIP`, `WITH`, `UNWIND`.

**Blocked operations:** Write clauses (`CREATE`, `SET`, `DELETE`, `MERGE`, `REMOVE`), procedure calls (`CALL`), labelless node patterns, and internal labels.

System properties (`_id`, `_createdAt`, `_updatedAt`) are always available:

```ts
const recent = await client.query(
  "MATCH (p:person) WHERE p._createdAt > '2026-01-01' RETURN p ORDER BY p._createdAt DESC LIMIT 5"
);
```

Override ontology for a specific query:

```ts
const result = await client.query(
  "MATCH (p:person) RETURN p LIMIT 5",
  { ontology: 'other_ontology' }
);
```

## Custom Fetch

Pass a custom `fetch` function for testing, logging, or adding headers:

```ts
const client = new OntoForgeRuntime({
  baseUrl: 'http://localhost:8000',
  ontology: 'my_ontology',
  fetch: (url, init) => {
    console.log(`${init?.method ?? 'GET'} ${url}`);
    return fetch(url, {
      ...init,
      headers: { ...init?.headers, 'X-Request-ID': crypto.randomUUID() },
    });
  },
});
```

## TypeScript

All types are exported for use in your application:

```ts
import type {
  EntityInstance,
  RelationInstance,
  RuntimeSchema,
  EntityType,
  PaginatedResponse,
  CypherQueryResult,
  SemanticSearchResponse,
  OntoForgeErrorCode,
} from '@rawe/ontoforge-runtime';
```

## Requirements

- Node.js 18+ (or any runtime with global `fetch`: Deno, Bun, modern browsers)
- An OntoForge server instance

## License

MIT
