/**
 * MCP tool-error flattening: because a tool error is a single string, the
 * per-field detail REST returns under `details.fields` is folded into the
 * message text.
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

  it("details.errors a message already carries are not repeated", () => {
    const error = new ValidationError("Invalid configuration: first problem; second problem", {
      errors: ["first problem", "second problem"],
    });
    expect(formatToolError(error)).toBe("Invalid configuration: first problem; second problem");
  });

  it("a changeset's details.violations are flattened with their total", () => {
    const error = new ValidationError("The commit was rejected; nothing was persisted", {
      violations: [
        { seq: 1, kind: "has_children", message: "Still has children" },
        { seq: 4, kind: "drift", message: "Changed since this write was staged" },
      ],
      total: 2,
    });
    expect(formatToolError(error)).toBe(
      "The commit was rejected; nothing was persisted — 2 violations: " +
        "seq 1 has_children: Still has children; seq 4 drift: Changed since this write was staged",
    );
  });

  it("violations cut at the first 100 say so", () => {
    const violations = Array.from({ length: 100 }, (_, i) => ({ seq: i + 1, kind: "dangling", message: "x" }));
    const one = formatToolError(new ValidationError("Rejected", { violations: violations.slice(0, 1), total: 1 }));
    expect(one).toBe("Rejected — 1 violation: seq 1 dangling: x");
    const cut = formatToolError(new ValidationError("Rejected", { violations, total: 250 }));
    expect(cut.startsWith("Rejected — 250 violations, the first 100 shown: seq 1 dangling: x; ")).toBe(true);
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
