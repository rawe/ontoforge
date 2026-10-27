# One streaming response contract for REST chat

Current behavior: [Assistant chat and threads](../interfaces.md#assistant-chat-and-threads)

## Context

A chat turn that withholds both the answer and the tool trace until it ends gives no
early visibility and hides the retrieved data. The web client is the only REST chat
client, so compatibility with a non-streaming format buys nothing.

## Rejected

- **An opt-in `stream` flag with two response modes, or separate streaming endpoints.**
  Either keeps two client/server contracts without a consumer that needs the second.
- **Token-streaming an agent's reply** (the agent kind; a retriever streams its answer). What an agent turn needs is visibility of its tool
  activity. Streaming its reply would change how the agent's model is invoked and expose
  framework events.
- **Continuing the turn in the background after a disconnect.** Reconnect, replay or
  automatic reruns would add state and risk duplicated work.
