# Provider base URLs as the provider documents them

Current behavior: [Provider configuration](../../README.md#optional-features)

## Context

Every OpenAI-compatible vendor documents its base URL with the API version already in it
(OpenAI, OpenRouter, OVHcloud, Anthropic's compatibility layer), and some serve it below
a path (`/api/v1`, `/v1beta/openai`). A server that appends its own version turns the
copied value into `/v1/v1`. That shows up only as a 404 behind a generic failure on the
first model call. This concerns the OpenAI-compatible provider; the Ollama and Anthropic
providers take a bare host, as those vendors document it.

## Rejected

- **A bare host with `/v1` appended by the server, plus better documentation.** The
  server's rule stays opposed to every vendor's, so the copied value stays wrong, and
  vendors serving the API below a path need a "host" that is not a host.
- **A full request URL per operation.** Chat, model listing and embeddings would each
  need a variable, and no vendor documents its API that way.
- **Accepting both forms, appending `/v1` when the version is missing.** That makes two
  spellings of one setting, and an unversioned value stays ambiguous.
