# 0008. Persistence port with exchangeable database adapters

- **Status:** Accepted
- **Date:** 2026-07-19

## Context

OntoForge was built against Neo4j, and database-specific detail — driver types, query
text, physical naming, index DDL — had spread through services and routers. That ties the
product to one database and makes the storage backend impossible to exchange.

## Decision

The backend accesses the database only through a persistence port (`core/ports.ts`): a
`ModelingStore` and a `RuntimeStore`, selected via `DB_BACKEND`. Everything
database-specific — driver, connections, query text, physical naming (labels,
PascalCase/UPPER_SNAKE_CASE), index DDL, driver temporal types — lives in an adapter
package (`adapters/neo4j/`).

## Consequences

Services, routers, and MCP handlers speak ontology vocabulary — type keys, property keys,
instance UUIDs, structured filters — and never see driver types or query fragments. Neo4j
was the first adapter behind the port. *(Editorial correction: this sentence originally
read "Neo4j is the reference adapter and the default deployment" — superseded by the
peers rule in [../decisions.md](../decisions.md#storage): adapters are peers under one
contract, and no adapter is the reference implementation.)*
