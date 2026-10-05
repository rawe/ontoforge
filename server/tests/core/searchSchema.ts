/**
 * A small schema for the search pipeline's unit tests: people working for
 * companies, knowing each other and living in cities, with a bio document.
 */

import type { SearchIndexSchema } from "../../src/core/searchIndex.js";

type Props = Record<string, { key: string; displayName: string; dataType: string }>;

function props(...specs: [string, string, string][]): Props {
  const out: Props = {};
  for (const [key, displayName, dataType] of specs) {
    out[key] = { key, displayName, dataType };
  }
  return out;
}

export const schema: SearchIndexSchema = {
  entityTypes: {
    person: {
      key: "person",
      displayName: "Person",
      nameProperty: "name",
      properties: props(
        ["name", "Name", "string"],
        ["email", "E-mail", "string"],
        ["age", "Age", "integer"],
        ["born", "Born", "date"],
        ["seen", "Last seen", "datetime"],
        ["active", "Active", "boolean"],
        ["bio", "Biography", "document"],
      ),
    },
    company: {
      key: "company",
      displayName: "Company",
      nameProperty: "name",
      properties: props(["name", "Name", "string"], ["founded", "Founded", "integer"]),
    },
    city: {
      key: "city",
      displayName: "City",
      nameProperty: "name",
      properties: props(["name", "Name", "string"]),
    },
  },
  relationTypes: {
    works_for: {
      key: "works_for",
      displayName: "Works for",
      fromEntityTypeKey: "person",
      toEntityTypeKey: "company",
      properties: props(["role", "Role", "string"], ["since", "Since", "integer"]),
    },
    knows: {
      key: "knows",
      displayName: "Knows",
      fromEntityTypeKey: "person",
      toEntityTypeKey: "person",
      properties: props(["since", "Since", "integer"]),
    },
    lives_in: {
      key: "lives_in",
      displayName: "Lives in",
      fromEntityTypeKey: "person",
      toEntityTypeKey: "city",
      properties: {},
    },
  },
};
