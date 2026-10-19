/**
 * A fully mocked anchor store for unit tests: every method a mock whose
 * default answers "nothing stored".
 */

import { vi, type Mock } from "vitest";

import type { AnchorStore } from "../src/core/ports.js";

/** Every method as a mock — completeness is compiler-enforced. */
export type MockAnchorStore = { [K in keyof AnchorStore]: Mock };

export function createMockAnchorStore(): MockAnchorStore {
  return {
    listAnchors: vi.fn(async () => []),
    getAnchor: vi.fn(async () => null),
    saveAnchor: vi.fn(),
    deleteAnchor: vi.fn(async () => false),
  };
}
