/**
 * The text form of an entity identity (`docs/capabilities/entity-identity.md#the-text-form`):
 * the parts in order joined with `~`, `%` and `~` escaped in strings,
 * integers and dates in their plain forms, the length limit and the
 * refusal of an empty or missing value; and the exactly-one check of an
 * id and identity pair.
 */

import { describe, expect, it } from "vitest";

import {
  buildIdentity,
  EMPTY_IDENTITY_VALUE,
  IDENTITY_TOO_LONG,
  IDENTITY_VALUE_MISSING,
  identityPropertiesOf,
  MAX_IDENTITY_LENGTH,
} from "../../src/runtime/identity.js";
import { exactlyOne } from "../../src/runtime/service.js";

const CODE = { key: "code", dataType: "string" };
const YEAR = { key: "year", dataType: "integer" };
const DAY = { key: "day", dataType: "date" };

describe("the text form", () => {
  it("joins the parts in the declared order", () => {
    expect(buildIdentity([CODE, YEAR, DAY], { code: "A-1", year: 2024, day: "2024-01-31" })).toEqual({
      identity: "A-1~2024~2024-01-31",
      faults: null,
    });
    expect(buildIdentity([DAY, CODE], { code: "A-1", day: "2024-01-31" }).identity).toBe("2024-01-31~A-1");
  });

  it("escapes % and ~ in strings, also with one property", () => {
    expect(buildIdentity([CODE], { code: "50%~off" }).identity).toBe("50%25%7Eoff");
    expect(buildIdentity([CODE, CODE], { code: "%7E" }).identity).toBe("%257E~%257E");
    // A part holding the escape of `~` stays apart from one holding `~`.
    expect(buildIdentity([CODE], { code: "a~b" }).identity).not.toBe(buildIdentity([CODE], { code: "a%7Eb" }).identity);
  });

  it("writes integers as plain decimal, negative ones included", () => {
    expect(buildIdentity([YEAR], { year: -7 }).identity).toBe("-7");
    expect(buildIdentity([YEAR], { year: 0 }).identity).toBe("0");
  });

  it("neither trims nor folds case", () => {
    expect(buildIdentity([CODE], { code: " Ab " }).identity).toBe(" Ab ");
  });

  it("refuses an empty string and a missing value under their properties", () => {
    expect(buildIdentity([CODE, YEAR], { code: "" })).toEqual({
      identity: null,
      faults: { code: EMPTY_IDENTITY_VALUE, year: IDENTITY_VALUE_MISSING },
    });
    expect(buildIdentity([CODE], { code: null }).faults).toEqual({ code: IDENTITY_VALUE_MISSING });
  });

  it("allows 512 code points and refuses more, under every identity property", () => {
    const astral = "😀"; // two UTF-16 units, one code point
    expect(buildIdentity([CODE], { code: astral.repeat(MAX_IDENTITY_LENGTH) }).identity).not.toBeNull();
    expect(buildIdentity([CODE, YEAR], { code: "x".repeat(MAX_IDENTITY_LENGTH - 2), year: 1 }).faults).toBeNull();
    expect(buildIdentity([CODE, YEAR], { code: "x".repeat(MAX_IDENTITY_LENGTH - 1), year: 1 })).toEqual({
      identity: null,
      faults: { code: IDENTITY_TOO_LONG, year: IDENTITY_TOO_LONG },
    });
    // An escape counts as the three characters it is.
    expect(buildIdentity([CODE], { code: "~".repeat(171) }).faults).toEqual({ code: IDENTITY_TOO_LONG });
    expect(buildIdentity([CODE], { code: "~".repeat(170) }).faults).toBeNull();
  });

  it("finds the identity properties of a type only when every one is defined", () => {
    const defs = { code: { dataType: "string" }, year: { dataType: "integer" } };
    expect(identityPropertiesOf(["year", "code"], defs)).toEqual([YEAR, CODE]);
    expect(identityPropertiesOf(["code", "hidden"], defs)).toBeNull();
    expect(identityPropertiesOf(null, defs)).toBeNull();
  });
});

describe("an id and identity pair", () => {
  it("takes exactly one of the two", () => {
    expect(exactlyOne("id", undefined)).toBe(true);
    expect(exactlyOne(undefined, "A~1")).toBe(true);
    expect(exactlyOne(null, "A~1")).toBe(true);
    expect(exactlyOne("id", "A~1")).toBe(false);
    expect(exactlyOne(undefined, undefined)).toBe(false);
    expect(exactlyOne(null, null)).toBe(false);
  });
});
