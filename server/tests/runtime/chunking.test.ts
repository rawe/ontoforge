/**
 * Chunker unit tests, ported from `tests/runtime/test_chunking.py`, plus
 * the code-point scenarios the migration spec requires (emoji documents)
 * and a property-style reassembly sweep.
 */

import { describe, expect, it } from "vitest";

import { chunkDocument, type Chunk } from "../../src/runtime/chunking.js";

/** Code-point slice, for asserting chunk coordinates Python-style. */
function cpSlice(text: string, start: number, end: number): string {
  return Array.from(text).slice(start, end).join("");
}

function cpLen(text: string): number {
  return Array.from(text).length;
}

describe("trivial cases", () => {
  it("empty text returns no chunks", () => {
    expect(chunkDocument("", 1500, 200)).toEqual([]);
  });

  it("short text returns a single chunk", () => {
    const text = "A short document.";
    const chunks = chunkDocument(text, 1500, 200);
    expect(chunks).toHaveLength(1);
    expect(chunks[0]!.startChar).toBe(0);
    expect(chunks[0]!.charLength).toBe(text.length);
    expect(chunks[0]!.text).toBe(text);
  });

  it("text exactly at size returns a single chunk", () => {
    const text = "x".repeat(100);
    const chunks = chunkDocument(text, 100, 20);
    expect(chunks).toHaveLength(1);
    expect(chunks[0]!.text).toBe(text);
  });

  it("invalid size throws", () => {
    expect(() => chunkDocument("text", 0, 0)).toThrow();
  });

  it("invalid overlap throws", () => {
    expect(() => chunkDocument("text", 100, 100)).toThrow();
    expect(() => chunkDocument("text", 100, -1)).toThrow();
  });
});

describe("coordinates", () => {
  it("offsets are exact coordinates in the source", () => {
    // Every chunk's startChar/charLength must slice back to its text.
    const text = "Lorem ipsum dolor sit amet. ".repeat(100); // 2800 chars
    const chunks = chunkDocument(text, 500, 100);
    expect(chunks.length).toBeGreaterThan(1);
    for (const chunk of chunks) {
      expect(cpSlice(text, chunk.startChar, chunk.startChar + chunk.charLength)).toBe(chunk.text);
      expect(chunk.charLength).toBe(cpLen(chunk.text));
    }
  });

  it("chunks cover the entire document", () => {
    // First chunk starts at 0, last chunk ends at len(text), no gaps.
    const text = "word ".repeat(500); // 2500 chars
    const chunks = chunkDocument(text, 400, 50);
    expect(chunks[0]!.startChar).toBe(0);
    const last = chunks[chunks.length - 1]!;
    expect(last.startChar + last.charLength).toBe(text.length);
    for (let i = 1; i < chunks.length; i++) {
      const prev = chunks[i - 1]!;
      const curr = chunks[i]!;
      // No gaps: each chunk starts at or before the previous chunk's end.
      expect(curr.startChar).toBeLessThanOrEqual(prev.startChar + prev.charLength);
      expect(curr.startChar).toBeGreaterThan(prev.startChar); // always advances
    }
  });
});

describe("overlap", () => {
  it("consecutive chunks overlap", () => {
    const text = "x".repeat(1000); // no boundaries: hard splits
    const chunks = chunkDocument(text, 300, 50);
    for (let i = 1; i < chunks.length; i++) {
      const prev = chunks[i - 1]!;
      const prevEnd = prev.startChar + prev.charLength;
      expect(prevEnd - chunks[i]!.startChar).toBe(50);
    }
  });

  it("no overlap when zero", () => {
    const text = "x".repeat(1000);
    const chunks = chunkDocument(text, 300, 0);
    for (let i = 1; i < chunks.length; i++) {
      const prev = chunks[i - 1]!;
      expect(chunks[i]!.startChar).toBe(prev.startChar + prev.charLength);
    }
  });
});

