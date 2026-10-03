# Decision API

OntoForge includes an optional server-side decision-model client in
`server/src/core/decision.ts`. No REST endpoint, MCP tool or UI currently uses it.
It does not require a language model, embeddings or a database.

## Configuration

| Variable | Default | Meaning |
|---|---|---|
| `DECISION_BASE_URL` | unset | Provider origin/base path, before `/v1/systemone`; unset disables initialization. |
| `DECISION_MODEL` | `jev-1.13.0` | Model identifier sent to the provider. |
| `DECISION_API_KEY` | unset | Optional Bearer credential; falls back to `TYPESAFE_API_KEY`. |

Startup installs the configured client without making a network request. Internal
callers use `getDecisionModel()` and handle `null` when disabled. An independent client
can also be constructed with `createDecisionModel(baseUrl, modelName, apiKey)`.

`env/ollama.env` remains the ordinary Ollama preset. Use
[`env/ollama-decision.env`](../../env/ollama-decision.env) as a template for local
Ollama (BGE-M3, 1024 dimensions) plus TypeSafe's Decision API. It sets
`DECISION_BASE_URL=https://api.typesafe.ai` and pins `DECISION_MODEL=jev-1.13.0`.
These values follow TypeSafe's [API reference](https://docs.typesafe.ai/api) and
[model list](https://docs.typesafe.ai/models).

Copy the template before adding your own TypeSafe API key:

```sh
cp env/ollama-decision.env env/ollama-decision.local.env
# Replace REPLACE_WITH_YOUR_TYPESAFE_API_KEY in the uncommitted copy.
./dev.sh env/ollama-decision.local.env
```

The key in the committed template is a placeholder, not a usable credential.
For another compatible provider, change the base URL, model identifier and key;
its endpoint must implement the same `POST /v1/systemone` contract. Credentials
belong in uncommitted configuration, never committed presets.

## Contract

`DecisionModel.decide(state, questions, signal?)` returns answers keyed by question.
The HTTP adapter implements the TypeSafe/System One-compatible contract:

```json
{
  "model": "jev-1.13.0",
  "state": "The support request is about a failed login.",
  "questions": {
    "category": {
      "type": "choice",
      "instructions": "Classify the request.",
      "criteria": {"account": "Account access", "billing": "Payments"}
    },
    "access": {"type": "noul", "instructions": "Is this about account access?"}
  }
}
```

The adapter sends this JSON to `POST {baseUrl}/v1/systemone`. The response envelope is
`{ "answers": { ... } }`. A choice answer contains `type: "choice"`, `choice`,
`probabilities` for every option and `confidence`; a yes/no answer contains
`type: "noul"` and `noul`, the probability of yes. Numeric probabilities are between
zero and one; choice probabilities must sum to one within 0.02.

Each call accepts 1–32 questions; each choice has 2–255 options. Only `choice` and
`noul` are supported. The client validates response types, required answers, option
membership and probabilities. Callers supply context and interpret uncertainty;
validation does not establish calibration or correctness.

Calls have a 10-second timeout and accept an abort signal. HTTP failures, malformed
responses and cancellation reject the promise. There is no automatic retry or
fallback. Context and questions are sent to the configured provider only when
`decide` is invoked.

## Tests

From `server/`:

```sh
npm test
DECISION_BASE_URL=http://localhost:8002 DECISION_MODEL=Mapika/decider-0.8b \
  DECISION_API_KEY= TYPESAFE_API_KEY= npm run test:integration:decision
```

The unit suite covers the client contract and error paths with controlled responses.
The integration suite loads `env/test.env`, not the TypeSafe template, and uses
the explicitly configured real local API with synthetic text and verifies
response shape for both question types. It requires a loopback URL and no credential;
it does not assess classification quality, access ontology data or reset a database.

## Streaming

REST delivery retains a generic `StreamEvent` envelope in
`server/src/runtime/chatStream.ts`. The frontend's `readNdjsonStream` handles fragmented
UTF-8, framing and reader cleanup; its caller identifies terminal events. The existing
`readChatStream` wrapper still validates chat events, tool-call/result pairing and
terminal replies. Existing chat endpoints and their wire format are unchanged.
