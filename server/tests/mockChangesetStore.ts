/**
 * A fully mocked changeset store for unit tests: every method a mock whose
 * default answers "nothing stored".
 */

import { vi, type Mock } from "vitest";

import type { ChangesetStore } from "../src/core/ports.js";

/** Every method as a mock — completeness is compiler-enforced. */
export type MockChangesetStore = { [K in keyof ChangesetStore]: Mock };

export function createMockChangesetStore(): MockChangesetStore {
  return {
    start: vi.fn(),
    get: vi.fn(async () => null),
    list: vi.fn(async () => []),
    page: vi.fn(async () => []),
    findMinted: vi.fn(async () => null),
    writesOn: vi.fn(async () => []),
    stagedBytes: vi.fn(async () => 0),
    append: vi.fn(async () => null),
    unstage: vi.fn(async () => false),
    submit: vi.fn(async () => null),
    unsubmit: vi.fn(async () => null),
    discard: vi.fn(async () => false),
    touch: vi.fn(async () => undefined),
    sweep: vi.fn(async () => 0),
    lockForCommit: vi.fn(async () => null),
    deleteWithJournal: vi.fn(async () => undefined),
  };
}
