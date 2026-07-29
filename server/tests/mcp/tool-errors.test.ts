/**
 * MCP tool-error flattening: because a tool error is a single string, the
 * per-field detail REST returns under `details.fields` is folded into the
 * message text. Ported from the Python reference's
 * `_format_validation_error`.
 */

import { describe, expect, it } from "vitest";
import { z } from "zod";

import { ConflictError, ValidationError } from "../../src/core/exceptions.js";
import { formatToolError } from "../../src/mcp/modeling.js";
import { PropertyDefinitionCreate } from "../../src/modeling/schemas.js";

describe("formatToolError", () => {
  it("a bare ValidationError keeps its message", () => {
    expect(formatToolError(new ValidationError("Invalid input"))).toBe("Invalid input");
  });

  it("details.fields are flattened into the message", () => {
    const error = new ValidationError("Validation failed", {
      fields: { name: "required", age: "not an integer" },
    });
    expect(formatToolError(error)).toBe(
      "Validation failed — name: required; age: not an integer",
    );
  });

  it("details.errors are flattened into the message", () => {
    const error = new ValidationError("Validation failed", {
      errors: ["first problem", "second problem"],
    });
    expect(formatToolError(error)).toBe("Validation failed — first problem; second problem");
  });

  it("a multi-field zod failure surfaces every offending field in one string", () => {
    const result = PropertyDefinitionCreate.safeParse({
      key: "Bad Key",
      displayName: "X",
      dataType: "uuid",
    });
    expect(result.success).toBe(false);
    const message = formatToolError(result.error);
    expect(message).toContain("key");
    expect(message).toContain("dataType");
    expect(message).toContain(";");
  });

  it("other domain errors keep their identity's message", () => {
    expect(formatToolError(new ConflictError("Key already exists"))).toBe("Key already exists");
  });

  it("non-error values are stringified", () => {
    expect(formatToolError("boom")).toBe("boom");
  });

  it("zod issues carry the field path", () => {
    const schema = z.object({ key: z.string().regex(/^[a-z][a-z0-9_]*$/) });
    const result = schema.safeParse({ key: "_bad" });
    expect(result.success).toBe(false);
    expect(formatToolError(result.error)).toMatch(/^key: /);
  });
});
