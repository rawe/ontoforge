/**
 * Composition: the text of self, relation and passage entries — labelled
 * lines with display names for semantic entries, values only for keyword
 * entries, the header, the group label, templates with dropped clauses,
 * and the text cap.
 */

import { describe, expect, it } from "vitest";

import {
  composePassages,
  composeRelation,
  composeSelf,
  renderTemplate,
  type ComposeRelation,
} from "../../src/core/searchComposition.js";
import { ENTRY_TEXT_CAP } from "../../src/core/searchEntry.js";
import { SearchIndexDefinition } from "../../src/core/searchIndex.js";
import { schema } from "./searchSchema.js";

function definition(parts: Record<string, unknown>): SearchIndexDefinition {
  return SearchIndexDefinition.parse({
    key: "people",
    name: "People",
    description: "People",
    entityType: "person",
    ...parts,
  });
}

const ada = {
  id: "ada",
  properties: {
    name: "Ada Lovelace",
    email: "ada@example.org",
    age: 36,
    born: "1815-12-10",
    seen: new Date("1852-11-27T10:00:00.000Z"),
    active: false,
    bio: "Ada wrote the first program.",
  },
};

const acme: ComposeRelation = {
  id: "r1",
  properties: { role: "CTO", since: 2020 },
  target: { id: "acme", typeKey: "company", properties: { name: "ACME", founded: 1999 } },
};

const employment = {
  relationType: "works_for",
  direction: "outgoing",
  fields: ["role", "since"],
  target: { company: ["name", "founded"] },
  label: "Employment",
};

describe("self part", () => {
  it("renders the type label with the name, then labelled lines in definition order", () => {
    const part = composeSelf(definition({ fields: ["email", "name", "age"] }), schema, ada)!;
    expect(part.semanticText).toBe("Person: Ada Lovelace\nE-mail: ada@example.org\nAge: 36");
    expect(part).toMatchObject({ partKind: "self", groupNo: 0, partId: "", relationType: null });
  });

  it("holds the values only, in the same order, for keyword entries", () => {
    const part = composeSelf(definition({ fields: ["email", "name", "age"] }), schema, ada)!;
    expect(part.keywordText).toBe("Ada Lovelace\nada@example.org\n36");
  });

  it("renders scalars as text — dates as stored, datetimes as ISO, booleans", () => {
    const part = composeSelf(definition({ fields: ["born", "seen", "active"] }), schema, ada)!;
    expect(part.semanticText).toBe(
      "Person\nBorn: 1815-12-10\nLast seen: 1852-11-27T10:00:00.000Z\nActive: false",
    );
    expect(part.keywordText).toBe("1815-12-10\n1852-11-27T10:00:00.000Z\nfalse");
  });

  it("omits empty values, and the part when no own field has one", () => {
    const sparse = { id: "x", properties: { name: "Ada", email: "", age: null } };
    expect(composeSelf(definition({ fields: ["name", "email", "age"] }), schema, sparse)!.semanticText).toBe(
      "Person: Ada",
    );
    expect(composeSelf(definition({ fields: ["email", "age"] }), schema, sparse)).toBeNull();
  });

  it("is omitted when the fields hold only a document", () => {
    expect(composeSelf(definition({ fields: ["bio"] }), schema, ada)).toBeNull();
  });

  it("uses the semantic template for semantic text only", () => {
    const part = composeSelf(
      definition({ fields: ["name", "email"], semantic: { template: "{name} can be reached at {email}." } }),
      schema,
      ada,
    )!;
    expect(part.semanticText).toBe("Ada Lovelace can be reached at ada@example.org.");
    expect(part.keywordText).toBe("Ada Lovelace\nada@example.org");
  });

  it("caps the text", () => {
    const long = { id: "x", properties: { name: "A".repeat(ENTRY_TEXT_CAP + 50) } };
    const part = composeSelf(definition({ fields: ["name"] }), schema, long)!;
    expect(part.keywordText).toHaveLength(ENTRY_TEXT_CAP);
    expect(part.semanticText).toHaveLength(ENTRY_TEXT_CAP);
  });
});

