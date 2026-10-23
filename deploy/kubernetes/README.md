# Kubernetes example manifests

An example of running several OntoForge servers side by side. Not a Helm chart and
not run in CI; adapt it to your cluster.

| File | Contains |
|---|---|
| `config.yaml` | ConfigMap `ontoforge-config` holding the one env file, Secret `ontoforge-secrets` with placeholders |
| `server.yaml` | Deployment `ontoforge-server` (2 replicas), Service, PodDisruptionBudget |
| `valkey.yaml` | Valkey as a 1-replica StatefulSet without a volume, and its Service |

```sh
kubectl apply -f deploy/kubernetes/      # after editing the placeholders
```

## What it assumes

- **PostgreSQL runs elsewhere** (managed or your own operator) and is named in `DB_URI`.
  Every replica uses the same database; schema and data never live in a pod.
- **A server release with `/livez`, `/readyz` and `THREAD_STORE`.** Replace `VERSION` in
  the image with that release, pinned.
- **One env file.** The ConfigMap key `ontoforge.env` is mounted at `/config` and named by
  `ENV_FILE`. Secrets come from `ontoforge-secrets` as environment variables, which win
  over the file. Create the real Secret out of band; the committed values are placeholders.
- **Conversations live in Valkey**, shared by every replica, so the Service needs no
  session affinity. Valkey keeps nothing on disk: restarting it ends every open
  conversation (clients get `THREAD_NOT_FOUND` and start a new one) and nothing else.
  `noeviction` makes a full store refuse new turns instead of dropping conversations.
- **Probes**: `/livez` for startup (up to 5 minutes, which covers a storage upgrade at
  boot) and liveness, `/readyz` for readiness.
- **Shutdown**: `preStop` sleeps 5 s so the Service stops routing to the pod, then
  SIGTERM starts the drain (`SHUTDOWN_DRAIN_SECONDS`, 20 s by default).
  `terminationGracePeriodSeconds: 45` stays above preStop + drain + closing the stores.
  Raise it together with `SHUTDOWN_DRAIN_SECONDS`.
- **Rolling update** with `maxUnavailable: 0`, and a PodDisruptionBudget keeping one
  server up during node drains. While an older release and this one run side by side,
  make no design changes.

## Not included

Ingress and TLS, the web client, PostgreSQL, NetworkPolicy, autoscaling, Valkey high
availability or persistence.

## Checked

The manifests validate against the Kubernetes 1.31 schemas (`kubeconform -strict`). They
have not been applied to a cluster. The same behaviour — two servers, a shared Valkey,
replacing a server, restarting Valkey — is exercised locally by the Compose harness
(`./dev.sh scale …`, see `scripts/scale/USAGE.md`).
