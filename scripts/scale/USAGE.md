# Shared-state harness

Two backends sharing one PostgreSQL and one Valkey, behind a round-robin load balancer,
with a deterministic fake model server. Compose project `ontoforge-scale`
(`docker/scale/compose.yml`); it never touches the dev database.

| Service | Host port | |
|---|---|---|
| `lb` (nginx) | 18000 | round robin, no stickiness, header `X-Upstream` names the backend |
| `backend-a`, `backend-b` | 18001, 18002 | built from `server/` as it is on disk, 1 CPU and 768 MB each |
| `postgres` | 25432 | volume `ontoforge-scale_pg` |
| `valkey` | 26379 | nothing persisted, `noeviction`, 256 MB |
| `fake-ollama` | 18080 | `fake-ollama.mjs` |
| `frontend` (profile `ui`) | 13000 | `COMPOSE_PROFILES=ui ./dev.sh scale up` |

The backends' configuration is `env/scale.env`. `./dev.sh scale up env/scale-ollama.env`
uses the host's Ollama instead, for a manual smoke test (reset first: the fake's 16-wide
vectors and bge-m3 do not mix). `./dev.sh env/scale-host.env` runs a third, debuggable
server from source on :8000 that joins the two containers.

## Commands

```sh
./dev.sh scale up            # build, start, wait until every service answers (bounded)
./dev.sh scale status        # containers and the HTTP status of each service
./dev.sh scale test [name…]  # scenarios, all by default
./dev.sh scale bench         # benchmark, results to .scratch/horizontal-scaling/evidence/
./dev.sh scale logs [svc…]   # follow logs
./dev.sh scale down          # remove the containers, keep the database volume
./dev.sh scale reset         # remove the containers and the database volume
```

`up` rebuilds the server image from the working tree, so run it again after a server
change.

## Scenarios (`scenarios.mjs`)

They load the fixture `people_basic` through the load balancer when `fx_people_basic`
is missing, and chat with its unscoped lens's built-in agent. The fake answers
`user-messages:<n>`, so a turn's reply shows how many user messages the model saw.

| Name | Checks |
|---|---|
| `continue` | a conversation started on A continues on B; reading it on A and through the LB shows both turns |
| `replace` | A stops; the conversation continues on B; A starts again and continues it; a GET loop through the LB sees no error |
| `valkey-reset` | after a Valkey restart the old thread is `THREAD_NOT_FOUND` on A and B once each has reconnected (a storage error until then), a new conversation works, the ontology data is unchanged |
| `stale-schema` | B has read the schema; A adds a property and makes another required; B must accept the new property and reject a create without the required one |
| `fencing` | worker fencing across processes: B paused, a person updated through A, A parked in the fake's embed call; the claim's lease expired in SQL, B resumes and builds a newer update; then A's call is answered — A logs `Search claim lost`, the entry keeps B's version, the queue is empty, nothing failed |
| `drain` | a short turn finishes while A stops, a long one is cut and leaves the thread at its previous turn, and the next turn on B is not `THREAD_BUSY` |
| `upgrade` | with A and B stopped, the storage is set back to version 8 in SQL (every namespace loses its design revision); A and B start together: exactly one `Upgrading storage` line across both, both ready, version 9, every design revision back, the ontology data unchanged |

Each prints its evidence (HTTP statuses, thread ids, counts) and PASS, FAIL or SKIP;
the exit code is 1 when one failed.

## Benchmark (`bench.mjs`)

`--duration 60 --warmup 10 --concurrency 32 --chat-threads 20 --chat-turns 6` are the
defaults. A mixed REST load (70 % filtered list, 20 % read by id, 10 % create) runs
against A directly, against A alone through the LB (B stopped), and against A and B
through the LB; then conversations through the LB. It records throughput, p50/p95/p99, errors, the LB's distribution and
`docker stats` taken mid-run, and deletes what it created. Everything runs on one
machine, so the numbers compare the two setups and are no capacity figure; the report
lists the limitations next to them.
