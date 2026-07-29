import { describe, expect, it } from "vitest";

import {
  CascadeRequiredError,
  ConflictError,
  NotFoundError,
  OntoForgeError,
  StoreError,
  ValidationError,
} from "../../src/core/exceptions.js";

describe("exception taxonomy", () => {
  it("all domain errors derive from OntoForgeError", () => {
    for (const error of [
      new NotFoundError("x"),
      new ConflictError("x"),
      new ValidationError("x"),
      new CascadeRequiredError("x", []),
      new StoreError(),
    ]) {
      expect(error).toBeInstanceOf(OntoForgeError);
      expect(error).toBeInstanceOf(Error);
    }
  });

  it("ValidationError carries optional details", () => {
    expect(new ValidationError("bad").details).toBeNull();
    const details = { fields: { name: "required" } };
    expect(new ValidationError("bad", details).details).toBe(details);
  });

  it("CascadeRequiredError carries the affected ontologies", () => {
    const error = new CascadeRequiredError("cascade", ["lens_a", "lens_b"]);
    expect(error.affectedOntologies).toEqual(["lens_a", "lens_b"]);
  });

  it("StoreError generates an 8-hex errorId and a neutral default message", () => {
    const error = new StoreError();
    expect(error.errorId).toMatch(/^[0-9a-f]{8}$/);
    expect(error.message).toBe("A storage operation failed");
  });

  it("StoreError ids are unique per instance", () => {
    expect(new StoreError().errorId).not.toBe(new StoreError().errorId);
  });

  it("StoreError accepts an explicit errorId", () => {
    expect(new StoreError("failed", "deadbeef").errorId).toBe("deadbeef");
  });
});
