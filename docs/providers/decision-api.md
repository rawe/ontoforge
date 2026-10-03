# Decision API

OntoForge provides an optional internal client for typed decisions about caller-supplied
context. It returns structured judgments rather than generated text. It is independent
of the language model, embeddings and storage. Its consumer is
[entity identity comparison](../capabilities/entity-identity-comparison.md).

## Supported primitives

| Primitive | Input | Answer |
|---|---|---|
| `choice` | Named options with descriptions | Selected option, probability for every option, and confidence |
| `score` | 2–10 ordered level descriptions | Fractional score, probability for every level, level legend, and confidence |
| `noul` | A yes/no question | Probability of yes |

Several named questions can share one state in a single call. Answers use the same
question keys. For `score`, describe each level in words and order the descriptions
from low to high. The score is the probability-weighted position on these zero-based
levels, from 0 to the last level; it can fall between levels. The caller decides how
to act on probabilities and uncertainty.

## Provider contract

The client implements the TypeSafe/System One-compatible HTTP contract:
`POST {baseUrl}/v1/systemone`, with an optional Bearer credential.

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
    "access": {"type": "noul", "instructions": "Is this about account access?"},
    "severity": {
      "type": "score",
      "instructions": "How severe is the reported issue?",
      "criteria": ["Cosmetic issue", "Feature degraded; workaround exists", "Blocking issue"]
    }
  }
}
```

The response is `{ "answers": { ... } }`. The client validates answer types, option
membership and probabilities, supports cancellation and a bounded timeout, and reports
failures to the caller. It does not retry or choose a fallback automatically.
Validation checks the contract, not the correctness or calibration of a judgment.
Context is sent to the provider only when a caller requests a decision.

## Configuration and use

| Setting | Purpose |
|---|---|
| `DECISION_BASE_URL` | Provider base URL before `/v1/systemone`; unset leaves the client disabled |
| `DECISION_MODEL` | Provider's model identifier |
| `DECISION_API_KEY` | Bearer credential; falls back to `TYPESAFE_API_KEY` when unset |

Startup installs the configured client without contacting the provider. Internal
callers can use the configured client, handling the disabled state, or construct an
independent client. The programmatic contract is defined in the
[provider implementation](../../server/src/core/decision.ts).

Use [`env/ollama-decision.env`](../../env/ollama-decision.env) as the example for Ollama
plus TypeSafe's Jev API. Copy it to an uncommitted `env/*.local.env`, replace the explicit
key placeholder with your own TypeSafe key, and pass the copy to `./dev.sh`. For another
compatible provider, replace its base URL, model identifier and credential.

Provider reference: [TypeSafe HTTP API](https://docs.typesafe.ai/api) and
[model identifiers](https://docs.typesafe.ai/models). Test procedures are in
[Testing](../workflows/testing.md).
