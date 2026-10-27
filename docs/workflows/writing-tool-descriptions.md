# Writing tool descriptions

Use this guide when adding or changing an MCP or agent tool. A description is part of
the interface a model uses to choose and call that tool; it is not an implementation
note. The operation's behavior belongs in its [capability](../capabilities/), and the
available tools are indexed in [Interfaces](../interfaces.md#mcp).

## Write for the tool the caller can see

State what the call accepts, what it returns and how it behaves, including important
constraints, refusals and side effects. Include every rule needed to use its parameters;
never defer one to another tool. Tools are loaded and enabled individually, so a
description that relies on another tool becomes incomplete when that tool is absent.
Another tool may be named as a next step, provided it is available on that surface.

For example, a tool accepting `filters` must describe its own supported keys and
operators, rather than saying "same filters as list_entities". The shared
[`filterRules` helper](../../server/src/runtime/readHelpers.ts) composes the applicable
rules into each description, so source text can be shared without requiring the caller
to read a different tool. Select the options for that surface: search does not accept
substring filters, and relation lists do not accept query paths.

Keep caller-facing facts only. Backend, storage and ranking implementation details do
not help a caller use the tool; explain observable results instead. A rejection message
already explains what to do about the rejected call, so do not reproduce internal
diagnostic procedures in the description.

## Stay within the description budget

Keep each description at most **2,000 characters**, including descriptions assembled
from shared text and ruleset-specific additions. Clients can cut longer descriptions
without notice; text after the cut is unavailable to the caller. Meet the budget by
tightening wording, never by moving parameter rules into another tool's description.

The [description tests](../../server/tests/mcp/tool-descriptions.test.ts) check this
budget on the listed modeling and runtime MCP tools, ruleset variants, and built-in
agent tools. They also check self-containment, filter rules and descriptions affected by
write access. The policy applies to new descriptions as well as the variants covered by
those tests.

## Check the resulting surface

1. Inspect the complete description and parameter schema together, including any shared
   fragments. Verify that the wording matches the actual accepted input and result.
2. Check each affected tool set. A ruleset can remove tools or require staged writes;
   its descriptions must not direct a caller to a tool that set does not list.
3. Run the focused checks from `server/`:

   ```bash
   npm test -- tests/mcp/tool-descriptions.test.ts tests/mcp/search-tool.test.ts
   ```

4. Review the text as a caller seeing only that tool. Automated checks cover length and
   selected known omissions; they do not prove that every parameter rule is explained.

The description definitions live in the [modeling MCP server](../../server/src/mcp/modeling.ts),
[runtime MCP server](../../server/src/mcp/runtime.ts) and
[agent runtime's `buildTools`](../../server/src/runtime/assistants/agents/runtime.ts).
