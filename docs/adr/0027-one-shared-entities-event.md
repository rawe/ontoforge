# One shared entities event for every assistant kind

Current behavior: [Entities met by a turn](../capabilities/threads.md#the-entities-a-turn-met)

## Context

Agents, retrievers and navigators all meet real entities while answering, and the client
lets a person open them, see them cited and add them to the Explorer. The kinds differ in
everything else: an agent runs tools, a retriever plans and searches, a navigator walks
the graph.

## Rejected

- **An entities event per kind (`navigator.entities`, `agent.entities`, …).** Every
  client surface would need a reader per kind for the same cards, and a new kind would
  need its own consumers.
- **Entity cards inside the agent's tool results.** It would tie the tool events, which
  carry any tool's native result, to one presentation; a tool that returns no entities
  would still be read for them.
- **A common relevance or provenance model on the card.** The kinds mean different
  things by an entity being met; what is truly shared is its identity, its label and
  whether it reached the answer model.
