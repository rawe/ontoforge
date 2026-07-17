# AI Agent Engine — UI Concept

> **Note:** This document describes the legacy UI, which now lives in `frontend-legacy/`. The current frontend (`frontend/`, UI v3) implements agent management in Studio and agent chat in the Workbench AI page — see `docs/runtime-ui-architecture.md`. Kept for historical reference.

> Modeling UI for agent management and runtime UI for agent chat, built on the existing frontend patterns.

## Context

The AI agent engine (see `technical.md`) introduces per-ontology agent configuration and agent-scoped chat. This document covers the frontend changes needed to support both sides: managing agents in the modeling UI and chatting with agents in the runtime UI.

**Frontend stack:** React 19, TypeScript, Vite, Tailwind CSS 4, TanStack Query, React Router 7, Radix UI (dialogs), Sonner (toasts), react-markdown. No component library (MUI, etc.) — the app uses plain HTML elements styled with Tailwind utility classes.

**Existing patterns:**
- API layer: thin client modules (`api/client.ts`, `api/runtimeClient.ts`) wrapping `fetch` calls, returning typed responses.
- State: TanStack Query for server state, React context for cross-page ephemeral state (e.g., `useAiState` for chat history).
- Forms: controlled components with local `useState`, pattern validation on key fields, `onSubmit`/`onCancel` callback props.
- Layout: sidebar tree with per-ontology sections (Scope, Data, AI), breadcrumb header, full-height main area.

## Modeling UI — Agent Management

### Placement

Agent configuration lives on the **OntologyDetailPage** (`/ontologies/:ontologyId`). This page already handles ontology metadata editing, scope management (included entity types, relation types), and validation. Agents are another facet of ontology configuration, so they belong here.

Add a new section below the existing "Included Relation Types" section:

```
[Ontology header — name, key, scoped/unscoped badge, Edit button]
[Validate / Data buttons]
[Validation results if any]
[Unscoped info banner if applicable]
[Included Entity Types section]
[Included Relation Types section]
[AI Agents section]           <-- new
```

The section is always visible, regardless of whether AI features are enabled. Agent configs can be created and managed even when `AI_PROVIDER` is unset — they just can't be used for chat until the AI backend is available. This matches the technical spec: "Agent management endpoints (modeling API) work — you can configure agents regardless."

### Agent List

The AI Agents section header follows the same style as "Included Entity Types" and "Included Relation Types":

```
AI Agents
---------
[AgentCard: research-assistant]     Research Assistant     research-assistant     3 tools       [Edit] [Delete]
[AgentCard: data-explorer]          Data Explorer          data-explorer          all tools     [Edit] [Delete]

[+ Add agent] button
```

When no agents are configured:

```
AI Agents
---------
No agents configured. The default assistant is always available.

[+ Add agent] button
```

**AgentCard** is a compact row (same visual density as `InclusionCard` in scope management):
- Agent name (bold), key (monospace, gray), tool count badge ("all tools" or "N tools")
- Edit and Delete action buttons on the right
- No expand/collapse — clicking Edit opens the form inline or in a modal

**Delete** shows a `ConfirmDialog` (existing Radix-based dialog component) before calling the API.

### Agent Form

Triggered by "Add agent" or "Edit" on an existing agent. Two options for placement:

**Option A — Inline form** (preferred, matches `OntologyForm` pattern): replaces the "Add agent" button area with a form. Simpler, no modal management. Edit replaces the card with the form.

**Option B — Modal form**: opens in a `Modal` component (already exists in the codebase). Better if the form is tall and would push content down.

Recommendation: **Option A** for create, **Option A** for edit (replace the card row with the form). The form is not that tall — five fields.

#### Form Fields

```
Key           [____________]     monospace input, pattern ^[a-z][a-z0-9_-]*$
                                 required, disabled in edit mode (immutable)

Name          [____________]     text input, required

Description   [____________]     textarea, 2 rows, optional
              [____________]

System Prompt [____________]     textarea, 6-8 rows, optional, monospace
              [____________]     placeholder: "Leave blank for default prompt"
              [____________]
              [____________]

Tools         ( ) All tools (default)
              ( ) Select specific tools:
                  [ ] get_schema
                  [ ] list_entities
                  [ ] get_entity
                  [ ] list_relations
                  [ ] get_neighbors
                  [ ] semantic_search
                  [ ] execute_cypher_query

              [Save]  [Cancel]
```

**Key field behavior:**
- Manual input (not auto-generated from name). The key pattern allows hyphens (`^[a-z][a-z0-9_-]*$`), unlike ontology/entity type keys which only allow underscores.
- Disabled (grayed out) in edit mode — the key is immutable after creation. Show it as read-only text in the form header.

**System prompt:**
- Plain `<textarea>` with monospace font (`font-mono` class). No code editor — KISS. The prompt is just text, not code.
- Placeholder text explains the default behavior: "Leave blank to use the default system prompt."
- 6-8 rows to give enough editing space without scrolling for typical prompts.

