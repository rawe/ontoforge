# 0021. One streaming response contract for REST chat

- **Status:** Accepted

## Context

The chat interface withheld both the answer and tool trace until an entire turn finished.
The trace omitted results. Users needed earlier visibility and inspectable retrieved data,
without incremental assistant prose or a new product surface. The frontend is the only
REST chat client, so compatibility with the old response format did not justify complexity.

## Deliberation

A streaming-only response on the existing routes was chosen over an opt-in `stream` flag
with dual response modes and over separate streaming endpoints. Both alternatives require
maintaining duplicate client/server contracts without a current consumer needing them.
NDJSON carries complete tool events and one terminal answer or error, without exposing
framework events or changing model invocation to token streaming.

Cancellation on disconnect was chosen over background continuation. Completed results remain
visible after failure because they can still be useful, while the turn is explicitly marked
incomplete. Reconnect, replay, and automatic reruns would add state and risk duplicated work.

Shared execution reports tool activity but still returns a complete answer. A2A therefore
keeps its existing response, and MCP keeps its own tools and plain-JSON transport. The
original MCP transport deliberation concerned MCP, not all internal services or REST clients.

## Rule

The accepted rule is in [decisions](../decisions.md#interfaces).
