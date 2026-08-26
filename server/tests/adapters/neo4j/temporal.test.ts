/**
 * Temporals cross the port as JS `Date` objects (datetimes) or ISO
 * `YYYY-MM-DD` strings (dates) — never as neo4j-driver types, at any depth.
 */

import neo4j from "neo4j-driver";
import { describe, expect, it } from "vitest";

import {
  convertNeo4jProperties,
  fromNeo4jValue,
  toNeo4jDate,
  toNeo4jDateTime,
} from "../../../src/adapters/neo4j/temporal.js";

describe("driver values to port values", () => {
  it("a driver DateTime becomes a JS Date at the same instant", () => {
    const dt = new neo4j.types.DateTime<number>(2026, 7, 29, 12, 30, 5, 123000000, 0);
    const converted = fromNeo4jValue(dt);
    expect(converted).toBeInstanceOf(Date);
    expect((converted as Date).toISOString()).toBe("2026-07-29T12:30:05.123Z");
  });

  it("a driver LocalDateTime is treated as UTC (naive datetimes are UTC)", () => {
    const local = new neo4j.types.LocalDateTime<number>(2024, 1, 15, 10, 30, 0, 250000000);
    const converted = fromNeo4jValue(local);
    expect(converted).toBeInstanceOf(Date);
    expect((converted as Date).toISOString()).toBe("2024-01-15T10:30:00.250Z");
  });

  it("a driver Date becomes an ISO YYYY-MM-DD string", () => {
    expect(fromNeo4jValue(new neo4j.types.Date<number>(2026, 7, 29))).toBe("2026-07-29");
    expect(fromNeo4jValue(new neo4j.types.Date<number>(2026, 1, 2))).toBe("2026-01-02");
  });

  it("scalars pass through unchanged", () => {
    expect(fromNeo4jValue("text")).toBe("text");
    expect(fromNeo4jValue(42)).toBe(42);
    expect(fromNeo4jValue(true)).toBe(true);
    expect(fromNeo4jValue(null)).toBeNull();
  });

  it("driver integers become plain numbers", () => {
    expect(fromNeo4jValue(neo4j.int(42))).toBe(42);
  });

  it("conversion recurses into lists and maps", () => {
    const converted = convertNeo4jProperties({
      dates: [new neo4j.types.Date<number>(2026, 7, 29)],
      nested: { at: new neo4j.types.DateTime<number>(2026, 1, 1, 0, 0, 0, 0, 0) },
      name: "unchanged",
    }) as {
      dates: string[];
      nested: { at: Date };
      name: string;
    };
    expect(converted.dates).toEqual(["2026-07-29"]);
    expect(converted.nested.at).toBeInstanceOf(Date);
    expect(converted.name).toBe("unchanged");
  });
});

describe("port values to driver values", () => {
  it("a JS Date becomes a driver DateTime at the same instant", () => {
    const date = new Date("2026-07-29T12:30:05.123Z");
    const dt = toNeo4jDateTime(date);
    expect(dt).toBeInstanceOf(neo4j.types.DateTime);
    expect(dt.toStandardDate().getTime()).toBe(date.getTime());
  });

  it("an ISO date string becomes a driver Date", () => {
    const d = toNeo4jDate("2026-07-29");
    expect(d).toBeInstanceOf(neo4j.types.Date);
    expect(d.toString()).toBe("2026-07-29");
  });
});