describe("relation part", () => {
  it("renders header, group label, relation fields and the target block", () => {
    const part = composeRelation(definition({ fields: ["email"], relations: [employment] }), schema, ada, 0, acme)!;
    expect(part.semanticText).toBe(
      "Person: Ada Lovelace\nEmployment\nRole: CTO\nSince: 2020\nCompany: ACME\nFounded: 1999",
    );
    // Keyword: values only — no type, field or group label.
    expect(part.keywordText).toBe("Ada Lovelace\nCTO\n2020\nACME\n1999");
    for (const label of ["Person", "Employment", "Role", "Since", "Company", "Founded"]) {
      expect(part.keywordText).not.toContain(label);
    }
    expect(part).toMatchObject({
      partKind: "relation",
      groupNo: 0,
      partId: "r1",
      relationType: "works_for",
      targetType: "company",
      targetId: "acme",
    });
  });

  it("defaults the group label to the relation type's display name", () => {
    const part = composeRelation(
      definition({ relations: [{ ...employment, label: null, fields: [], target: { company: ["name"] } }] }),
      schema,
      ada,
      0,
      acme,
    )!;
    expect(part.semanticText).toBe("Person: Ada Lovelace\nWorks for\nCompany: ACME");
    expect(part.keywordText).toBe("Ada Lovelace\nACME");
  });

  it("uses a declared header, and the bare type label for an empty one", () => {
    const withEmail = definition({ header: ["email"], relations: [employment] });
    expect(composeRelation(withEmail, schema, ada, 0, acme)!.semanticText.split("\n").slice(0, 2)).toEqual([
      "Person",
      "E-mail: ada@example.org",
    ]);
    expect(composeRelation(withEmail, schema, ada, 0, acme)!.keywordText.split("\n")[0]).toBe(
      "ada@example.org",
    );
    const none = definition({ header: [], relations: [employment] });
    expect(composeRelation(none, schema, ada, 0, acme)!.semanticText.split("\n")[0]).toBe("Person");
    expect(composeRelation(none, schema, ada, 0, acme)!.keywordText.split("\n")[0]).toBe("CTO");
  });

  it("holds exactly one relation instance", () => {
    const def = definition({ relations: [employment] });
    const foo: ComposeRelation = {
      id: "r2",
      properties: { role: "Advisor" },
      target: { id: "foo", typeKey: "company", properties: { name: "Foo" } },
    };
    const first = composeRelation(def, schema, ada, 0, acme)!.keywordText;
    const second = composeRelation(def, schema, ada, 0, foo)!.keywordText;
    expect(first).toContain("CTO");
    expect(first).not.toContain("Foo");
    expect(second).toContain("Advisor");
    expect(second).not.toContain("ACME");
  });

  it("renders the relation template for semantic text, dropping clauses without a value", () => {
    const def = definition({
      relations: [
        {
          ...employment,
          template: "{name} works as {role} at {target.name}, since {since}; budget {budget}.",
        },
      ],
    });
    const part = composeRelation(def, schema, ada, 0, { ...acme, properties: { role: "CTO" } })!;
    expect(part.semanticText).toBe("Ada Lovelace works as CTO at ACME");
    expect(part.keywordText).toBe("Ada Lovelace\nCTO\nACME\n1999");
  });

  it("is null for a group whose relation type is gone", () => {
    const def = definition({ relations: [{ ...employment, relationType: "employs" }] });
    expect(composeRelation(def, schema, ada, 0, acme)).toBeNull();
  });
});

describe("passage parts", () => {
  it("prefix each chunk with the header and keep the chunk's coordinates", () => {
    const parts = composePassages(definition({ fields: ["bio"] }), schema, ada, [
      { startChar: 0, charLength: 4, text: "Ada " },
      { startChar: 2, charLength: 10, text: "a wrote it" },
    ]);
    expect(parts.map((p) => [p.partId, p.semanticText, p.startChar, p.charLength])).toEqual([
      ["0", "Person: Ada Lovelace\nAda ", 0, 4],
      ["1", "Person: Ada Lovelace\na wrote it", 2, 10],
    ]);
    expect(parts.map((p) => p.keywordText)).toEqual(["Ada Lovelace\nAda ", "Ada Lovelace\na wrote it"]);
  });
});

describe("templates", () => {
  const values: Record<string, string> = { name: "Ada", role: "CTO", "target.name": "ACME" };
  const lookup = (field: string, target: boolean) => values[target ? `target.${field}` : field] ?? null;

  it("substitutes placeholders and keeps a value's own punctuation", () => {
    expect(renderTemplate("{name} is {role}", (f) => (f === "role" ? "C.T.O." : lookup(f, false)))).toBe(
      "Ada is C.T.O.",
    );
  });

  it("drops a clause — up to , ; . or a line break — whose placeholder has no value", () => {
    expect(renderTemplate("{name}, aged {age}, is {role}.", lookup)).toBe("Ada, is CTO.");
    expect(renderTemplate("{name} works at {target.name}\nSince {since}", lookup)).toBe("Ada works at ACME");
    expect(renderTemplate("Since {since}; {name}", lookup)).toBe("Ada");
  });

  it("is null when every clause is dropped", () => {
    expect(renderTemplate("{missing} and {gone}", lookup)).toBeNull();
  });
});
