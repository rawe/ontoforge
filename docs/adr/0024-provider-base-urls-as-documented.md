# 0024. Provider base URLs as the provider documents them, with a hard cut

- **Status:** Accepted
- **Date:** 2026-10-09

## Context

The server appended `/v1` to every OpenAI-compatible base URL. Every vendor documents that
base with the version already in it — OpenAI, OpenRouter, OVHcloud, Anthropic's
compatibility layer — so the value an operator copies from the vendor's documentation
produced `/v1/v1`. Nothing failed at startup; the first model call answered 404, behind a
generic planning or chat failure.

## Alternatives considered

- **Keep the bare host and append `/v1`, with better documentation** — rejected: it keeps
  the server's rule opposed to every vendor's, so the copied value stays the wrong one, and
  hosts that do not serve the API at `/v1` (`/api/v1`, `/v1beta/openai`) need a host that
  is not really a host.
- **Full request URL per operation** — rejected: chat, model listing and embeddings would
  each need their own variable, and no vendor documents its API that way.
- **Accept both forms, appending `/v1` to an unversioned base with a deprecation warning**
  — rejected: it keeps a second spelling valid until a later release removes it, and a
  warning in a startup log is easily missed. The boot failure names the corrected value, so
  migrating is one edit per variable.
- **Accept both forms silently, forever** — rejected: two spellings of one setting,
  and a value without a version would stay ambiguous.

The cut is breaking, and that was accepted: a deployment whose OpenAI-compatible base URL
has no version segment stops at startup until the variable gains it. Ollama bases do not
change.

## Outcome

The base-URL rule in [decisions.md](../decisions.md#behaviour).
