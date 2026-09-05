# What this work is about

## The situation

OntoForge offers many ways to read data: list entities, read one entity, follow relations,
run a query, run a saved query, search by meaning. They were added one at a time. Nothing
in the system says which of them belong together, which one a caller should reach for, or
what they have in common.

Search shows the problem most clearly. There is search over entities, search inside
documents, and search over saved queries. Each has its own route, its own parameters and
its own defaults. One parameter, `searchIn`, mixes two unrelated things: what gets ranked,
and whether two rankings get combined. There is no way to ask for keyword search, or for a
combination of keyword and meaning, and no place in the current design where such an
option would fit.

The same read also looks different depending on which interface you use. The REST API, the
MCP server and our own agent tools each define their own parameter list by hand. They have
grown apart. Some parameters exist in one interface and not in another, and nothing says
whether that was intended.

## What we want at the end

### 1. An API that stays stable when needs grow

Adding a new need should mean adding one operation, or one parameter to an existing one.
It should not mean rearranging what is already there. That requires an order in the read
surface: a small number of groups, each with a clear job, so that a new requirement has an
obvious place to go.

The REST API is not called by an agent. Its job is to offer every capability the system
has, completely and without overlap. It does not have to be easy for a language model to
use.

### 2. Defined tool sets for our own agents

We build these agents and we choose which model runs them. The mechanism for giving an
agent a subset of tools already exists: each agent configuration lists the tools it may
use. What is missing is which subsets make sense — which tools belong together so that an
agent holding only that set can finish a whole task without needing something outside it.

We want a small number of named sets, matched to how capable the model is.

### 3. A decision about the external MCP server

This is a different problem. The caller is a coding agent we do not control, usually a
strong model. Today it gets every tool of the mount, always.

Two questions: which tools should it get, and do we need a way to control that per
connection — for example a named set the client selects when it connects.

## When we are done

- Every read operation belongs to a named group, and the group states its contract: does it
  page, does it rank, does it return a count.
- The three interfaces offer the same capabilities. Where they differ, a written rule says
  why.
- An agent can be configured with a set name instead of a hand-picked list of twelve tool
  names.
- We know whether the external MCP server needs tool selection, because we watched a real
  coding agent use it — not because we guessed.

## Not part of this work

- Write operations. This is about reading.
- Building keyword search. We may want it later. The job now is to leave a place for it,
  not to build it.
- Breaking anything the web client depends on. Renames and contract changes are collected
  and decided later, in one step.
