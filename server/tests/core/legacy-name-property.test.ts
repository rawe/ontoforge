/**
 * The name-property fallback for 5.x data: which property becomes the
 * name property, and which key a created one gets.
 */

import { describe, expect, it } from "vitest";

import { legacyNameProperty } from "../../src/core/legacyNameProperty.js";

const string = (key: string) => ({ key, dataType: "string" });
const typed = (key: string, dataType: string) => ({ key, dataType });

describe("legacyNameProperty", () => {
  it("prefers name, then title, then label, then display_name", () => {
    const all = [string("display_name"), string("label"), string("title"), string("name")];
    expect(legacyNameProperty(all)).toEqual({ key: "name", create: false });
    expect(legacyNameProperty(all.slice(0, 3))).toEqual({ key: "title", create: false });
    expect(legacyNameProperty(all.slice(0, 2))).toEqual({ key: "label", create: false });
    expect(legacyNameProperty(all.slice(0, 1))).toEqual({ key: "display_name", create: false });
  });

  it("takes the first string property in declaration order when no preferred key is one", () => {
    const properties = [typed("age", "integer"), string("summary"), string("code")];
    expect(legacyNameProperty(properties)).toEqual({ key: "summary", create: false });
  });

  it("skips a preferred key that is not a string property", () => {
    const properties = [typed("name", "integer"), typed("title", "document"), string("code")];
    expect(legacyNameProperty(properties)).toEqual({ key: "code", create: false });
  });

  it("asks for a new `name` property when the type has no string property", () => {
    expect(legacyNameProperty([])).toEqual({ key: "name", create: true });
    expect(legacyNameProperty([typed("bio", "document")])).toEqual({ key: "name", create: true });
  });

  it("suffixes the new key while it is taken by a non-string property", () => {
    expect(legacyNameProperty([typed("name", "integer")])).toEqual({ key: "name_2", create: true });
    expect(
      legacyNameProperty([typed("name", "integer"), typed("name_2", "date")]),
    ).toEqual({ key: "name_3", create: true });
  });
});
