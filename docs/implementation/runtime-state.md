# Runtime state implementation

For contributors changing runtime caches or assistant turn execution. The architectural
guarantees are described in [architecture](../architecture.md#schema-cache); the observable
conversation behavior is described in [threads](../capabilities/threads.md).

## Schema cache capacity

Each server process caches at most **512 lenses** and **128 search contexts**, evicting
the least recently used entry first. These are the `MAX_LENSES` and
`MAX_SEARCH_CONTEXTS` constants in [schemaCache.ts](../../server/src/runtime/schemaCache.ts).
They are not deployment settings.

A capacity change affects memory use and how often an entry is rebuilt. It must preserve
the [design-revision check](../architecture.md#design-revision): a cached entry can be used
only while its revision matches the ontology's current revision. An ontology deleted and
created under the same key must not reuse the earlier ontology's entries.

## Turn leases

A running assistant turn holds a **30-second lease** and renews it every **10 seconds**.
The cadence is defined by `TURN_LEASE_MS` and `TURN_HEARTBEAT_MS` in
[threadStore.ts](../../server/src/runtime/threads/threadStore.ts).

The lease bounds how long a server that dies can leave its thread busy. Renewal keeps a
live turn's ownership; every publish, renewal or release is checked against its owner
token so an expired owner cannot overwrite a newer turn. A successful publish stores the
complete state and ends the lease atomically. Cancellation or failure releases the lease
without publishing a partial turn. The memory and Valkey stores implement the same
contract.

The lease cadence is separate from caller-visible conversation limits: turns retained,
turns supplied to the model, maximum state size and idle expiry. Those limits and the
store-capacity behavior remain described in the architectural
[thread-store contract](../architecture.md#thread-store). Changes to lease timing must
still account for the recovery delay a client observes after a server fails.

## Navigator turn execution

The navigator implements its fixed pipeline with LangGraph. Its
[turn graph](../../server/src/runtime/assistants/navigators/index.ts) sequences the steps
and checkpoints the thread; working values live in the closure of one turn rather than
shared state between requests. The [runtime wrapper](../../server/src/runtime/assistants/navigators/runtime.ts)
announces the topology before running it, traces the steps under the `navigator` event
prefix, and emits the summary last.

The pipeline's behavior, including its model calls and retry policy, belongs to the
[navigator capability](../capabilities/navigators.md#answering-a-question). Its wire events
belong to the [interface reference](../interfaces.md#navigator-list-and-chat). A framework
change must preserve the thread's atomic-turn and single-owner guarantees as well as
those observable contracts.