**Tool selection:**
- Radio group at the top: "All tools (default)" vs "Select specific tools."
- When "All tools" is selected, the checkbox list is hidden. The `tools` field is sent as `null`.
- When "Select specific tools" is selected, show the checkbox list. At least one tool must be selected for the form to submit.
- The tool list is hardcoded in the frontend (matching `technical.md` section "Available Tools"). No API call needed — the tool registry is static. If a tool requires an optional feature (like `semantic_search` requiring `EMBEDDING_PROVIDER`), still show it in the list but mark it with a note — the backend handles availability at runtime.

#### Form Component

New file: `components/forms/AiAgentForm.tsx`

Props:
```typescript
interface AiAgentFormProps {
  initial?: {
    key: string;
    name: string;
    description: string;
    systemPrompt: string;
    tools: string[] | null;
  };
  onSubmit: (data: AiAgentFormData) => void;
  onCancel: () => void;
}

interface AiAgentFormData {
  key: string;
  name: string;
  description?: string;
  systemPrompt?: string;
  tools: string[] | null;
}
```

Follows the same pattern as `EntityTypeForm` and `OntologyForm`: controlled state, submit/cancel callbacks, no internal API calls.

### API Client Additions

Add to `api/client.ts` (modeling client, base `/api/model`):

```typescript
// AI Agent Configs
export interface AiAgentConfig {
  key: string;
  name: string;
  description: string | null;
  systemPrompt: string | null;
  tools: string[] | null;
  createdAt: string;
  updatedAt: string;
}

export const listAiAgents = (ontologyKey: string) =>
  request<AiAgentConfig[]>(`/ontologies/${ontologyKey}/ai-agents`);

export const upsertAiAgent = (ontologyKey: string, agentKey: string, data: { ... }) =>
  request<AiAgentConfig>(`/ontologies/${ontologyKey}/ai-agents/${agentKey}`, {
    method: 'PUT',
    body: JSON.stringify(data),
  });

export const deleteAiAgent = (ontologyKey: string, agentKey: string) =>
  request<void>(`/ontologies/${ontologyKey}/ai-agents/${agentKey}`, {
    method: 'DELETE',
  });
```

Note: the modeling API uses the ontology key in the path (`/api/model/ontologies/{ontologyKey}/ai-agents`), matching the endpoint spec. The `OntologyDetailPage` currently uses `ontologyId` (UUID) for other calls but has the ontology object with its `key` field available.

### TanStack Query Integration

On the OntologyDetailPage, add a query for the agent list:

```typescript
const { data: agents = [], refetch: refetchAgents } = useQuery({
  queryKey: ['ontology', ontologyKey, 'ai-agents'],
  queryFn: () => api.listAiAgents(ontologyKey),
  enabled: !!ontologyKey,
});
```

Mutations (upsert, delete) call `refetchAgents()` on success, same pattern as scope management. Also invalidate the runtime schema cache query key if agents affect it.

## Runtime UI — Agent Chat

### Placement

The existing AI chat lives at `/data/:ontologyKey/ai/chat` and appears in the sidebar under the "AI" section for each ontology. The agent chat extends this — it does not replace it.

**URL structure:**

| Route | Description |
|-------|-------------|
| `/data/:ontologyKey/ai/chat` | Existing chat page, now with agent selector |

No separate routes per agent. The agent selector is part of the chat page. This avoids route proliferation and keeps the sidebar simple.

### Sidebar Changes

The sidebar AI section currently shows three links: Query, Extract, Chat. No changes needed — the Chat link still goes to `/data/:ontologyKey/ai/chat`. Agent selection happens inside the chat page, not via navigation.

### Agent Selection

At the top of the AiChatPage, above the chat messages, add an agent selector:

```
AI Chat
-------
Agent: [v Default Assistant           ]    <-- dropdown/select

[chat messages area]

[input area]
```

The dropdown lists:
1. "Default Assistant" — always first, maps to the default agent (`/ai/chat` endpoint)
2. Configured agents — fetched from the runtime agent listing endpoint, sorted by name

**API call for the list:** `GET /api/runtime/{ontologyKey}/ai/agents` (runtime endpoint, returns all agents including the default). This is a runtime call, not modeling, because the chat page is a runtime view.

Add to `api/runtimeClient.ts`:

```typescript
export interface AgentInfo {
  key: string;
  name: string;
  description: string | null;
}

export const listAgents = (ontologyKey: string) =>
  request<AgentInfo[]>(`/${ontologyKey}/ai/agents`);

export const aiAgentChat = (
  ontologyKey: string,
  agentKey: string,
  message: string,
  history?: AiChatMessage[],
  includeToolCalls?: boolean,
) =>
  request<AiChatResponse>(`/${ontologyKey}/ai/agents/${agentKey}/chat`, {
    method: 'POST',
    body: JSON.stringify({ message, history, includeToolCalls }),
  });
```

**Selection behavior:**
- Changing the agent clears the conversation (messages and tool call state). Different agents have different personalities and tool access — continuing a conversation across agents would be confusing.
- The selected agent key is stored in the `AiStateProvider` context alongside the existing chat state, so it persists when navigating away and back.
- Default value: `_default` (the hardcoded default agent key).

