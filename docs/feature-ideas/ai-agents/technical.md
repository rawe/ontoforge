# AI Agent Engine

> Unified agent engine for knowledge graph interaction — powering the default chat, per-ontology configured agents, and A2A protocol from a single implementation.

## Purpose

The AI runtime (see `ai-runtime.md`) currently has three hardcoded features (chat, query, extract) with fixed system prompts and tool allowlists. This works, but doesn't allow per-ontology customization — a medical ontology and a hiring pipeline ontology get the same generic prompt and the same tools.

The agent engine introduces a single internal abstraction that all AI interactions flow through. Agents are configured per ontology, each with its own identity, system prompt, and tool access. The existing `/ai/chat` endpoint becomes a hardcoded default agent using the same engine. Every agent — default or configured — exposes the same interfaces: REST chat, A2A agent card, and A2A task endpoint.

## Design Decisions

- **Single engine, multiple interfaces.** One code path builds and runs PydanticAI agents. REST chat and A2A both call the same engine. No separate implementations.
- **Default agent in code.** `/ai/chat` uses a hardcoded agent config (same behavior as today). No DB record needed. Exists so ontologies work out of the box without any agent setup.
- **Configured agents in Neo4j.** `AiAgentConfig` nodes linked to ontologies via `HAS_AI_AGENT` edges. Created and managed through the modeling API. Override the default behavior with custom prompts and tool access.
- **One skill per agent: knowledge.** Each agent is a knowledge expert for its ontology. We don't split chat/query/extract into separate skills — the model works best when focused on one domain, not juggling different task types.
- **Tool scoping per agent.** Agents configure which runtime tools they can use. `null` = all available, list = subset. Same pattern as ontology property scoping on `INCLUDES_TYPE` edges.
- **A2A per agent.** Every agent (including the default) exposes a Google A2A agent card and task endpoint. Any A2A-compatible orchestrator can discover and use OntoForge knowledge agents.

## Agent Engine

### AgentConfig

The engine operates on a single config dataclass. All agent resolution — whether from code defaults or DB records — produces this:

```python
@dataclass
class AgentConfig:
    key: str                        # unique identifier
    name: str                       # human-readable, used in A2A card
    description: str | None         # A2A card description; auto-generated from schema when None
    system_prompt: str | None       # injected into LLM; code default when None
    tools: list[str] | None         # None = all available tools, list = subset
```

### Resolution

```
/ai/chat                          → hardcoded DEFAULT_AGENT_CONFIG
/ai/agents/{agentKey}/chat        → AgentConfig loaded from AiAgentConfig node
```

Both paths produce an `AgentConfig`. The engine doesn't know or care where it came from.

### Default Agent

```python
DEFAULT_AGENT_CONFIG = AgentConfig(
    key="_default",
    name="Knowledge Assistant",
    description=None,       # auto-generated from schema at runtime
    system_prompt=None,     # uses _CHAT_SYSTEM_PROMPT from code
    tools=None,             # all available tools
)
```

This preserves current `/ai/chat` behavior exactly. No migration, no breaking change.

### Execution Flow

Given an `AgentConfig` + `SchemaCache`:

1. **System prompt** — use `config.system_prompt` if set, otherwise the code default. In both cases, append the schema description (from `_describe_schema()`).
2. **Tool selection** — intersect `config.tools` with the available tool set. `None` means no filtering. Tools that require optional features (e.g., `semantic_search` requires `EMBEDDING_PROVIDER`) are excluded automatically.
3. **Agent creation** — build a PydanticAI agent with the resolved prompt and tools (existing `_create_agent()` pattern).
4. **Run** — execute with message + history + deps, return result.

## Available Tools

The full set of tools an agent can access, defined in code:

| Tool | Description |
|------|-------------|
| `get_schema` | Read the ontology schema |
| `list_entities` | List/filter/search entities of a type |
| `get_entity` | Get a single entity by ID |
| `list_relations` | List relations of a type |
| `get_neighbors` | Explore an entity's connections |
| `semantic_search` | Vector similarity search (requires `EMBEDDING_PROVIDER`) |
| `execute_cypher_query` | Run read-only Cypher queries |

An agent's `tools` field selects from this set. Invalid tool names are rejected at creation time (PUT validation). The same strict validation applies on import — if an imported agent config references an unknown tool name, the import is rejected. No lenient or warning mode. The tool registry is the source of truth for what's available.

## Storage

### AiAgentConfig Node

