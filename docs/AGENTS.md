# Documentation Principles

These continue the two principles in the root [AGENTS.md](../AGENTS.md) — *consistency
first* and *single source of truth* — which apply everywhere. The ones below apply to
writing under `docs/`, and keep their original numbering.

For the practical steps to add, update or move documentation, use
[Writing and updating documentation](workflows/documenting.md).

3. **Progressive disclosure.** Layer documents from overview to detail. Overviews introduce
   the essential ideas and link to the detailed home; give readers enough context to
   understand a page without following every link.
4. **One home per fact.** Each kind of information has its home:
   - **Essential architectural constraints:** [architecture-constraints.md](architecture-constraints.md).
   - **System structure, mechanisms and flows:** [architecture.md](architecture.md).
   - **Feature behavior, rules, limits and examples:** its document in [capabilities/](capabilities/).
   - **Interface behavior and access:** [interfaces/](interfaces/README.md); the web client in
     [product-surface.md](product-surface.md).
   - **Storage contract and implementation:** [storage-adapters/](storage-adapters/README.md).
   - **Contributor details tied to the implementation:** [implementation/](implementation/).
   - **Configuration variables and defaults:** the configuration table in the root
     [README.md](../README.md); procedures in [workflows/](workflows/).
   - **Terms:** the [glossary](glossary.md).
   - **The alternatives weighed for a decision:** its ADR in [adr/](adr/).

   Elsewhere, name the concept and link to its home; do not restate its details.
5. **Write at the right level.** Architecture explains system boundaries, responsibilities,
   invariants and important flows, without depending on or linking to source code. Capability
   documents describe what a feature does and its important rules, not a tour of its classes
   or functions. Implementation-focused guides may reference code when it helps their
   readers; prefer durable semantic anchors over line numbers. Source code may refer to
   documentation that explains a rule or design. Use examples when they clarify behavior.
6. **Link for a reader's purpose.** A documentation map may link to any destination. An
   overview may link to a deeper page for further reading without making its own explanation
   depend on that page. A capability may link to a related capability where their behavior
   interacts, and to its interface or UI documentation. Interface and product documentation
   link to the capability that owns the behavior. Link to the specific useful section, avoid
   repeating the same link throughout a passage, and do not force a reader to follow a chain
   of links to understand the basic point.
7. **Status quo only.** `docs/` describes the system as it is. No plans, no unbuilt ideas, no
   history, no dates, no migration notes — git holds history. A rule may carry a brief
   reason; the alternatives weighed for a decision live only in its ADR, which the owning
   document links ([recording decisions](workflows/recording-decisions.md)).
8. **Ontology-storage-neutral above the adapter.** Only `storage-adapters/` describes how a backend stores ontologies. Every other document describes behavior that holds for any ontology storage adapter. A rule or ADR that is about the ontology storage choice names it.