describe("boundary preference", () => {
  it("prefers a paragraph boundary", () => {
    const para1 = "First paragraph. ".repeat(10); // 170 chars
    const para2 = "Second paragraph content here.";
    const text = para1.trimEnd() + "\n\n" + para2;
    const chunks = chunkDocument(text, 180, 20);
    // First chunk should end right after the paragraph break.
    expect(chunks[0]!.text.endsWith("\n\n")).toBe(true);
  });

  it("prefers a sentence boundary over whitespace", () => {
    // No paragraph breaks; sentences end mid-way.
    const text = "This is sentence one. This is sentence two. ".repeat(10).trimEnd();
    const chunks = chunkDocument(text, 100, 10);
    expect(chunks.length).toBeGreaterThan(1);
    // Each non-final chunk should end after a sentence separator.
    for (const chunk of chunks.slice(0, -1)) {
      expect(chunk.text.endsWith(". ")).toBe(true);
    }
  });

  it("falls back to a whitespace boundary", () => {
    const text = "supercalifragilistic ".repeat(50); // words longer than sentence patterns
    const chunks = chunkDocument(text, 100, 10);
    for (const chunk of chunks.slice(0, -1)) {
      expect(chunk.text.endsWith(" ")).toBe(true);
    }
  });

  it("hard split when no boundaries", () => {
    const text = "a".repeat(1000);
    const chunks = chunkDocument(text, 300, 0);
    expect(chunks.slice(0, -1).map((c) => c.charLength)).toEqual([300, 300, 300]);
    expect(chunks[chunks.length - 1]!.charLength).toBe(100);
  });

  it("midpoint rule: the backwards search never passes the chunk midpoint", () => {
    // Verified against the Python reference: a whitespace AT the midpoint
    // index (minEnd = 50 for size 100) is taken — split after it — while
    // one strictly below the midpoint is out of the search window and the
    // chunk hard-splits at the target instead.
    const size = 100;
    const atMidpoint = "b".repeat(50) + " " + "b".repeat(500);
    expect(chunkDocument(atMidpoint, size, 0)[0]!.charLength).toBe(51);

    const belowMidpoint = "b".repeat(49) + " " + "b".repeat(500);
    expect(chunkDocument(belowMidpoint, size, 0)[0]!.charLength).toBe(100);
  });
});

describe("code points (emoji)", () => {
  it("coordinates count code points, not UTF-16 units", () => {
    // Astral-plane emoji are 2 UTF-16 units but 1 code point each.
    const sentence = "The crew 👩‍🚀🚀 left for Mars 🌍 today. ";
    const text = sentence.repeat(20);
    const chunks = chunkDocument(text, 100, 10);
    expect(chunks.length).toBeGreaterThan(1);
    const cps = Array.from(text);
    for (const chunk of chunks) {
      expect(cps.slice(chunk.startChar, chunk.startChar + chunk.charLength).join("")).toBe(
        chunk.text,
      );
      expect(chunk.charLength).toBe(Array.from(chunk.text).length);
    }
    const last = chunks[chunks.length - 1]!;
    expect(last.startChar + last.charLength).toBe(cps.length);
  });

  it("hard splits never break a surrogate pair", () => {
    const text = "🌍".repeat(400); // 400 code points, 800 UTF-16 units
    const chunks = chunkDocument(text, 100, 0);
    expect(chunks.map((c) => c.charLength)).toEqual([100, 100, 100, 100]);
    for (const chunk of chunks) {
      // Well-formed text: no lone surrogates.
      expect(chunk.text.isWellFormed()).toBe(true);
      expect(Array.from(chunk.text).length).toBe(100);
    }
  });
});

describe("determinism and reassembly", () => {
  const CORPUS: string[] = [
    "Paragraph one.\n\nParagraph two is a bit longer. It has two sentences.\n\n".repeat(30),
    "One two three four five six seven eight nine ten. ".repeat(60),
    "nowhitespaceatallnowhitespaceatall".repeat(80),
    "Mixed 👾 content with emoji 🌍 and newlines\nplus sentence ends! Right? Yes.\n\n".repeat(25),
    "short",
  ];

  it("is deterministic", () => {
    for (const text of CORPUS) {
      const a = chunkDocument(text, 200, 40);
      const b = chunkDocument(text, 200, 40);
      expect(a).toEqual(b);
    }
  });

  it("every chunk reassembles against the source, invariants hold", () => {
    for (const text of CORPUS) {
      for (const [size, overlap] of [
        [200, 40],
        [150, 0],
        [97, 13],
      ] as const) {
        const chunks: Chunk[] = chunkDocument(text, size, overlap);
        const cps = Array.from(text);
        expect(chunks.length).toBeGreaterThan(0);
        expect(chunks[0]!.startChar).toBe(0);
        const last = chunks[chunks.length - 1]!;
        expect(last.startChar + last.charLength).toBe(cps.length);
        for (let i = 0; i < chunks.length; i++) {
          const chunk = chunks[i]!;
          expect(
            cps.slice(chunk.startChar, chunk.startChar + chunk.charLength).join(""),
          ).toBe(chunk.text);
          expect(chunk.charLength).toBeGreaterThan(0);
          expect(chunk.charLength).toBeLessThanOrEqual(size);
          if (i > 0) {
            const prev = chunks[i - 1]!;
            expect(chunk.startChar).toBeGreaterThan(prev.startChar);
            expect(chunk.startChar).toBeLessThanOrEqual(prev.startChar + prev.charLength);
          }
        }
      }
    }
  });
});
