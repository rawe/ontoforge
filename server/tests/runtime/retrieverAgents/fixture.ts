/**
 * A lens for retriever-agent unit tests: people working for companies and
 * living in cities, with the search catalog of its indices.
 */

import type { SchemaCacheValue } from "../../../src/runtime/schemaCache.js";
import type { SearchIndexCatalogEntry } from "../../../src/runtime/search/indexSearch.js";
import type { AgentLens } from "../../../src/runtime/retrieverAgents/config.js";

const property = (key: string, dataType = "string") => ({
  key,
  displayName: key[0]!.toUpperCase() + key.slice(1),
  description: null,
  dataType,
  required: false,
  defaultValue: null,
});
const type = (key: string, properties: ReturnType<typeof property>[]) => ({
  key,
  displayName: key[0]!.toUpperCase() + key.slice(1),
  description: null,
  nameProperty: "name",
  properties: Object.fromEntries(properties.map((p) => [p.key, p])),
});
const relation = (key: string, from: string, to: string) => ({
  key,
  displayName: key.replace("_", " "),
  description: null,
  fromEntityTypeKey: from,
  toEntityTypeKey: to,
  properties: { role: property("role") },
});

export const SCHEMA = {
  lensId: "lens-1",
  lensKey: "all",
  lensName: "All",
  lensDescription: null,
  entityTypes: {
    person: type("person", [property("name"), property("email"), property("bio", "document")]),
    company: type("company", [property("name")]),
    city: type("city", [property("name")]),
  },
  relationTypes: {
    works_for: relation("works_for", "person", "company"),
    lives_in: relation("lives_in", "person", "city"),
  },
} as unknown as SchemaCacheValue;

const entry = (
  key: string,
  entityType: string,
  relations: { relationType: string; direction: "outgoing" | "incoming"; label: string }[] = [],
  documentProperty: string | null = null,
): SearchIndexCatalogEntry => ({
  key,
  kind: key.includes("~") ? (documentProperty ? "passage" : "default") : "custom",
  name: key,
  description: `Finds ${entityType}`,
  entityType,
  fields: documentProperty ? [documentProperty] : ["name"],
  relations,
  documentProperty,
  modes: ["keyword"],
  status: "ready",
});

export const CATALOG: SearchIndexCatalogEntry[] = [
  entry("company~default", "company"),
  entry("person_employment", "person", [{ relationType: "works_for", direction: "outgoing", label: "Employment" }]),
  entry("person_home", "person", [{ relationType: "lives_in", direction: "outgoing", label: "Home" }]),
  entry("person~bio", "person", [], "bio"),
  entry("person~default", "person"),
];

export const LENS: AgentLens = { scoped: SCHEMA, catalog: CATALOG };

export const CONFIG = {
  indices: [
    { index: "person~default" },
    { index: "person_employment", relations: ["works_for"] },
    { index: "person_home" },
  ],
  filters: [
    { id: "city", entityType: "person", path: [{ relationTypeKey: "lives_in", direction: "outgoing" as const }], field: "name" },
  ],
  answerFields: { person: ["name", "email"] },
  threshold: 0.35,
  answerFieldCharacters: 800,
};
