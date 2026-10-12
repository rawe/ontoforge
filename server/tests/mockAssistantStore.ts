/**
 * A fully mocked assistant store for unit tests: every method a mock whose
 * default answers "nothing stored".
 */

import { vi, type Mock } from "vitest";

import type { AssistantStore } from "../src/core/ports.js";

/** Every method as a mock — completeness is compiler-enforced. */
export type MockAssistantStore = { [K in keyof AssistantStore]: Mock };

export function createMockAssistantStore(): MockAssistantStore {
  return {
    listAssistants: vi.fn(async () => []),
    getAssistant: vi.fn(async () => null),
    saveAssistant: vi.fn(),
    deleteAssistant: vi.fn(async () => false),
  };
}
