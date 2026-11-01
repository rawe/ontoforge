# Studio helper

The Studio helper is the Studio's built-in AI assistant: one per ontology, for the
ontology's administrators. It reads the ontology's design — schema, lenses, search
indices — never instance data, and changes nothing itself. Its work reaches the design
only through a person:

- **Answers** from the design.
- **Schema proposals** — additive steps (new types, properties, descriptions) the server
  checks without writing. The person reviews a proposal and applies it in the Studio,
  against the design revision it was checked on.
- **Draft fills** — with an agent editor or a custom search index editor open, it proposes
  values for that editor's unsaved draft. They fill the draft only when the person clicks
  Fill draft on the same editor at the same draft version; each filled part is marked
  until edited, can be undone, and only Save stores it. A search index proposal is
  checked as saving it would be.

Its conversations are [threads](threads.md) bound to the whole ontology and to the
person.
