# Kubernetes example manifests

An example of running several OntoForge servers side by side. Not a Helm chart and
not run in CI; adapt it to your cluster.

| File | Contains |
|---|---|
| `config.yaml` | ConfigMap `ontoforge-config` holding the one env file |
| `server.yaml` | Deployment `ontoforge-server` (2 replicas), Service, PodDisruptionBudget |
| `valkey.yaml` | Valkey as a 1-replica StatefulSet without a volume, and its Service |

```sh
kubectl create secret generic ontoforge-secrets --from-literal=DB_PASSWORD=…   # once
kubectl apply -f deploy/kubernetes/      # after editing the placeholders
```

The Secret is created out of band (as above, a sealed secret or an external secret
operator) and never from a committed file, so applying the directory never replaces it.
It also carries `EMBEDDING_API_KEY`, `AI_API_KEY`, and a `VALKEY_URL` with a password.

## What it assumes

- **PostgreSQL runs elsewhere** (managed or your own operator) and is named in `DB_URI`.
  Every replica uses the same database; schema and data never live in a pod.
- **A server release with `/livez`, `/readyz` and `SHARED_STATE`.** Replace `VERSION` in
  the image with that release, pinned.
- **One env file.** The ConfigMap key `ontoforge.env` is mounted at `/config` and named by
  `ENV_FILE`. Secrets come from `ontoforge-secrets` as environment variables, which win
  over the file.
- **Shared state lives in Valkey** — the conversations and, with authentication on, the
  browser sessions, shared by every replica — so the
  Service needs no session affinity. Without Valkey the server runs as exactly one replica
  with `SHARED_STATE=memory` (the default); more than one replica requires deploying Valkey
  and setting `SHARED_STATE=valkey` and `VALKEY_URL`. Nothing checks this: a pod cannot see
  the other replicas. Valkey keeps nothing on disk: restarting it ends every open
  conversation (clients get `THREAD_NOT_FOUND` and start a new one) and every browser
  session (users sign in again), and nothing else.
  `noeviction` makes a full store refuse new turns instead of dropping conversations.
  The pod's memory limit (512 Mi) stays well above `maxmemory` (256 MB): client buffers
  are not counted in it, and an OOM kill would end every conversation.
- **Probes**: `/livez` for startup (up to 30 minutes, which covers a storage upgrade at
  boot) and liveness, `/readyz` for readiness.
- **Shutdown**: `preStop` sleeps 5 s so the Service stops routing to the pod, then
  SIGTERM starts the drain (`SHUTDOWN_DRAIN_SECONDS`, 20 s by default).
  `terminationGracePeriodSeconds: 45` stays above preStop + drain + closing the stores.
  Raise it together with `SHUTDOWN_DRAIN_SECONDS`.
- **Rolling update** with `maxUnavailable: 0`, and a PodDisruptionBudget keeping one
  server up during node drains.

## Updating

A release that keeps the storage version rolls as usual. One that raises it starts only
after every older server has stopped: scale to 0, back up the database, set the new image,
scale up. One server upgrades the storage while the others wait; OntoForge is unavailable
until the pods are ready.

## Not included

Ingress and TLS, the web client, PostgreSQL, NetworkPolicy, autoscaling, Valkey high
availability or persistence. An Ingress you add routes only the public paths; the probes
and `/metrics` stay internal ([interfaces.md](../../docs/interfaces.md#exposure)).

## Checked

The manifests validate against the Kubernetes 1.31 schemas (`kubeconform -strict`). They
have not been applied to a cluster. The same behaviour — two servers, a shared Valkey,
replacing a server, restarting Valkey — is exercised locally by the Compose harness
(`./dev.sh scale …`, see `scripts/scale/USAGE.md`).