```
(:Ontology)-[:HAS_AI_AGENT]->(:AiAgentConfig {
    agentConfigId: UUID,
    key: String,                 # unique within ontology, pattern: ^[a-z][a-z0-9_-]*$
    name: String,
    description: String | null,
    systemPrompt: String | null,
    tools: List<String> | null,  # Neo4j native string list
    createdAt: DateTime,
    updatedAt: DateTime
})
```

**Constraints:**

- `agentConfigId` globally unique (Neo4j constraint)
- `key` unique within its parent ontology (service-layer enforcement, same as property key uniqueness)

**Cascading deletes:** Deleting an ontology removes its `HAS_AI_AGENT` edges and `AiAgentConfig` nodes.

### Export Format

Extension to the existing JSON transfer format:

```json
{
  "formatVersion": "2.1",
  "entityTypes": [],
  "relationTypes": [],
  "ontologies": [
    {
      "key": "academic_papers",
      "name": "Academic Papers",
      "description": "...",
      "includes": null,
      "aiAgents": [
        {
          "key": "research-assistant",
          "name": "Research Assistant",
          "description": "Ask questions about researchers and their publications",
          "systemPrompt": "You are a research librarian...",
          "tools": null
        }
      ]
    }
  ]
}
```

`aiAgents` is optional. Omitted or empty means no configured agents (the default agent still works).

## Endpoints

### Agent Management (Modeling API)

Base: `/api/model/ontologies/{ontologyKey}/ai-agents`

| Method | Path | Description |
|--------|------|-------------|
| `GET` | `/ai-agents` | List agent configs for this ontology |
| `PUT` | `/ai-agents/{agentKey}` | Create or update agent config |
| `DELETE` | `/ai-agents/{agentKey}` | Delete agent config |

PUT uses upsert semantics — create if new, update if exists. This avoids separate POST/PATCH flows for a simple config resource. Returns **201** on create, **200** on update.

Note: all modeling agent management routes use `ontologyKey` (the snake_case key, not UUID) as the path parameter. This is the consistent pattern for agent-related endpoints.

**PUT request body:**
```json
{
  "name": "Research Assistant",
  "description": "Ask questions about researchers and their publications",
  "systemPrompt": "You are a research librarian specializing in academic publications...",
  "tools": ["list_entities", "get_entity", "execute_cypher_query"]
}
```

Only `name` is required. All other fields are optional — omitted fields use defaults.

### Agent Interaction (Runtime API)

**Default agent (hardcoded):**

| Method | Path | Description |
|--------|------|-------------|
| `POST` | `/api/runtime/{ontologyKey}/ai/chat` | Chat with default agent |
| `GET` | `/api/runtime/{ontologyKey}/ai/.well-known/agent.json` | Default agent card |
| `POST` | `/api/runtime/{ontologyKey}/ai/a2a` | Default agent A2A task endpoint |

**Configured agents:**

| Method | Path | Description |
|--------|------|-------------|
| `POST` | `/api/runtime/{ontologyKey}/ai/agents/{agentKey}/chat` | Chat with configured agent |
| `GET` | `/api/runtime/{ontologyKey}/ai/agents/{agentKey}/.well-known/agent.json` | Agent card |
| `POST` | `/api/runtime/{ontologyKey}/ai/agents/{agentKey}/a2a` | A2A task endpoint |

**Agent discovery:**

| Method | Path | Description |
|--------|------|-------------|
| `GET` | `/api/runtime/{ontologyKey}/ai/agents` | List all agents (default + configured) with their cards |

### Chat Request/Response

Same format for both default and configured agents — identical to today's `/ai/chat`:

**Request:**
```json
{
  "message": "How many researchers are at MIT?",
  "history": [],
  "includeToolCalls": false
}
```

**Response:**
```json
{
  "reply": "There are 42 researchers at MIT.",
  "toolCalls": [...]
}
```

## A2A Protocol

### Agent Card

Generated from `AgentConfig` + `SchemaCache`. When `description` is null, auto-generated from the ontology name and schema types. The `url` field is resolved using the `PUBLIC_URL` config variable; when not set, the base URL is derived from the request's `Host` header (see Configuration section).

```json
{
  "name": "Research Assistant",
  "description": "Ask questions about researchers, papers, and institutions in the academic_papers knowledge graph.",
  "url": "https://example.com/api/runtime/academic_papers/ai/agents/research-assistant/a2a",
  "version": "1.0",
  "capabilities": {
    "streaming": false,
    "pushNotifications": false
  },
  "defaultInputModes": ["text/plain"],
  "defaultOutputModes": ["text/plain", "application/json"],
  "skills": [
    {
      "id": "knowledge",
      "name": "Knowledge Query",
      "description": "Answer questions about researchers, papers, and institutions",
      "inputModes": ["text/plain"],
      "outputModes": ["text/plain", "application/json"]
    }
  ]
}
```

