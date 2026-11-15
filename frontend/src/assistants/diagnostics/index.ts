/**
 * Diagnostics of an assistant chat: how long each step of an answer took,
 * the tokens each model call used and what a step says it did. This folder
 * is all of it in the web client, and it is the same for every assistant
 * kind: it knows no kind, and no kind's code knows it.
 *
 * A step is one piece of work the server did for an answer: one model call
 * or anything else (a tool call, a search, a pipeline step). The server
 * records the steps and sends them as `diagnostics` events when the chat
 * asks with `diagnostics: true`
 * (`server/src/assistants/diagnostics.ts`). The client shows whatever
 * steps come: a step's `name` as words by one rule (`stepName`), its time
 * and tokens, and its `detail`, one string (often formatted JSON), to open
 * and read as written, never parsed.
 *
 * So adding diagnostics to a new assistant kind is recording its steps on
 * the server. Nothing here changes: no label table, no slot, no renderer.
 * A name that reads badly is fixed where the server records the step.
 *
 * Two doors, nothing else is imported from outside this folder:
 *
 * - `events.ts` (no React): the event's shape, its check for the stream
 *   reader (`checkDiagnostics`) and its merge into an answer
 *   (`mergeDiagnostics`) for the turn model;
 * - this file: what a chat shell uses. `useDiagnostics(mode)` says in which
 *   mode the chat runs and tells the shell whether to ask (`on`); the shell
 *   places `DiagnosticsSwitch` in its toolbar, a `DiagnosticsStrip` under
 *   each answer and one `DiagnosticsDrawer`, and calls `follow()` when a
 *   question was sent and `reset()` when the conversation was replaced.
 *
 * Inside: `timeline.ts` is the pure logic (unit-tested with `node --test`),
 * the components draw it.
 */

export { DiagnosticsDrawer } from './DiagnosticsDrawer'
export { DiagnosticsStrip } from './DiagnosticsStrip'
export { DiagnosticsSwitch } from './DiagnosticsSwitch'
export { useDiagnostics, type DiagnosticsControl, type DiagnosticsMode } from './useDiagnostics'
