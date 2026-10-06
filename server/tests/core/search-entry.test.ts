/**
 * Search entries: the text cap at a code-point boundary and the text hash.
 */

import { createHash } from "node:crypto";

import { describe, expect, it } from "vitest";

import { capEntryText, ENTRY_TEXT_CAP, entryTextHash } from "../../src/core/searchEntry.js";

describe("entry text cap", () => {
  it("is 8,000 characters", () => {
    expect(ENTRY_TEXT_CAP).toBe(8000);
  });

  it("keeps text at or under the cap", () => {
    const text = "a".repeat(ENTRY_TEXT_CAP);
    expect(capEntryText(text)).toBe(text);
    expect(capEntryText("short")).toBe("short");
  });

  it("cuts longer text to the cap", () => {
    expect(capEntryText("a".repeat(ENTRY_TEXT_CAP + 5))).toBe("a".repeat(ENTRY_TEXT_CAP));
  });

  it("counts code points, never splitting a surrogate pair", () => {
    // Each emoji is one code point and two UTF-16 units.
    const emoji = "😀".repeat(ENTRY_TEXT_CAP);
    expect(capEntryText(emoji)).toBe(emoji);
    const capped = capEntryText(`${"a".repeat(ENTRY_TEXT_CAP - 1)}😀😀`);
    expect(capped).toBe(`${"a".repeat(ENTRY_TEXT_CAP - 1)}😀`);
    expect(Array.from(capped)).toHaveLength(ENTRY_TEXT_CAP);
  });
});

describe("entry text hash", () => {
  it("is the hex SHA-256 of text, representation and model id", () => {
    const expected = createHash("sha256").update("Ada\0semantic\0ollama:bge-m3:1024").digest("hex");
    expect(entryTextHash("Ada", "semantic", "ollama:bge-m3:1024")).toBe(expected);
  });

  it("changes with each input", () => {
    const base = entryTextHash("Ada", "semantic", "m1");
    expect(entryTextHash("Ada ", "semantic", "m1")).not.toBe(base);
    expect(entryTextHash("Ada", "keyword", "m1")).not.toBe(base);
    expect(entryTextHash("Ada", "semantic", "m2")).not.toBe(base);
  });

  it("keeps the inputs apart", () => {
    expect(entryTextHash("a", "keyword", null)).not.toBe(entryTextHash("akeyword", "keyword", null));
    expect(entryTextHash("Ada", "keyword", null)).toBe(entryTextHash("Ada", "keyword", null));
  });
});