The skill description follows the same fallback: use `config.description` if set, otherwise auto-generate from schema entity/relation types.

### A2A Task Flow

Synchronous request/response (no streaming, no long-running tasks):

1. Client sends a `tasks/send` JSON-RPC request with a text message.
2. Server resolves the agent config (default or by key).
3. Server runs the message through the agent engine (same as chat).
4. Server returns a completed task with `TextPart` (the reply) and optionally `DataPart` (structured results).

Multi-turn: the A2A task ID is stateless — the client includes conversation history in subsequent messages, same as the REST chat endpoint.

## Impact on Existing Endpoints

| Endpoint | Change |
|----------|--------|
| `POST /ai/chat` | **No change** — uses hardcoded default agent via the new engine. Same behavior, refactored internals. |
| `POST /ai/query` | Unchanged for now. Future: could become an agent capability. |
| `POST /ai/extract` | Unchanged for now. Future: could become an agent capability. |
| `GET /runtime/features` | Unchanged. `"ai": true` still indicates AI availability. |

## MCP Tools (Modeling MCP)

Agent management is exposed through the modeling MCP server, following the same pattern as existing ontology and type management tools. All tools operate on the ontology resolved from the MCP connection URL.

| Tool | Description |
|------|-------------|
| `list_ai_agents` | List all configured AI agents for this ontology |
| `set_ai_agent` | Create or update an AI agent config (upsert by key) |
| `delete_ai_agent` | Delete an AI agent config by key |

`set_ai_agent` uses upsert semantics (matching the REST PUT), so the LLM doesn't need to check whether the agent exists before configuring it.

**Example interaction:**

```
LLM: set_ai_agent(
    key="research-assistant",
    name="Research Assistant",
    description="Ask questions about researchers and their publications",
    system_prompt="You are a research librarian specializing in academic publications...",
    tools=["list_entities", "get_entity", "execute_cypher_query"]
)

→ { "key": "research-assistant", "name": "Research Assistant", ... }
```

These tools call the same service-layer functions as the REST endpoints and MCP agent management routes. After any mutation, the runtime schema cache is invalidated (same pattern as other modeling MCP tools).

## Implementation Modules

| Module | Responsibility |
|--------|---------------|
| `core/ai.py` | Agent engine: `AgentConfig` dataclass, execution logic, tool selection, A2A card generation. Existing `get_ai_model()` stays here. |
| `runtime/ai_service.py` | Resolves agent key to `AgentConfig` (default or from cache), calls engine. Existing chat/query/extract features refactored to use the engine internally. |
| `runtime/ai_router.py` | Agent-scoped routes: default chat, configured agent chat, A2A endpoints, agent cards, agent listing. Split from `router.py` to keep routing organized. |
| `runtime/schemas.py` | Agent chat request/response models (reuses existing `AiChatRequest`/`AiChatResponse`). A2A request/response models. |
| `modeling/repository.py` | `AiAgentConfig` Neo4j CRUD — create, read, update, delete, list by ontology. |
| `modeling/service.py` | Agent config validation: key format, tool allowlist against available tools, name required. |
| `modeling/router.py` | Agent management routes under `/api/model/ontologies/{key}/ai-agents`. |
| `modeling/schemas.py` | Agent config request/response Pydantic models. |
| `core/schemas.py` | Export format extension: `ExportAiAgent` model, added to `ExportOntology`. |
| `mcp/modeling.py` | MCP tools for agent management: `list_ai_agents`, `set_ai_agent`, `delete_ai_agent`. Follows existing tool patterns. |

## Configuration

| Variable | Required | Description |
|----------|----------|-------------|
| `PUBLIC_URL` | No | Base URL used in A2A agent card `url` fields (e.g., `https://example.com`). When not set, the server derives the base URL from the incoming request's `Host` header. Set this in production when the server is behind a reverse proxy or load balancer where the `Host` header may not reflect the public-facing URL. |

## Feature Flag

Controlled by `AI_PROVIDER` env var (unchanged). When unset:

- Agent management endpoints (modeling API) work — you can configure agents regardless.
- Agent chat and A2A task endpoints return `FEATURE_DISABLED` error.
- Agent cards are still served — useful for discovery even when the AI backend is offline.
