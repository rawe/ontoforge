/**
 * The assistants module: what every assistant kind runs on, whichever
 * context hosts it. The session layer — a chat turn as a stream on its
 * thread (`session.ts`) and the thread store with its leases and saver
 * (`threads/`) — and the tool loop, which runs a turn the host prepared
 * with its instructions, context and tools (`loop.ts`, `tool.ts`). It
 * knows no HTTP, principals or access rules: the hosts resolve those and
 * hand in the bound thread and the turn's work. This file is its only
 * entrance (`tests/architecture/dependencies.test.ts`).
 */

export { runToolLoop, type ContextBlock, type PreparedRun } from "./loop.js";
export { streamTurn, type ChatTurn, type StreamEvent, type StreamExecution, type TurnStream } from "./session.js";
export { openThread, readThread } from "./threads/access.js";
export {
  checkStateSize,
  DEFAULT_LIFETIMES,
  sameBinding,
  scopeOf,
  TURNS_PER_THREAD,
  type GraphThread,
  type Artifact,
  type StoreLifetimes,
  type Thread,
  type ThreadBinding,
  type ThreadScope,
  type ThreadStore,
  type Turn,
} from "./threads/threadStore.js";
export type { Tool } from "./tool.js";
export { MemoryThreadStore } from "./threads/memoryThreadStore.js";
export { turnCount } from "./threads/turns.js";
