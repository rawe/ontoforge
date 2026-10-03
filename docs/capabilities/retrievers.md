# Saved retrievers

A retriever is a lens-local search configuration: which kinds of records to return,
which text to compare, which exact or semantic conditions a question may activate,
and which evidence the answer may use. Saving a retriever stores this definition,
not graph data, vectors or a conversation.

Vocabulary and ownership: [../README.md](../README.md),
[ontology-lenses.md](ontology-lenses.md). Complete route index:
[../interfaces.md](../interfaces.md).

## Ownership and persistence

Each definition belongs to exactly one lens within one ontology. Its key is unique in
that lens, matches `^[a-z][a-z0-9_-]*$`, and is at most 64 characters. The definition
carries a name, optional description, `configVersion`, configuration, stable internal
identity and timestamps. Current writes accept configuration version 1.

Saving does not change the schema, instances, agents or saved queries. Deleting a lens
deletes its retrievers; other lenses and shared instance data survive. Deleting a
retriever removes its definition only. Retrievers are separate from tool-using agent
configurations and do not become A2A agents.

The configuration is checked against the owning lens when saved and again when prepared
or executed. It cannot widen the lens. Types, fields and relation paths must resolve
within the visible schema. A schema change can invalidate a stored definition without
deleting it: reads report validation errors; execution is refused until repaired.
Unsupported versions or malformed stored configurations remain readable and exportable,
without being silently converted or replaced with defaults.

## What a definition controls

An enabled result bucket selects an entity type. Shared search/ranking fields supply
that type's semantic text. Answer fields supply its factual evidence. A condition
selects an own field or a directed relation path: exact conditions compare actual target
values; semantic conditions contribute selected category texts. A configured condition
is permission for the question planner to use it, not a permanent filter value.

Exact conditions are enforced before semantic selection. The semantic threshold limits
candidates by text similarity; it is not a confidence measure or a guarantee of relevance.
The answer must substantiate recommendations from the supplied fields and relations.
Field and response-context limits can shorten evidence or omit technically selected
candidates; omitted candidates are not established additional recommendations.

A successful question has one planning-model call, deterministic retrieval, and one
response-model call. Semantic reranking compares text embeddings, without a third
language-model call. Preparation requires an embedding provider; chat requires a
language-model provider, and semantic retrieval also requires embeddings. Management,
copying and JSON transfer do not call models or prepare vectors.

## Saved execution and browser drafts

Named execution loads the definition from the server by lens and retriever key. Its
request cannot override the stored configuration. A browser draft instead sends an
explicit request configuration. These are separate execution modes.

The web UI retains the local browser draft. Selecting a stored profile does not upload
that draft. Editing a profile does not save it: the user must save or explicitly preview
the draft before running. Profile/configuration changes clear the dependent conversation.
Unknown stored shapes can be exported or explicitly reviewed as a version 1 draft repair;
saving the repair still requires validation and confirmation.

Conversation references are short-lived, scoped to ontology, lens and configuration.
Only complete, purely exact previous results can authorize an unambiguous “those” or
“this supplier” restriction. Semantic candidates are not verified recommendation IDs;
a follow-up based on them must repeat the topic and constraints.

## Copy, move and portable JSON

Copy and move address a target lens and key **in the same ontology**. The target lens
must expose every referenced type, field and path. Existing target keys are conflicts,
never overwritten. Copy creates an independent identity and retains the source. Move
preserves identity and atomically changes owner/key; failure retains the source. A
concurrent change of source configuration refuses the transfer rather than copying or
moving a different definition from the one validated.

Target-schema validation precedes the atomic storage transfer; concurrent schema or lens
changes are not locked out by that operation. A transfer can therefore become invalid
if the schema changes concurrently. Preparation and each execution validate the current
lens again.

Single-profile export carries key, name, description, config version and configuration;
no owner identity, timestamps, vectors or conversation. Import creates a new definition
in the addressed lens, validates it there, and refuses an existing key. This is the
portable route between ontologies. Whole-design transfer also nests retrievers beneath
their lenses; its separate rules are in [transfer.md](transfer.md).

## Configuration storage and vectors are separate

Preparing selected entity/category texts creates or reuses process-local vectors keyed
by provider, ontology/lens and text content. Changed text requires a corresponding
vector. A question can create missing vectors and question embeddings. Saving a profile
does neither. Server restart loses this cache and conversation references while saved
definitions remain in storage. Core instance embeddings are a separate search resource;
selected retriever texts do not simply reuse full-schema instance vectors.

## Interfaces

Definitions are managed through modeling REST. Saved preparation/chat run through runtime
REST. The existing request-configured retriever routes remain the draft surface. No
dedicated retriever MCP tools or A2A discovery/task routes are provided. Design export
and import through modeling MCP carry the same lens-local definitions as REST.