### Chat Interface Changes

The existing `AiChat` component handles messages, tool calls, input, and the "New conversation" button. Changes needed:

1. **Accept an `agentKey` prop** (in addition to `ontologyKey`). When `agentKey` is `_default`, call `aiChat()` (existing endpoint). When it's a configured agent key, call `aiAgentChat()`.

2. **Agent identity in header.** Show the agent name and description (if any) below the page title and above the message area. This gives context about which agent the user is talking to.

```
AI Chat
-------
Agent: [v Research Assistant          ]
"Ask questions about researchers and their publications"    <-- description, italic, gray

[chat messages]
```

3. **No other changes to the chat UI.** The message display, tool call toggle, input form, and "New conversation" button all work the same regardless of which agent is selected. The request/response format is identical.

### State Management

Extend the `ChatState` in `useAiState.tsx`:

```typescript
export interface ChatState {
  agentKey: string;       // new — '_default' or a configured agent key
  messages: ChatEntry[];
  input: string;
  showToolCalls: boolean;
}
```

Default value for `agentKey`: `'_default'`.

When the agent selector changes:
1. Set `agentKey` to the new value.
2. Reset `messages` to `[]`.
3. Keep `input` and `showToolCalls` as-is.

### Message Display

No visual changes needed. User messages, assistant replies, and tool calls are already well-differentiated:

- **User messages:** right-aligned, purple background, white text
- **Assistant messages:** left-aligned, gray background, rendered as Markdown
- **Tool calls:** collapsible section below assistant messages, showing tool name and JSON args

This works for all agents — the agent identity is shown in the header, not repeated per message.

### Empty State

When the chat area is empty (no messages), show a contextual prompt based on the selected agent:

- Default agent: "Start a conversation about your data..." (current text)
- Configured agent: "Start a conversation with {agent name}..." with the agent description below if available

## Component Summary

### New Files

| File | Purpose |
|------|---------|
| `components/forms/AiAgentForm.tsx` | Create/edit form for agent configs |

### Modified Files

| File | Change |
|------|--------|
| `api/client.ts` | Add `listAiAgents`, `upsertAiAgent`, `deleteAiAgent` |
| `api/runtimeClient.ts` | Add `listAgents`, `aiAgentChat` |
| `types/models.ts` | Add `AiAgentConfig` interface |
| `types/runtime.ts` | Add `AgentInfo` interface |
| `pages/OntologyDetailPage.tsx` | Add AI Agents section with list, form, delete |
| `pages/AiChatPage.tsx` | Add agent selector dropdown, pass `agentKey` to `AiChat` |
| `components/ai/AiChat.tsx` | Accept `agentKey` prop, route chat calls to correct endpoint |
| `hooks/useAiState.tsx` | Add `agentKey` to `ChatState` |

### No Changes

| File | Reason |
|------|--------|
| `main.tsx` (routes) | No new routes — agent selection is within the existing chat page |
| `components/Sidebar.tsx` | No new sidebar items — agent selection is inside the chat page |
| `components/ai/AiQuery.tsx` | Query endpoint unchanged |
| `components/ai/AiExtract.tsx` | Extract endpoint unchanged |

## API Endpoint Mapping

### Modeling (OntologyDetailPage)

| UI Action | Endpoint | Client Function |
|-----------|----------|-----------------|
| Load agent list | `GET /api/model/ontologies/{key}/ai-agents` | `listAiAgents` |
| Create agent | `PUT /api/model/ontologies/{key}/ai-agents/{agentKey}` | `upsertAiAgent` |
| Update agent | `PUT /api/model/ontologies/{key}/ai-agents/{agentKey}` | `upsertAiAgent` |
| Delete agent | `DELETE /api/model/ontologies/{key}/ai-agents/{agentKey}` | `deleteAiAgent` |

### Runtime (AiChatPage)

| UI Action | Endpoint | Client Function |
|-----------|----------|-----------------|
| Load available agents | `GET /api/runtime/{key}/ai/agents` | `listAgents` |
| Chat with default agent | `POST /api/runtime/{key}/ai/chat` | `aiChat` (existing) |
| Chat with configured agent | `POST /api/runtime/{key}/ai/agents/{agentKey}/chat` | `aiAgentChat` |

## Notes

- **No streaming.** The technical spec explicitly states no streaming. The chat UI sends a request and waits for the full response, showing a loading indicator (existing animated dots pattern).
- **No server-side history.** Conversation state is client-side only, matching the stateless server pattern. The `AiStateProvider` context holds messages in memory — they're lost on page refresh. This is fine for a testing/exploration UI.
- **A2A is backend-only.** The A2A agent card and task endpoints are for machine-to-machine use. No UI needed — they're discoverable via standard A2A protocol by external orchestrators.
- **Feature flag.** The agent management section on OntologyDetailPage is always shown. The agent chat on AiChatPage is gated by `features.ai` (same as today). If AI is disabled, the chat page shows the existing "AI features are not enabled" message.
