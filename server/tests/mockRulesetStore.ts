/**
 * A fully mocked ruleset store for unit tests: every method a mock whose
 * default answers "nothing stored".
 */

import { vi, type Mock } from "vitest";

import type { RulesetStore } from "../src/core/ports.js";

/** Every method as a mock — completeness is compiler-enforced. */
export type MockRulesetStore = { [K in keyof RulesetStore]: Mock };

export function createMockRulesetStore(): MockRulesetStore {
  return {
    list: vi.fn(async () => []),
    get: vi.fn(async () => null),
    save: vi.fn(),
    delete: vi.fn(async () => false),
  };
}
