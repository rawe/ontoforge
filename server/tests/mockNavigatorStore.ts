/**
 * A fully mocked navigator store for unit tests: every method a mock whose
 * default answers "nothing stored".
 */

import { vi, type Mock } from "vitest";

import type { NavigatorStore } from "../src/core/ports.js";

/** Every method as a mock — completeness is compiler-enforced. */
export type MockNavigatorStore = { [K in keyof NavigatorStore]: Mock };

export function createMockNavigatorStore(): MockNavigatorStore {
  return {
    listNavigators: vi.fn(async () => []),
    getNavigator: vi.fn(async () => null),
    saveNavigator: vi.fn(),
    deleteNavigator: vi.fn(async () => false),
  };
}
