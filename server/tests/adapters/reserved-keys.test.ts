/**
 * Reserved key sets are derived from the adapter's physical naming — the
 * inverse transformation applied to the schema labels and relationship
 * types — and must equal the documented six + six
 * (`docs/storage-adapters.md`, "Naming transformations").
 */

import { describe, expect, it } from "vitest";

import {
  reservedEntityTypeKeys,
  reservedRelationTypeKeys,
  toPascalCase,
  toSnakeCase,
  toUpperSnakeCase,
  SCHEMA_LABELS,
  SCHEMA_RELATIONSHIP_TYPES,
} from "../../src/adapters/neo4j/ddl.js";

describe("naming transformations", () => {
  it("snake_case to PascalCase", () => {
    expect(toPascalCase("research_paper")).toBe("ResearchPaper");
    expect(toPascalCase("person")).toBe("Person");
    expect(toPascalCase("entity_type")).toBe("EntityType");
  });

  it("PascalCase back to snake_case", () => {
    expect(toSnakeCase("ResearchPaper")).toBe("research_paper");
    expect(toSnakeCase("Person")).toBe("person");
    expect(toSnakeCase("AiAgentConfig")).toBe("ai_agent_config");
  });

  it("snake_case to UPPER_SNAKE_CASE", () => {
    expect(toUpperSnakeCase("works_for")).toBe("WORKS_FOR");
  });

  it("the inverse transformation round-trips every schema label", () => {
    for (const label of SCHEMA_LABELS) {
      expect(toPascalCase(toSnakeCase(label))).toBe(label);
    }
    for (const relType of SCHEMA_RELATIONSHIP_TYPES) {
      expect(toUpperSnakeCase(relType.toLowerCase())).toBe(relType);
    }
  });
});

describe("reserved key sets", () => {
  it("entity type set equals the documented six", () => {
    expect(new Set(reservedEntityTypeKeys())).toEqual(
      new Set([
        "ontology",
        "entity_type",
        "relation_type",
        "property_definition",
        "ai_agent_config",
        "saved_query",
      ]),
    );
  });

  it("relation type set equals the documented six", () => {
    expect(new Set(reservedRelationTypeKeys())).toEqual(
      new Set([
        "includes_type",
        "has_property",
        "relates_from",
        "relates_to",
        "has_ai_agent",
        "has_saved_query",
      ]),
    );
  });

  it("the sets contain plain type keys, never physical names", () => {
    for (const key of [...reservedEntityTypeKeys(), ...reservedRelationTypeKeys()]) {
      expect(key).toMatch(/^[a-z][a-z0-9_]*$/);
    }
  });
});
