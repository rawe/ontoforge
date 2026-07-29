# Session 11 — AI runtime (LangGraph), A2A, final parity sweep

**Goal:** the language-model capabilities — ask, extract, chat, agent listing, A2A cards
and tasks — built on **LangChain.js / LangGraph.js** (user preference, replacing Python's
`pydantic-ai`), plus the migration's closing parity sweep.

**Prerequisites:** 01–10. Integration tests need an LLM provider (Ollama, as the Python
integration suite uses).

**Normative:** `docs/capabilities/ai-agents.md` (entire document — the three operations,
agent rules, tool-call trace, stateless history, A2A card and task semantics),
`docs/interfaces.md` (AI + A2A route tables; the deliberate gap: **no MCP tools for
ask/extract/chat**), `docs/capabilities/oql.md#self-correction-hints` (why tool errors
feed back to the model).

**Reference (Python):** `runtime/ai_service.py` (prompts, tool wiring, extraction
schema, A2A task handling — port prompt text verbatim), `runtime/ai_router.py` (routes,
card building, JSON-RPC envelope), `core/ai.py` (provider init: `ollama` and `openai`,
both via OpenAI-compatible endpoints), `runtime/tool_names.py`,
`backend/tests/runtime/test_ai_agents.py`, `tests/integration/test_ai.py`.

## Scope

**In:**
- **Provider:** `AI_PROVIDER`/`AI_MODEL`/`AI_BASE_URL`/`AI_API_KEY` → a `ChatOpenAI`
  instance (`@langchain/openai`) with a custom `baseURL` (`{base}/v1` for ollama, key
  required for openai). Initialized at startup; absent → `/features` reports
  `ai: false` and every model-running route answers `422 VALIDATION_ERROR` with
  `details.code: "FEATURE_DISABLED"` — **approved divergence #2** (Python omits the
  details code). Listing agents and serving cards still work without a provider.
- **Agent tool layer:** the ten grantable tools as LangChain tools invoking the runtime
  services directly (same functions the MCP server uses — no HTTP hop). Effective
  toolset = allowlist ∩ available (embedding-dependent tools dropped without a
  provider, for the default agent and explicit allowlists alike). Tool failures that
  are not-found or validation errors return the error message as the tool result (the
  model self-corrects); other errors abort the run. Schema description is in the system
  prompt always — custom prompt gets it appended, no prompt gets the built-in one
  (port both prompt texts).
- **`POST /ai/query`:** LangGraph agent with exactly one tool (OQL execution); response
  carries answer + generated OQL + raw rows, both absent when the tool was never called.
- **`POST /ai/extract`:** no tools; structured output shaped to the lens schema
  (`withStructuredOutput` or equivalent — match the Python response shape exactly);
  optional entity-type hint list (prompt hint, not enforced); propose-then-persist —
  persistence opt-in per call, entities first, then relations resolved via `match` maps
  **only against entities created in the same call**, unresolvable relations silently
  dropped, no dedup, response states whether it wrote.
- **`POST /ai/chat`** and **`POST /ai/agents/{agentKey}/chat`:** LangGraph ReAct-style
  loop over the agent's toolset; stateless history (caller-supplied user/assistant
  turns, text only); opt-in tool-call trace (ordered tool names + arguments, no
  results).
- **`GET /ai/agents`:** the implicit default agent (`_default`-keyed, undeletable,
  unrestricted) listed alongside configured ones.
- **A2A:** cards at `/ai/.well-known/agent.json` and per-agent; generated description
  when none (naming the lens and its type keys); absolute task URL from `PUBLIC_URL`
  else forwarded proto/host headers; capability flags false; exactly one chat skill.
  Task endpoints: JSON-RPC 2.0, single supported method (copy the method name from
  `ai_router.py`); other methods → JSON-RPC method-not-found; text parts concatenated,
  no text → invalid-params; reply echoes/generates the task id, status completed, one
  text artifact. Non-streaming, no conversation.
- **Deliberate gap preserved:** no MCP tools for ask/extract/chat.
- **Final parity sweep (closes the migration):** full frontend walkthrough against the
  TS server on port 8000; run every integration suite; diff `/openapi.json` route
  inventory against the Python server's (shapes may differ in schema-name cosmetics;
  routes, methods, parameters must match); confirm every MCP tool name/count (27 + 20)
  against `docs/interfaces.md`. Report findings; **retiring `backend/` is a separate
  user decision — do not delete anything.**

## Test plan

Port `backend/tests/runtime/test_ai_agents.py`, `test_ai_agents.py` (modeling parts
already in 09), `tests/integration/test_ai.py`:

- **Unit (mock the model):** toolset computation (allowlist ∩ availability, default
  agent); prompt assembly (custom + appended schema vs built-in); tool-error feedback
  loop vs abort; query response with and without a tool call; extract persist rules
  (same-call matching, silent drop, no dedup); trace shape; history mapping;
  FEATURE_DISABLED without provider; card URL derivation (PUBLIC_URL, forwarded
  headers, fallback); JSON-RPC error cases.
- **Integration (Ollama):** ask a question over seeded data (assert OQL present and
  rows non-empty); extract from a fixture text (proposals shaped to schema); chat with
  a restricted agent (trace shows only allowlisted tools); A2A task round-trip against
  the default and a named agent.

## Definition of done

Frontend AI surfaces (chat, ask, extract review) fully functional against the TS server;
parity sweep findings reported to the user; overview table complete. The migration is
code-complete pending the user's decision on retiring `backend/`.
