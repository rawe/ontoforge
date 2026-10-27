# Documentation Principles

These continue the two principles in the root [AGENTS.md](../AGENTS.md) — *consistency
first* and *single source of truth* — which apply everywhere. The ones below apply to
writing under `docs/`, and keep their original numbering.

For the practical steps to add, update or move documentation, use
[Writing and updating documentation](workflows/documenting.md).

3. **Progressive disclosure.** Give each topic one detailed home. Overviews introduce the
   essential ideas; capability documents explain observable behaviour, rules, limits and
   important failure cases; interface and product documents describe their respective
   surfaces. Give readers enough context to understand a page without following every link.
4. **When redundancy exists, maintain consistency.** A brief summary can help a reader
   understand an interaction without leaving the page; link to the detailed home rather
   than repeating its full explanation. If accounts diverge, flag and investigate them.
5. **Write at the right level.** [Architectural constraints](architecture-constraints.md)
   state the essential common obligations. Architecture explains system boundaries, responsibilities,
   invariants and important flows, without depending on or linking to source code. Capability
   documents describe what a feature does and its important rules, not a tour of its classes
   or functions. Implementation-focused guides may reference code when it helps their
   readers; prefer durable semantic anchors over line numbers. Source code may refer to
   documentation that explains a rule or design. Use examples when they clarify behaviour.
6. **Link for a reader's purpose.** A documentation map may link to any destination. An
   overview may link to a deeper page for further reading without making its own explanation
   depend on that page. A capability may link to a related capability where their behaviour
   interacts, and to its interface or UI documentation. Interface and product documentation
   link to the capability that owns the behaviour. Link to the specific useful section, avoid
   repeating the same link throughout a passage, and do not force a reader to follow a chain
   of links to understand the basic point.
7. **Describe the current system.** Product and architecture documentation describe what
   exists, not plans or migration history. Brief rationale belongs with the behaviour it
   explains; an ADR records the context and material trade-offs of a qualifying architectural
   decision ([recording decisions](workflows/recording-decisions.md)). Git holds history.
8. **Ontology-storage-neutral above the adapter.** Only `storage-adapters.md` describes how a backend stores ontologies. Every other document describes behaviour that holds for any ontology storage adapter. A rule or ADR that is about the ontology storage choice names it.
